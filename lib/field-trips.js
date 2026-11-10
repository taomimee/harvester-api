'use strict';

// A trip is its own ledger. Work completion, cash receipts and trip closure are independent.
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
// Disconnected pieces of one GPS lock still describe one logical field.
const gpsPlotGroupKey = (plot, vehicle, day) => {
  const origin = plot.auto_origin;
  return origin?.plot_id && String(origin.vehicle_id) === String(vehicle) && origin.work_date === day
    ? `${vehicle}/${day}/auto:${origin.plot_id}` : `${vehicle}/${day}/${plot.id}`;
};
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text = (value, label, max = 200, required = true) => {
  const result = String(value ?? '').trim();
  if ((required && !result) || result.length > max) fail(`กรุณาระบุ${label}ไม่เกิน ${max} ตัวอักษร`);
  return result;
};
const number = (value, label, max, integer = false, allowZero = false) => {
  if (value === '' || value == null || typeof value === 'boolean') fail(`กรุณาระบุ${label}`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (!allowZero && result === 0) || result > max || (integer && !Number.isInteger(result))) fail(`${label}ไม่ถูกต้อง`);
  return result;
};
const positiveMoney = (value, label, max) => {
  const rounded = money(number(value, label, max));
  if (rounded <= 0) fail(`${label}ต้องไม่น้อยกว่า 0.01 บาท`);
  return rounded;
};
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('วันที่ไม่ถูกต้อง');
  return value;
};
const namesOf = names => {
  if (!Array.isArray(names) || !names.length || names.length > 10) fail('กรุณาเลือกคนทำงาน');
  const result = names.map(name => text(name, 'ชื่อคนทำงาน', 100));
  if (new Set(result).size !== result.length) fail('ห้ามเลือกคนทำงานซ้ำ');
  return result;
};
function splitCrew(names, profiles) {
  names = namesOf(names);
  const crew = names.map(name => {
    const profile = profiles.find(p => p.name === name);
    if (!profile || !['DRIVER', 'HELPER', 'TRAINEE'].includes(profile.role)) fail(`ให้เถ้าแก่ตั้งระดับของ ${name} ก่อนบันทึก`);
    return { name, role: profile.role };
  });
  const drivers = crew.filter(p => p.role === 'DRIVER').length;
  const support = crew.reduce((s, p) => s + (p.role === 'HELPER' ? 20 : p.role === 'TRAINEE' ? 10 : 0), 0);
  if (!drivers || (60 - support) / drivers < 30) fail('ต้องมีคนขับอย่างน้อยหนึ่งคน และส่วนแบ่งคนขับไม่น้อยกว่า 30 บาท/ไร่');
  return crew.map(p => ({ ...p, rate: p.role === 'DRIVER' ? (60 - support) / drivers : p.role === 'HELPER' ? 20 : 10 }));
}
function dayAmounts(rai, price, crew) {
  const wage = money(rai * 60), cents = Math.round(wage * 100);
  let used = 0;
  const shares = crew.map((p, i) => {
    const part = i === crew.length - 1 ? cents - used : Math.round(cents * p.rate / 60);
    used += part;
    return { ...p, amount: part / 100 };
  });
  return { harvest_amount: money(rai * price), wage_amount: wage, crew: shares };
}
function summarizeTrip(trip, filter = {}) {
  const included = d => (!filter.from || d >= filter.from) && (!filter.to || d <= filter.to);
  const days = trip.days.filter(d => included(d.work_date));
  const payments = trip.payments.filter(p => !p.voided_at && included(p.payment_date));
  const workers = new Map();
  const worker = name => { if (!workers.has(name)) workers.set(name, { name, earned: 0 }); return workers.get(name); };
  let rai = 0, plots = 0, earned = 0, wages = 0, received = 0;
  for (const day of days) {
    rai += day.confirmed_rai; plots += day.plot_count; earned += day.harvest_amount; wages += day.wage_amount;
    day.crew.forEach(p => { worker(p.name).earned += p.amount; });
  }
  for (const p of payments) {
    received += p.amount;
  }
  return {
    rai: Math.round(rai * 10000) / 10000, plots, work_days: new Set(days.map(d => d.work_date)).size,
    earned: money(earned), received: money(received), broker_balance: money(earned - received),
    wages: money(wages), margin_before_other_expenses: money(earned - wages),
    workers: [...workers.values()].map(w => ({ ...w, earned: money(w.earned) }))
  };
}
function applyAction(previous, action, context = {}) {
  const { vehicles = [], profiles = [], gpsPlots = [], now = new Date().toISOString() } = context;
  const vehicleSelection = ids => {
    if (!Array.isArray(ids) || ids.length !== 1) fail('หนึ่งทริปใช้รถหนึ่งคัน กรุณาเลือกรถ');
    if (new Set(ids.map(String)).size !== ids.length) fail('ห้ามเลือกรถซ้ำ');
    return ids.map(id => {
      const vehicle = vehicles.find(v => String(v.id) === String(id));
      if (!vehicle) fail('ไม่พบรถที่เลือก กรุณาโหลดรายชื่อรถใหม่');
      return { id: String(vehicle.id), name: vehicle.name };
    });
  };
  if (!action || typeof action !== 'object') fail('รายการไม่ถูกต้อง');
  if (!previous) {
    if (action.type !== 'CREATE') fail('ไม่พบทริป', 404);
    return { location: text(action.location, 'พื้นที่'), broker_name: text(action.broker_name, 'ชื่อนายหน้า', 200, false),
      start_date: date(action.start_date), end_date: null, status: 'OPEN',
      price_per_rai: positiveMoney(action.price_per_rai, 'ค่าเกี่ยวต่อไร่', 100000),
      vehicles: vehicleSelection(action.vehicle_ids), note: text(action.note, 'หมายเหตุ', 2000, false),
      days: [], payments: [], created_at: now };
  }
  const trip = structuredClone(previous);
  if (action.type === 'REOPEN') { trip.status = 'OPEN'; trip.end_date = null; return trip; }
  if (action.type === 'CLOSE') {
    const end = date(action.end_date);
    if (end < trip.start_date || trip.days.some(d => d.work_date > end)) fail('วันจบทริปต้องไม่ก่อนวันเริ่มหรือวันที่ลงงานล่าสุด');
    trip.status = 'CLOSED'; trip.end_date = end; return trip;
  }
  // Money may be settled after returning home. It never closes or reopens the trip.
  if (action.type === 'PAYMENT_ADD') {
    if (!uuid(action.id) || trip.payments.some(p => p.id === action.id)) fail('รายการเงินซ้ำหรือไม่ถูกต้อง', 409);
    if (action.kind !== 'BROKER_RECEIPT') fail('เงินเบิกคนขับให้ใช้สมุดค่าแรงเดิม');
    const paymentDate = date(action.payment_date);
    if (paymentDate < trip.start_date) fail('วันรับหรือจ่ายเงินต้องไม่ก่อนเริ่มทริป');
    trip.payments.push({ id: action.id, kind: action.kind, payment_date: paymentDate,
      amount: positiveMoney(action.amount, 'จำนวนเงิน', 100000000), note: text(action.note, 'หมายเหตุ', 2000, false), created_at: now });
    if (trip.payments.length > 5000) fail('ทริปมีรายการเงินมากเกินไป กรุณาเริ่มทริปใหม่');
    return trip;
  }
  if (action.type === 'PAYMENT_VOID') {
    const payment = trip.payments.find(p => p.id === action.id);
    if (!payment || payment.voided_at) fail('ไม่พบรายการเงินที่ยกเลิกได้');
    payment.voided_at = now; payment.void_reason = text(action.reason, 'เหตุผลการยกเลิก', 500);
    return trip;
  }
  if (trip.status !== 'OPEN') fail('ทริปจบแล้ว กรุณาเปิดทริปอีกครั้งก่อนแก้ผลงาน', 409);
  if (action.type === 'UPDATE') {
    const selected = vehicleSelection(action.vehicle_ids);
    if (trip.days.some(d => !selected.some(v => v.id === d.vehicle_id))) fail('รถที่ลงงานแล้วต้องอยู่ในทริป');
    trip.location = text(action.location, 'พื้นที่'); trip.broker_name = text(action.broker_name, 'ชื่อนายหน้า', 200, false);
    trip.vehicles = selected; trip.price_per_rai = positiveMoney(action.price_per_rai, 'ค่าเกี่ยวต่อไร่', 100000);
    trip.note = text(action.note, 'หมายเหตุ', 2000, false);
    return trip;
  }
  if (action.type !== 'DAY_SAVE') fail('ไม่รองรับรายการนี้');
  if (!uuid(action.id)) fail('รหัสวันทำงานไม่ถูกต้อง');
  const workDate = date(action.work_date), vehicleId = String(action.vehicle_id);
  if (workDate < trip.start_date) fail('วันทำงานต้องไม่ก่อนเริ่มทริป');
  if (!trip.vehicles.some(v => v.id === vehicleId)) fail('รถนี้ไม่ได้อยู่ในทริป');
  if (trip.days.some(d => d.id !== action.id && d.work_date === workDate && d.vehicle_id === vehicleId)) fail('รถคันนี้ลงยอดวันนี้แล้ว ให้แก้รายการเดิมแทน', 409);
  const old = trip.days.find(d => d.id === action.id);
  const names = namesOf(action.worker_names);
  const keepCrew = old && old.crew.length === names.length && old.crew.every(p => names.includes(p.name));
  const crew = keepCrew ? old.crew.map(({ name, role, rate }) => ({ name, role, rate })) : splitCrew(names, profiles);
  const confirmedRai = Math.round(number(action.confirmed_rai, 'ไร่ที่นายหน้ายืนยัน', 100000) * 10000) / 10000;
  if (confirmedRai <= 0) fail('ยอดไร่ต้องไม่น้อยกว่า 0.0001 ไร่');
  const price = positiveMoney(action.price_per_rai, 'ค่าเกี่ยวต่อไร่', 100000);
  const plotCount = number(action.plot_count, 'จำนวนแปลง', 10000, true);
  const keys = action.gps_keys || [];
  if (!Array.isArray(keys) || new Set(keys).size !== keys.length || keys.length > 200) fail('รายการแปลง GPS ไม่ถูกต้องหรือเลือกซ้ำ');
  const snapshots = keys.map(key => {
    const current = gpsPlots.find(p => p.key === key);
    const saved = old?.gps_plots.find(p => p.key === key && old.work_date === workDate && old.vehicle_id === vehicleId);
    const p = current || saved;
    if (!p || String(p.vehicle_id) !== vehicleId || p.work_date !== workDate) fail('แปลง GPS เปลี่ยนไป กรุณาโหลดใหม่ก่อนบันทึก', 409);
    if (current?.job_id != null) fail('แปลงนี้ผูกกับคิวลูกค้าในพื้นที่แล้ว ไม่สามารถนำมาลงซ้ำ');
    if (trip.days.some(d => d.id !== action.id && d.gps_plots.some(p => p.key === key))) fail('แปลงนี้ใช้ในวันทำงานอื่นแล้ว');
    return structuredClone(p);
  });
  if (new Set(snapshots.map(p => p.group_key || p.key)).size > plotCount) fail('จำนวนแปลง GPS ที่เลือกต้องไม่เกินจำนวนแปลงวันนี้');
  const day = { id: action.id, work_date: workDate, vehicle_id: vehicleId,
    vehicle_name: trip.vehicles.find(v => v.id === vehicleId).name, plot_count: plotCount,
    confirmed_rai: confirmedRai, price_per_rai: price, gps_plots: snapshots,
    gps_rai: Math.round(snapshots.reduce((s, p) => s + p.area_rai, 0) * 10000) / 10000,
    note: text(action.note, 'หมายเหตุ', 2000, false), created_at: old?.created_at || now, updated_at: now,
    ...dayAmounts(confirmedRai, price, crew) };
  trip.days = [...trip.days.filter(d => d.id !== day.id), day].sort((a, b) => a.work_date.localeCompare(b.work_date) || a.vehicle_id.localeCompare(b.vehicle_id));
  if (trip.days.length > 2000 || trip.payments.length > 5000) fail('ทริปมีรายการมากเกินไป กรุณาเริ่มทริปใหม่');
  return trip;
}
module.exports = { applyAction, summarizeTrip, splitCrew, dayAmounts, uuid, date, money, gpsPlotGroupKey };
