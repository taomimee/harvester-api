import { useCallback, useEffect, useRef, useState } from 'react';
import './field-trips.css';
import { prepareFieldGpsDay } from './gps-auto-import.mjs';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const amount = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const dayLabel = d => new Date(`${d}T12:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
const roles = { DRIVER: 'คนขับ', HELPER: 'เด็กรถเป็นงาน', TRAINEE: 'เด็กฝึกงาน' };
function Metric({ label, value, hint, accent }) {
  return <div className={`ft-metric ${accent ? 'ft-accent' : ''}`}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>;
}
function PlotShape({ plot }) {
  const geometry = plot.preview_geometry;
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const points = polygons.flat(2);
  if (!points.length) return <span className="ft-plot-empty">GPS</span>;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX || 0.001, h = Math.max(...ys) - minY || 0.001;
  const scale = Math.min(80 / w, 48 / h);
  return <svg viewBox="0 0 100 68" aria-label={`ขอบแปลง ${plot.name}`} role="img">{polygons.map((rings, i) => <path key={i} d={rings.map(ring => ring.map((p, j) => `${j ? 'L' : 'M'}${10 + (p[0] - minX) * scale},${58 - (p[1] - minY) * scale}`).join(' ') + 'Z').join(' ')} fill="#c7dfc4" fillRule="evenodd" stroke="#43633e" strokeWidth="1.5" />)}</svg>;
}
export default function FieldTrips({ api, visible, vehicles, profiles, userRole, getToken, onOpenWages, onOpenMap, onChange, gpsEntry }) {
  const [trips, setTrips] = useState([]), [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('OPEN'), [modal, setModal] = useState(null);
  const [draft, setDraft] = useState({}), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [gps, setGps] = useState({ plots: [], invalid: [] }), [gpsBusy, setGpsBusy] = useState(false), [gpsError, setGpsError] = useState('');
  const [handledGpsEntry, setHandledGpsEntry] = useState(null);
  const pending = useRef(null), saving = useRef(false), changeCallback = useRef(onChange), loadSequence = useRef(0);
  useEffect(() => { changeCallback.current = onChange; }, [onChange]);
  const trip = trips.find(t => t.id === selected);
  const canWrite = userRole === 'BOSS';
  const fetchTrips = useCallback(async () => {
    const response = await fetch(`${api}/field-trips`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data)) throw new Error(data.error || 'โหลดทริปไม่สำเร็จ');
    return data;
  }, [api]);
  const load = async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setLoadError('');
    try {
      const data = await fetchTrips();
      if (sequence !== loadSequence.current) return;
      setTrips(data); changeCallback.current?.(data);
    } catch (e) { if (sequence === loadSequence.current) setLoadError(e.message || 'เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง'); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  };
  useEffect(() => {
    let cancelled = false;
    const sequence = ++loadSequence.current;
    fetchTrips().then(data => {
      if (cancelled || sequence !== loadSequence.current) return;
      setTrips(data); setLoadError(''); changeCallback.current?.(data);
    }).catch(e => {
      if (!cancelled && sequence === loadSequence.current) setLoadError(e.message || 'โหลดทริปไม่สำเร็จ');
    }).finally(() => { if (!cancelled && sequence === loadSequence.current) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, fetchTrips]);

  useEffect(() => {
    if (modal !== 'day' || !draft.vehicle_id || !draft.work_date) return;
    const controller = new AbortController();
    fetch(`${api}/field-trips/gps/${draft.vehicle_id}?date=${draft.work_date}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(data => { if (!controller.signal.aborted) setGps(data); })
      .catch(e => { if (!controller.signal.aborted) setGpsError(e.message || 'โหลด GPS ไม่สำเร็จ'); })
      .finally(() => { if (!controller.signal.aborted) setGpsBusy(false); });
    return () => controller.abort();
  }, [api, modal, draft.vehicle_id, draft.work_date]);

  const open = (type, value) => { setError(''); setNotice(''); pending.current = null; setUncertain(false); setDraft(value); setModal(type); };
  const openTrip = editing => open(editing ? 'edit' : 'create', editing ? { ...editing, vehicle_id: editing.vehicles[0].id } : {
    id: crypto.randomUUID(), location: '', broker_name: '', start_date: today(), vehicle_id: vehicles.length === 1 ? String(vehicles[0].id) : '', price_per_rai: '', note: ''
  });
  const resetGps = () => { setGps({ plots: [], invalid: [] }); setGpsBusy(true); setGpsError(''); };
  const openDay = day => { resetGps(); open('day', day ? { ...day, worker_names: day.crew.map(w => w.name), gps_keys: day.gps_plots.map(p => p.key) } : {
    id: crypto.randomUUID(), work_date: today(), vehicle_id: trip.vehicles[0].id, plot_count: '', confirmed_rai: '',
    price_per_rai: trip.price_per_rai, worker_names: trip.days.at(-1)?.crew.map(p => p.name) || [], gps_keys: [], note: ''
  }); };
  const openPayment = () => open('payment', { id: crypto.randomUUID(), kind: 'BROKER_RECEIPT', payment_date: today(), amount: '', note: '' });
  const openGpsEntry = target => {
    try {
      const value = prepareFieldGpsDay(target,gpsEntry,crypto.randomUUID());
      setSelected(target.id); resetGps(); open('day',value); setHandledGpsEntry(gpsEntry.request_id);
    } catch(e) { setNotice(e.message); }
  };
  const save = async action => {
    if (saving.current) return;
    let token;
    try { token = getToken(); if (!token) throw new Error('กรุณาเข้าโหมดเถ้าแก่ก่อนบันทึก'); }
    catch (e) { setError(e.message); return; }
    if (!pending.current) pending.current = {
      id: modal === 'create' ? draft.id : trip.id,
      body: { request_id: crypto.randomUUID(), revision: modal === 'create' ? 0 : trip.revision, action }
    };
    saving.current = true; setBusy(true); setError('');
    try {
      const request = pending.current;
      const response = await fetch(`${api}/field-trips/${request.id}/actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(request.body)
      });
      const data = await response.json();
      if (!response.ok) {
        pending.current = null; setUncertain(false);
        throw Object.assign(new Error(data.error || 'บันทึกไม่สำเร็จ'), { confirmedFailure: true });
      }
      const updated = [data, ...trips.filter(t => t.id !== data.id)];
      ++loadSequence.current; setLoading(false);
      setTrips(updated); setSelected(data.id); setFilter(data.status); setModal(null);
      setNotice(action?.type === 'DAY_SAVE' || request.body.action.type === 'DAY_SAVE' ? 'ปิดงานวันนี้แล้ว ค่าแรงเข้ายอดสะสมเดิมเรียบร้อย' : 'บันทึกเรียบร้อย');
      pending.current = null; setUncertain(false);
      changeCallback.current?.(updated);
    } catch (e) {
      if (!e.confirmedFailure) { setUncertain(true); setError('ยังยืนยันผลการบันทึกไม่ได้ กดตรวจสอบและบันทึกซ้ำ ระบบจะใช้รายการเดิมเพื่อป้องกันยอดซ้ำ'); }
      else setError(e.message);
    } finally { saving.current = false; setBusy(false); }
  };
  const submit = event => {
    event.preventDefault();
    const action = modal === 'create' || modal === 'edit' ? { ...draft, type: modal === 'create' ? 'CREATE' : 'UPDATE', vehicle_ids: [draft.vehicle_id] }
      : modal === 'day' ? { ...draft, type: 'DAY_SAVE' }
      : modal === 'payment' ? { ...draft, type: 'PAYMENT_ADD' }
      : modal === 'void' ? { ...draft, type: 'PAYMENT_VOID' }
      : modal === 'reopen' ? { type: 'REOPEN' } : { ...draft, type: 'CLOSE' };
    save(action);
  };
  const field = (name, value) => setDraft(d => ({ ...d, [name]: value }));
  const titles = { create: 'เริ่มทริปออกพื้นที่', edit: 'แก้ข้อมูลทริป', day: 'ปิดยอดงานรายวัน', payment: 'รับเงินจากนายหน้า', void: 'ยกเลิกรายการรับเงิน', close: 'จบทริป', reopen: 'เปิดทริปอีกครั้ง' };
  const existingDay = trip?.days.find(d => d.id === draft.id);
  const draftPlots = [...gps.plots];
  for (const p of existingDay?.gps_plots || []) if (!draftPlots.some(g => g.key === p.key) && p.work_date === draft.work_date) draftPlots.push(p);
  const workerChoices = [...profiles.filter(p => !p.needsSetup)];
  for (const p of existingDay?.crew || []) if (!workerChoices.some(w => w.name === p.name)) workerChoices.push(p);

  return <section className="field-trips" aria-label="งานนอกพื้นที่">
    <header className="ft-header"><div><p className="ft-eyebrow">สมุดงานออกพื้นที่</p><h2>{trip ? trip.location : 'ออกงานนอกพื้นที่'}</h2>
      <p>{trip ? `${trip.vehicles[0].name} · เริ่ม ${dayLabel(trip.start_date)}${trip.end_date ? ` · จบ ${dayLabel(trip.end_date)}` : ' · ยังไม่กำหนดวันกลับ'}` : 'ปิดยอดทุกวัน รับเงินตามรอบที่เบิก จบทริปเมื่อกลับ'}</p></div>
      {trip ? <button className="ft-button" onClick={() => { setSelected(null); setNotice(''); }}>ทริปทั้งหมด</button> : canWrite && <button className="ft-button ft-primary" onClick={() => openTrip()}>+ เริ่มทริป</button>}
    </header>
    {loadError && <div className="ft-error" role="alert">{loadError} <button onClick={load}>ลองโหลดอีกครั้ง</button></div>}
    {notice && <p className="ft-success" role="status">{notice}</p>}
    {loading && <p role="status">กำลังโหลดทริป…</p>}
    {visible && canWrite && gpsEntry && handledGpsEntry !== gpsEntry.request_id && <div className="ft-note" role="region" aria-label="ใช้แปลงออโต้ในทริป">
      <strong>ใช้แปลงออโต้ของวันที่ {dayLabel(gpsEntry.work_date)}</strong>
      <p>เลือกทริปเพื่อผูกกับยอดรายวัน ยอดไร่ที่เคยยืนยันไว้จะคงเดิม</p>
      {!loading && !trips.some(t=>t.status==='OPEN' && t.vehicles.some(v=>String(v.id)===String(gpsEntry.vehicle_id)) && t.start_date<=gpsEntry.work_date) && <p>ยังไม่มีทริปที่ตรงกับรถและวันที่นี้ ให้เริ่มทริปหรือเปิดทริปเดิมก่อน</p>}
      {trips.filter(t=>t.status==='OPEN' && t.vehicles.some(v=>String(v.id)===String(gpsEntry.vehicle_id)) && t.start_date<=gpsEntry.work_date).map(t=><button key={t.id} className="ft-button ft-primary" onClick={()=>openGpsEntry(t)}>ลงยอดที่ {t.location}</button>)}
      <button className="ft-button" onClick={()=>setHandledGpsEntry(gpsEntry.request_id)}>ไว้ก่อน</button>
    </div>}
    {!trip ? <>
      <div className="ft-tabs"><button aria-pressed={filter === 'OPEN'} onClick={() => setFilter('OPEN')}>กำลังออกงาน ({trips.filter(t => t.status === 'OPEN').length})</button><button aria-pressed={filter === 'CLOSED'} onClick={() => setFilter('CLOSED')}>จบทริปแล้ว</button></div>
      {!loading && !loadError && !trips.some(t => t.status === filter) && <div className="ft-empty"><h3>{filter === 'OPEN' ? 'ยังไม่มีทริปที่เปิดอยู่' : 'ยังไม่มีทริปที่จบแล้ว'}</h3><p>หนึ่งทริปใช้รถหนึ่งคัน ลงผลงานรายวันได้โดยไม่ต้องเพิ่มชื่อลูกค้า</p>{canWrite && <button className="ft-button ft-primary" onClick={() => openTrip()}>เริ่มทริปแรก</button>}</div>}
      <div className="ft-trip-list">{trips.filter(t => t.status === filter).map(t => <button className="ft-trip-card" key={t.id} onClick={() => { setSelected(t.id); setNotice(''); }}>
        <span className="ft-status">{t.status === 'OPEN' ? 'กำลังออกงาน' : 'จบทริปแล้ว'}</span><h3>{t.location}</h3><p>{t.vehicles[0].name} · {dayLabel(t.start_date)}</p>
        <strong>{amount(t.summary.rai)} ไร่ <span> / {t.summary.plots} แปลง</span></strong><p>{t.summary.broker_balance >= 0 ? 'ค้างรับจากนายหน้า' : 'รับล่วงหน้าเหลือ'} {amount(Math.abs(t.summary.broker_balance))} บาท</p>
      </button>)}</div>
    </> : <>
      <div className="ft-trip-meta"><span className="ft-status">{trip.status === 'OPEN' ? 'กำลังออกงาน' : 'จบทริปแล้ว'}</span><span>{trip.broker_name ? `นายหน้า: ${trip.broker_name}` : 'ยังไม่ระบุชื่อนายหน้า'}</span>{canWrite && trip.status === 'OPEN' && <button onClick={() => openTrip(trip)}>แก้ข้อมูลทริป</button>}</div>
      <div className="ft-metrics"><Metric label="ผลงานสะสม" value={`${amount(trip.summary.rai)} ไร่`} hint={`${trip.summary.plots} แปลง · ${trip.summary.work_days} วัน`} />
        <Metric label="ค่าเกี่ยวสะสม" value={`${amount(trip.summary.earned)} ฿`} hint="จากยอดไร่ที่นายหน้ายืนยัน" />
        <Metric label="รับจากนายหน้าแล้ว" value={`${amount(trip.summary.received)} ฿`} hint="เฉพาะเงินที่ได้รับจริง" />
        <Metric accent label={trip.summary.broker_balance >= 0 ? 'ค้างรับจากนายหน้า' : 'เงินรับล่วงหน้าคงเหลือ'} value={`${amount(Math.abs(trip.summary.broker_balance))} ฿`} hint="รับครบวันนี้แล้วทำงานต่อได้" /></div>
      <div className="ft-actions">{canWrite && trip.status === 'OPEN' && <button className="ft-button ft-primary" onClick={() => openDay()}>+ ปิดยอดวันนี้</button>}
        {canWrite && <button className="ft-button" onClick={openPayment}>รับเงิน / เบิกจากนายหน้า</button>}<button className="ft-button" onClick={() => onOpenWages()}>ค่าแรง / คนขับเบิกเงิน</button></div>
      <div className="ft-note">ค่าแรง {amount(trip.summary.wages)} บาท เข้าสมุดค่าแรงเดิมแล้วตามวันที่ปิดงาน คนขับเบิกจากยอดสะสมของตนได้ตามปกติ แม้เถ้าแก่ยังไม่ได้รับเงินจากนายหน้า</div>
      <div className="ft-section-heading"><h3>ผลงานรายวัน</h3><span>ยอดไร่ที่ยืนยันใช้คิดค่าเกี่ยวและค่าแรง</span></div>
      {!trip.days.length && <p className="ft-empty">ยังไม่ได้ลงยอดรายวัน เมื่อเกี่ยวเสร็จให้ลงจำนวนแปลงและยอดไร่ที่นายหน้าแจ้ง</p>}
      <div className="ft-days">{[...trip.days].reverse().map(d => <article className="ft-day" key={d.id}>
        <div className="ft-row"><h4>{dayLabel(d.work_date)}</h4><span className="ft-closed">ปิดงานแล้ว</span>{canWrite && trip.status === 'OPEN' && <button onClick={() => openDay(d)}>แก้ยอดวันนี้</button>}</div>
        <div className="ft-day-total"><strong>{d.plot_count} แปลง · {amount(d.confirmed_rai)} ไร่</strong><span>ค่าเกี่ยว {amount(d.harvest_amount)} บาท</span></div>
        <p>ค่าเกี่ยว {amount(d.price_per_rai)} บาท/ไร่ · ค่าแรง {amount(d.wage_amount)} บาท</p>
        <div className="ft-crew">{d.crew.map(w => <button key={w.name} onClick={() => onOpenWages(w.name)}>{w.name} · {amount(w.amount)} ฿ ↗</button>)}</div>
        {!!d.gps_plots.length && <><p className="ft-gps-caption">GPS อ้างอิง {new Set(d.gps_plots.map(p=>p.group_key || p.key)).size} แปลง · {amount(d.gps_rai)} ไร่</p><div className="ft-plots">{d.gps_plots.map(p => <button key={p.key} onClick={() => onOpenMap(p)}><PlotShape plot={p}/><span>{p.name}</span><small>{amount(p.area_rai)} ไร่</small></button>)}</div></>}
        {d.note && <p className="ft-day-note">{d.note}</p>}
      </article>)}</div>
      <div className="ft-section-heading"><h3>เงินรับจากนายหน้า</h3><span>เบิกบางส่วนหรือตัดยอดที่ค้างทั้งหมดได้</span></div>
      {!trip.payments.length && <p className="ft-empty">ยังไม่ได้รับเงิน ค่าเกี่ยวสะสมยังค้างอยู่กับนายหน้า</p>}
      <div className="ft-payments">{[...trip.payments].reverse().map(p => <div className={`ft-payment ${p.voided_at ? 'ft-voided' : ''}`} key={p.id}>
        <div><strong>{amount(p.amount)} บาท</strong><p>{dayLabel(p.payment_date)}{p.note ? ` · ${p.note}` : ''}</p>{p.voided_at && <small>ยกเลิก: {p.void_reason}</small>}</div>
        {!p.voided_at && canWrite && <button onClick={() => open('void', { id: p.id, reason: '' })}>ลงผิด / ยกเลิก</button>}
      </div>)}</div>
      {trip.note && <p className="ft-note">หมายเหตุทริป: {trip.note}</p>}
      {canWrite && <div className="ft-footer"><p>{trip.status === 'OPEN' ? 'ทำงานต่อได้ทุกวัน จบทริปเมื่อเลิกออกงานครั้งนี้' : 'ทริปจบแล้ว ยังลงเงินที่นายหน้าจ่ายภายหลังได้'}</p><button className="ft-button" onClick={() => open(trip.status === 'OPEN' ? 'close' : 'reopen', { end_date: today() })}>{trip.status === 'OPEN' ? 'จบทริป / กลับพื้นที่' : 'เปิดทริปอีกครั้ง'}</button></div>}
    </>}

    {modal && <div className="ft-overlay"><section role="dialog" aria-modal="true" aria-labelledby="ft-dialog-title" className="ft-dialog">
      <div className="ft-row"><h3 id="ft-dialog-title">{titles[modal]}</h3><button type="button" aria-label="ปิดหน้าบันทึก" disabled={busy || uncertain} onClick={() => setModal(null)}>✕</button></div>
      <form onSubmit={submit}>
        <fieldset disabled={busy || uncertain}>
          {(modal === 'create' || modal === 'edit') && <>
            <label>พื้นที่ออกงาน<input required autoFocus maxLength={200} placeholder="เช่น ลพบุรี" value={draft.location} onChange={e => field('location', e.target.value)} /></label>
            <label>นายหน้า (ถ้ามี)<input maxLength={200} value={draft.broker_name} onChange={e => field('broker_name', e.target.value)} /></label>
            <label>รถที่ออกงาน<select required value={draft.vehicle_id} onChange={e => field('vehicle_id', e.target.value)}><option value="">เลือกรถ</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
            {modal === 'create' && <label>วันเริ่มทริป<input required type="date" value={draft.start_date} onChange={e => field('start_date', e.target.value)} /></label>}
            <label>ค่าเกี่ยวตั้งต้น (บาท/ไร่)<input required type="number" min="0.01" max="100000" step="0.01" value={draft.price_per_rai} onChange={e => field('price_per_rai', e.target.value)} /></label>
            <p className="ft-help">ยังไม่ต้องกำหนดวันกลับ ค่าเกี่ยวปรับได้ตอนลงยอดแต่ละวัน</p>
            <label>หมายเหตุ<textarea maxLength={2000} value={draft.note} onChange={e => field('note', e.target.value)} /></label>
          </>}
          {modal === 'day' && <>
            <p className="ft-help">{trip.vehicles[0].name} · ปิดงานวันนี้แล้ว ค่าแรงจะเข้ายอดสะสมของคนทำงานทันที</p>
            <label>วันที่ทำงาน<input required type="date" min={trip.start_date} value={draft.work_date} onChange={e => { resetGps(); setDraft(d => ({ ...d, work_date: e.target.value, gps_keys: [] })); }} /></label>
            <div className="ft-form-grid"><label>จำนวนแปลงวันนี้<input autoFocus required type="number" min="1" max="10000" step="1" value={draft.plot_count} onChange={e => field('plot_count', e.target.value)} /></label>
              <label>ไร่ที่นายหน้ายืนยัน<input required type="number" min="0.0001" max="100000" step="0.0001" value={draft.confirmed_rai} onChange={e => field('confirmed_rai', e.target.value)} /></label></div>
            <label>ค่าเกี่ยว (บาท/ไร่)<input required type="number" min="0.01" max="100000" step="0.01" value={draft.price_per_rai} onChange={e => field('price_per_rai', e.target.value)} /></label>
            <fieldset className="ft-worker-picker"><legend>คนทำงานวันนี้</legend>{workerChoices.map(w => <label key={w.name}><input type="checkbox" checked={draft.worker_names.includes(w.name)} onChange={e => field('worker_names', e.target.checked ? [...draft.worker_names, w.name] : draft.worker_names.filter(n => n !== w.name))} /><span>{w.name}<small>{roles[w.role] || 'ยังไม่ตั้งระดับ'}</small></span></label>)}{!workerChoices.length && <p>ยังไม่มีทะเบียนคนงาน ให้ตั้งระดับค่าแรงในสมุดค่าแรงก่อน</p>}</fieldset>
            <p className="ft-help">ค่าแรงรวม 60 บาท/ไร่ แบ่งตามระดับคนงานเดิม</p>
            <div className="ft-calc"><span>ค่าเกี่ยววันนี้ <strong>{amount(Number(draft.confirmed_rai) * Number(draft.price_per_rai))} ฿</strong></span><span>ค่าแรงวันนี้ <strong>{amount(Number(draft.confirmed_rai) * 60)} ฿</strong></span></div>
            <details className="ft-gps-picker" open={draft.gps_keys.length > 0 ? true : undefined}><summary>แปลง GPS อ้างอิง (เลือกได้)</summary>
              <p className="ft-help">ใช้เทียบกับผลงานวันนี้ ยอดคิดเงินใช้ไร่ที่นายหน้ายืนยัน</p>{gpsBusy && <p role="status">กำลังโหลดแปลง…</p>}{gpsError && <p className="ft-error">{gpsError} ยังลงยอดที่นายหน้าแจ้งโดยไม่เลือก GPS ได้</p>}
              {!gpsBusy && !gpsError && !draftPlots.length && <p>ยังไม่มีแปลง GPS ที่บันทึกไว้สำหรับรถและวันที่นี้</p>}
              {draftPlots.map(p => <label className="ft-gps-option" key={p.key}><input type="checkbox" disabled={p.job_id != null} checked={draft.gps_keys.includes(p.key)} onChange={e => field('gps_keys', e.target.checked ? [...draft.gps_keys, p.key] : draft.gps_keys.filter(k => k !== p.key))} /><PlotShape plot={p}/><span>{p.name}<small>{amount(p.area_rai)} ไร่{p.job_id != null ? ' · อยู่ในคิวลูกค้าแล้ว' : ''}</small></span></label>)}
              {gps.invalid.length > 0 && <p className="ft-help">มี {gps.invalid.length} แปลงที่ขอบ GPS ยังไม่สมบูรณ์</p>}
            </details>
            <label>หมายเหตุ<textarea maxLength={2000} value={draft.note} onChange={e => field('note', e.target.value)} /></label>
            {existingDay && <p className="ft-help">การแก้ยอดจะปรับค่าแรงของวันเดิมในสมุดค่าแรง ไม่สร้างค่าแรงซ้ำ</p>}
          </>}
          {modal === 'payment' && <>
            <p className="ft-help">บันทึกเมื่อเถ้าแก่ได้รับเงินจริง การรับเงินครั้งนี้ยังคงเปิดทริปให้ทำงานต่อ</p>
            <label>วันที่รับเงิน<input required type="date" min={trip.start_date} value={draft.payment_date} onChange={e => field('payment_date', e.target.value)} /></label>
            <label>รับเงินจำนวน (บาท)<input autoFocus required type="number" min="0.01" max="100000000" step="0.01" value={draft.amount} onChange={e => field('amount', e.target.value)} /></label>
            {trip.summary.broker_balance > 0 && <button type="button" className="ft-button" onClick={() => field('amount', trip.summary.broker_balance)}>รับยอดค้างทั้งหมด {amount(trip.summary.broker_balance)} บาท</button>}
            {Number(draft.amount) > Math.max(0, trip.summary.broker_balance) && <p className="ft-help">ส่วนที่เกินยอดค้างจะเป็นเงินรับล่วงหน้าสำหรับงานต่อไป</p>}
            <label>หมายเหตุ<textarea maxLength={2000} placeholder="เช่น เบิกเงินระหว่างทริป / ตัดยอดถึงวันนี้" value={draft.note} onChange={e => field('note', e.target.value)} /></label>
          </>}
          {modal === 'void' && <><p>รายการเดิมจะยังอยู่ในประวัติ แต่ไม่นับเป็นยอดรับเงิน</p><label>เหตุผล<input autoFocus required maxLength={500} value={draft.reason} onChange={e => field('reason', e.target.value)} /></label></>}
          {modal === 'close' && <><p>ปิดทริปเมื่อเลิกออกงานครั้งนี้ ยอดค้างจากนายหน้ายังติดตามและรับเงินภายหลังได้</p><label>วันจบทริป<input required type="date" min={trip.days.at(-1)?.work_date || trip.start_date} value={draft.end_date} onChange={e => field('end_date', e.target.value)} /></label></>}
          {modal === 'reopen' && <p>เปิดทริป {trip.location} เพื่อลงผลงานรายวันต่อ ยอดรับเงินและค่าแรงเดิมยังอยู่ครบ</p>}
        </fieldset>
        {error && <div className="ft-error" role="alert">{error}{!uncertain && <button type="button" onClick={load}>โหลดข้อมูลล่าสุด</button>}</div>}
        <div className="ft-dialog-footer"><button type="button" className="ft-button" disabled={busy || uncertain} onClick={() => setModal(null)}>ยกเลิก</button>
          <button type={uncertain ? 'button' : 'submit'} className="ft-button ft-primary" disabled={busy || !canWrite} onClick={uncertain ? () => save() : undefined}>{busy ? 'กำลังบันทึก…' : uncertain ? 'ตรวจสอบและบันทึกซ้ำ' : modal === 'day' ? 'ปิดงานวันนี้และลงค่าแรง' : 'บันทึก'}</button></div>
      </form>
    </section></div>}
  </section>;
}
