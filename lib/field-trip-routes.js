'use strict';
const { createHash } = require('node:crypto');
const { applyAction, summarizeTrip, uuid, date, gpsPlotGroupKey } = require('./field-trips');

const present = row => ({ id: row.id, revision: row.revision, ...row.document, summary: summarizeTrip(row.document) });
const unwrap = result => { if (result.error) throw result.error; return result.data; };
function supabaseStore(db) {
  return {
    async list() {
      const rows = [];
      for (let offset = 0; ; offset += 100) {
        const page = unwrap(await db.from('field_trips').select('*').order('created_at', { ascending: false }).order('id').range(offset, offset + 99));
        rows.push(...page);
        if (page.length < 100) return rows;
      }
    },
    async get(id) { return unwrap(await db.from('field_trips').select('*').eq('id', id).maybeSingle()); },
    async request(id) { return unwrap(await db.from('field_trip_events').select('trip_id,request_hash,result').eq('request_id', id).maybeSingle()); },
    async save(args) { return unwrap(await db.rpc('save_field_trip', args)); },
    async vehicles() { return unwrap(await db.from('vehicles').select('id,name')); },
    async profiles() { return unwrap(await db.from('wage_workers').select('name,role')); },
    async plots(vehicle, day) {
      const row = unwrap(await db.from('harvest_plots').select('plots_data').eq('vehicle_id', vehicle).eq('work_date', day)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle());
      return row?.plots_data || [];
    }
  };
}
function registerFieldTrips(app, { store, isBoss, normalizePlots, geometry, center, fieldAliases = async () => ({}) }) {
  const readGps = async (vehicle, day) => {
    date(day);
    if (!Number.isSafeInteger(Number(vehicle)) || Number(vehicle) <= 0) throw Object.assign(new Error('รถไม่ถูกต้อง'), { status: 400 });
    const raw = await store.plots(vehicle, day);
    const aliases = await fieldAliases(vehicle, day, raw);
    const plots = [], invalid = [];
    // One invalid polygon must not erase all other references or block manual daily entries.
    for (const [index, source] of raw.entries()) {
      try {
        const plot = normalizePlots([{ ...source, id: source.id || `legacy-${vehicle}-${day}-${index}` }], vehicle, day)[0];
        const shape = geometry(plot);
        plots.push({ id: plot.id, key: `${vehicle}/${day}/${plot.id}`, vehicle_id: String(vehicle), work_date: day,
          group_key: gpsPlotGroupKey(plot, vehicle, day, aliases),
          name: plot.name, job_id: plot.job_id, area_rai: shape.netSqM / 1600,
          center: center(shape.net || shape.outer), preview_geometry: shape.net?.geometry || null });
      } catch { invalid.push(source.name || `แปลงที่ ${index + 1}`); }
    }
    return { plots, invalid };
  };
  const handle = fn => async (req, res) => {
    try { await fn(req, res); } catch (error) {
      let status = error.status || 503, message = error.message;
      if (/FIELD_TRIP_CONFLICT/.test(message)) { status = 409; message = 'มีการแก้ไขทริปจากอีกหน้าจอ กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกใหม่'; }
      else if (/FIELD_TRIP_WAGE_ALREADY_SETTLED/.test(message)) { status = 409; message = 'ค่าแรงวันนี้ถูกจ่ายแบบรายบิลไปแล้ว กรุณาตรวจสมุดค่าแรงก่อนแก้ยอด'; }
      else if (/FIELD_TRIP_REQUEST_REUSED/.test(message)) { status = 409; message = 'รหัสบันทึกซ้ำกับรายการอื่น กรุณาโหลดข้อมูลใหม่'; }
      else if (error.code === '23505') { status = 409; message = 'แปลง GPS นี้ถูกใช้ในทริปอื่นแล้ว กรุณาเลือกแปลงที่ยังไม่ลงยอด'; }
      else if (['42P01', 'PGRST202', 'PGRST205', '42501'].includes(error.code)) message = 'โหมดออกพื้นที่ยังไม่พร้อม กรุณาให้ผู้ดูแลติดตั้งส่วนจัดเก็บข้อมูลก่อน';
      console.error('Field trip request:', error.code || status, error.message);
      res.status(status).json({ error: message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่' });
    }
  };
  app.get('/api/field-trips', handle(async (_req, res) => {
    res.set('Cache-Control', 'no-store').json((await store.list()).map(present));
  }));
  app.get('/api/field-trips/gps/:vehicle', handle(async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await readGps(req.params.vehicle, req.query.date));
  }));
  app.get('/api/field-trips/:id', handle(async (req, res) => {
    if (!uuid(req.params.id)) return res.status(400).json({ error: 'รหัสทริปไม่ถูกต้อง' });
    const row = await store.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบทริป' });
    res.set('Cache-Control', 'no-store').json(present(row));
  }));
  app.post('/api/field-trips/:id/actions', handle(async (req, res) => {
    if (!isBoss(req)) return res.status(403).json({ error: 'กรุณาเข้าโหมดเถ้าแก่ก่อนบันทึกยอดงานและรายการเงิน' });
    const { request_id, revision, action } = req.body || {};
    if (!uuid(req.params.id) || !uuid(request_id) || !Number.isInteger(revision) || revision < 0 || !action || typeof action.type !== 'string') {
      return res.status(400).json({ error: 'ข้อมูลบันทึกไม่ครบ กรุณาโหลดหน้าใหม่' });
    }
    const requestHash = createHash('sha256').update(JSON.stringify({ id: req.params.id, revision, action })).digest('hex');
    const prior = await store.request(request_id);
    if (prior) {
      if (prior.trip_id !== req.params.id || prior.request_hash !== requestHash) return res.status(409).json({ error: 'รหัสบันทึกถูกใช้กับข้อมูลอื่นแล้ว' });
      return res.json(present(prior.result));
    }
    const row = await store.get(req.params.id);
    if ((row?.revision || 0) !== revision) return res.status(409).json({ error: 'ข้อมูลทริปเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก' });
    const [vehicles, profiles] = await Promise.all([store.vehicles(), store.profiles()]);
    let gpsPlots = [];
    if (action.type === 'DAY_SAVE' && action.gps_keys?.length) {
      gpsPlots = (await readGps(action.vehicle_id, action.work_date)).plots;
    }
    const document = applyAction(row?.document || null, action, { vehicles, profiles, gpsPlots });
    const result = await store.save({ p_id: req.params.id, p_revision: revision, p_document: document,
      p_request_id: request_id, p_request_hash: requestHash, p_action_type: action.type });
    res.json(present(result));
  }));
}
module.exports = { registerFieldTrips, supabaseStore, present };
