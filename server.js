require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() }); // ให้ระบบพักไฟล์ไว้ในแรมก่อนส่งขึ้น Supabase
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
// Editable GPS boundaries and reviewed exclusion rings share the existing JSON column.
app.use('/api/plots', express.json({ limit: '2mb' }));
app.use('/api/gps-route-edits', express.json({ limit: '5mb' }));
app.use(express.json());

// เชื่อมต่อฐานข้อมูล Supabase
const supabaseUrl = process.env.SUPABASE_URL;

// 🔐 Backend ต้องใช้ Service Role เพื่อให้ API ที่เชื่อถือได้เขียนข้อมูลผ่าน RLS ได้
// ห้ามนำ SUPABASE_SERVICE_ROLE_KEY ไปใส่ใน React / Frontend เด็ดขาด
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseFallbackKey = process.env.SUPABASE_KEY;
const supabaseKey = supabaseServiceRoleKey || supabaseFallbackKey;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase ENV ไม่ครบ: ต้องมี SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY');
}

if (!supabaseServiceRoleKey) {
    console.warn('⚠️ ยังไม่ได้ตั้ง SUPABASE_SERVICE_ROLE_KEY — ตารางที่เปิด RLS เช่น harvest_plots อาจบันทึกไม่ได้');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});

app.get('/', (req, res) => {
    res.send(`🚀 ระบบคิวรถเกี่ยว (Harvester API) กำลังทำงาน! | Supabase backend key: ${supabaseServiceRoleKey ? 'SERVICE_ROLE ✅' : 'FALLBACK/ANON ⚠️'}`);
});

const turf = require('@turf/turf');
const plotNewId = () => require('crypto').randomUUID();
const plotClip = (operation, a, b) => {
  if (!a || !b) return operation === 'difference' ? a : null;
  try { return turf[operation](turf.featureCollection([a, b])); }
  catch (_) { return turf[operation](a, b); }
};

const plotThaiArea = (sqMeters) => {
  const value = Math.max(0, Number(sqMeters) || 0);
  const tenths = Math.round(value * 2.5);
  const rai = Math.floor(tenths / 4000);
  const ngan = Math.floor((tenths % 4000) / 1000);
  const wah = (tenths % 1000) / 10;
  return { text: `${rai} ไร่ ${ngan} งาน ${wah} ตร.ว.`, rawRai: value / 1600, sqMeters: value };
};

const plotRingFeature = (points) => {
  if (!Array.isArray(points) || points.length < 3) throw new Error('ต้องมีอย่างน้อย 3 จุด');
  const coords = [];
  for (const p of points) {
    if (p?.lng == null || p?.lat == null || p.lng === '' || p.lat === '') throw new Error('พิกัดไม่ถูกต้อง');
    const xy = [Number(p.lng), Number(p.lat)];
    if (!xy.every(Number.isFinite) || Math.abs(xy[0]) > 180 || Math.abs(xy[1]) > 90) throw new Error('พิกัดไม่ถูกต้อง');
    const last = coords[coords.length - 1];
    if (!last || last[0] !== xy[0] || last[1] !== xy[1]) coords.push(xy);
  }
  if (coords.length > 1 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]) coords.pop();
  if (coords.length < 3) throw new Error('ต้องมีอย่างน้อย 3 มุมที่ไม่ซ้ำกัน');
  const feature = turf.polygon([[...coords, coords[0]]]);
  if (turf.kinks(feature).features.length) throw new Error('เส้นตัดกันเอง กรุณาลากจุดแก้ให้เป็นวง');
  if (turf.area(feature) < 1) throw new Error('พื้นที่ต้องมีอย่างน้อย 1 ตร.ม.');
  return feature;
};

// Exclusions are editable rings, not negative area numbers. Sequential clipping
// counts overlaps once, clips outside edges, and supports split MultiPolygons.
const plotGeometry = (plot) => {
  const outer = plotRingFeature(plot.points);
  let net = outer;
  for (const hole of (plot.holes || [])) {
    const cut = plotRingFeature(hole.points);
    net = plotClip('difference', net, cut);
    if (!net) break;
  }
  const grossSqM = turf.area(outer);
  const netSqM = net ? Math.min(grossSqM, Math.max(0, turf.area(net))) : 0;
  return { outer, net, grossSqM, netSqM, excludedSqM: Math.max(0, grossSqM - netSqM) };
};

const plotCenter = (feature) => {
  if (!feature) return null;
  let center = turf.centerOfMass(feature);
  if (!turf.booleanPointInPolygon(center, feature)) center = turf.pointOnFeature(feature);
  const [lng, lat] = center.geometry.coordinates;
  return { lat, lng, text: `${lat.toFixed(6)}, ${lng.toFixed(6)}` };
};

const refreshPlotMetrics = (plot) => {
  const geometry = plotGeometry(plot);
  if (geometry.netSqM < 1) throw new Error('พื้นที่หักครอบคลุมทั้งแปลง กรุณาปรับวงหักให้เล็กลง');
  return {
    ...plot, schema_version: 3,
    holes: plot.holes || [], holeSuggestions: plot.holeSuggestions || [],
    area: plotThaiArea(geometry.netSqM), grossArea: plotThaiArea(geometry.grossSqM),
    excludedArea: plotThaiArea(geometry.excludedSqM), center: plotCenter(geometry.net),
    geometryError: undefined
  };
};


const normalizeJobPlots = (plots, vehicle, date) => {
  const ids = new Set();
  return plots.map((plot, index) => {
    const id = plot.id || `legacy-${vehicle}-${date}-${index}`;
    if (typeof id !== 'string' || id.length > 120 || ids.has(id)) throw new Error('รหัสแปลงซ้ำหรือไม่ถูกต้อง');
    ids.add(id);
    if (plot.job_id != null && (!Number.isSafeInteger(Number(plot.job_id)) || Number(plot.job_id) <= 0)) throw new Error('คิวงานไม่ถูกต้อง');
    return refreshPlotMetrics({...plot, id, job_id: plot.job_id == null ? null : Number(plot.job_id), name: String(plot.name || `แปลงที่ ${index+1}`).slice(0,120)});
  });
};
const loadGpsJobSummary = async () => {
  const byJob = new Map(), scopes = new Set();
  for (let offset=0; ; offset+=500) {
    const {data,error} = await supabase.from('harvest_plots').select('id,vehicle_id,work_date,plots_data,created_at')
      .order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);
    if(error) throw error;
    for (const row of data || []) {
      const scope = `${row.vehicle_id}/${row.work_date}`;
      if(scopes.has(scope)) continue;
      scopes.add(scope);
      const ids = new Set();
      for(const [index,plot] of (Array.isArray(row.plots_data) ? row.plots_data : []).entries()) {
        if(!plot.job_id) continue;
        const id=plot.id || `legacy-${row.vehicle_id}-${row.work_date}-${index}`;
        if(ids.has(id)) continue;
        ids.add(id);
        const jobId=Number(plot.job_id);
        if(!byJob.has(jobId)) byJob.set(jobId,{plot_count:0,area_rai:0,plots:[],invalid_count:0});
        const group=byJob.get(jobId);
        try {
          const geometry=plotGeometry(plot), area=geometry.netSqM/1600;
          group.plot_count++;group.area_rai+=area;
          group.plots.push({id,name:plot.name || `แปลงที่ ${index+1}`,area_rai:area,vehicle_id:row.vehicle_id,work_date:row.work_date,center:plotCenter(geometry.net || geometry.outer)});
        } catch (_) { group.invalid_count++; }
      }
    }
    if(!data || data.length<500) return byJob;
  }
};

app.get('/api/jobs', async (req, res) => {
    const { data, error } = await supabase
        .from('jobs')
        .select(`
            *,
            customers ( name, phone, address_note ),
            vehicles ( name )
        `);

    if (error) return res.status(500).json({ error: error.message });

    // 🌾 แนบรอบทำงานของแต่ละคิว เพื่อให้หน้าเว็บรู้ว่า
    // วัดจริงแล้วกี่ไร่ / ลงค่าแรงแล้วกี่ไร่ / ทำมากี่รอบ
    let roundsByJob = new Map();
    const jobIds = (data || []).map(j => Number(j.id)).filter(Number.isFinite);

    if (jobIds.length > 0) {
        const { data: rounds, error: roundsError } = await supabase
            .from('job_work_rounds')
            .select('*')
            .in('job_id', jobIds)
            .order('work_date', { ascending: true });

        // ถ้ายังไม่ได้รัน migration ให้คิวเดิมยังเปิดได้ ไม่ทำหน้าเว็บล่มทั้งระบบ
        if (roundsError) {
            console.warn('⚠️ โหลด job_work_rounds ไม่สำเร็จ:', roundsError.message);
        } else {
            (rounds || []).forEach(round => {
                const key = Number(round.job_id);
                if (!roundsByJob.has(key)) roundsByJob.set(key, []);
                roundsByJob.get(key).push(round);
            });
        }
    }

    let gpsSummary = new Map(), gpsSummaryError = false;
    try { gpsSummary = await loadGpsJobSummary(); } catch (e) { gpsSummaryError = true; console.error('GPS job summary:', e.message); }
    res.json((data || []).map(job => {
        const work_rounds = roundsByJob.get(Number(job.id)) || [];
        const measured_area_total = work_rounds.reduce((sum, r) => sum + (Number(r.measured_area) || 0), 0);
        const wage_area_total = work_rounds.reduce((sum, r) => sum + (Number(r.wage_area) || 0), 0);
        return {
            ...job,
            gps_summary: gpsSummaryError ? null : (gpsSummary.get(Number(job.id)) || {plot_count:0,area_rai:0,plots:[],invalid_count:0}),
            gps_summary_error: gpsSummaryError,
            work_rounds,
            work_summary: {
                round_count: work_rounds.length,
                measured_area_total,
                wage_area_total
            }
        };
    }));
});

// API สำหรับเพิ่มคิวงานใหม่
app.post('/api/jobs', async (req, res) => {
    let { customer_name, phone, address_note, crop_type, area_size, job_date, latitude, longitude, vehicle_id, price_per_rai, total_price, payment_status } = req.body;

    // แปลงค่าว่างให้เป็น null หรือ 0 ป้องกัน Error ฐานข้อมูล
    area_size = area_size ? Number(area_size) : null;
    price_per_rai = price_per_rai ? Number(price_per_rai) : 0;
    total_price = total_price ? Number(total_price) : 0;

    try {
        let customerId;
        let existingCustomer = null;

        // 💡 1. ลองค้นหาจาก "เบอร์โทร" ก่อน (ถ้าลูกค้ากรอกมา)
        if (phone && phone.trim() !== "") {
            const { data } = await supabase.from('customers').select('id').eq('phone', phone);
            if (data && data.length > 0) existingCustomer = data[0];
        } 
        // 💡 2. ถ้าไม่ได้กรอกเบอร์ ให้ระบบค้นหาจาก "ชื่อลูกค้า" แทน 
        else if (customer_name && customer_name.trim() !== "") {
            const { data } = await supabase.from('customers').select('id').eq('name', customer_name);
            if (data && data.length > 0) existingCustomer = data[0];
        }

        if (existingCustomer) {
            // เจอลูกค้าเก่า ใช้ ID เดิม
            customerId = existingCustomer.id;
            // อัปเดตชื่อให้ล่าสุดเสมอ (และอัปเดตเบอร์เฉพาะถ้าเขากรอกมาใหม่)
            const updateData = { name: customer_name };
            if (phone && phone.trim() !== "") updateData.phone = phone;
            await supabase.from('customers').update(updateData).eq('id', customerId); 
        } else {
            // 💡 3. ถ้าเป็นลูกค้าใหม่จริงๆ และไม่ยอมให้เบอร์โทรมา 
            // ระบบจะสร้างเบอร์จำลอง (เช่น ไม่ระบุ-16928374) เพื่อป้องกันฐานข้อมูลฟ้องว่าเบอร์ซ้ำกัน
            const safePhone = (phone && phone.trim() !== "") ? phone : `ไม่มี-${Math.floor(Math.random() * 1000000)}`;

            const { data: newCustomer, error: custError } = await supabase
                .from('customers')
                .insert([{ name: customer_name, phone: safePhone }]) 
                .select()
                .single();
            if (custError) throw custError;
            customerId = newCustomer.id;
        }

        const { data: newJob, error: jobError } = await supabase
            .from('jobs')
            .insert([{
                customer_id: customerId,
                vehicle_id: vehicle_id || null,
                crop_type,
                area_size,
                job_date,
                latitude: latitude || 15.7001234,
                longitude: longitude || 101.1001234,
                status: 'PENDING',
                price_per_rai,
                total_price,
                payment_status: payment_status || 'UNPAID',
                address_note: address_note 
            }])
            .select();

        if (jobError) throw jobError;
        if (newJob?.[0]?.id) await writeJobAudit(newJob[0].id, 'JOB_CREATED', `สร้างคิวใหม่${area_size == null ? ' • ยังไม่ระบุยอดประมาณ' : ` • ลูกค้าแจ้งประมาณ ${area_size} ไร่`}`, null, newJob[0]);
        res.status(201).json({ message: 'บันทึกคิวงานสำเร็จ!', data: newJob });

    } catch (err) {
        console.error('API Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// API สำหรับอัปเดตเปลี่ยนสถานะงาน (เช่น กดเสร็จสิ้น หรือ กำลังเกี่ยว)
app.patch('/api/jobs/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status, wageData, job_date, payment_status, paid_at } = req.body || {};

    try {
        // กันหน้าเว็บรุ่นเก่าปิด DONE มาทับค่าแรงของระบบรอบทำงาน
        if (status === 'DONE' && wageData) {
            const { data: roundRows, error: roundCheckError } = await supabase
                .from('job_work_rounds')
                .select('id')
                .eq('job_id', id)
                .limit(1);

            if (!roundCheckError && roundRows && roundRows.length > 0) {
                return res.status(409).json({
                    error: 'งานนี้ใช้ระบบรอบทำงานแล้ว กรุณาปิดงานผ่าน /api/jobs/:id/finalize'
                });
            }
        }

        // 💡 อัปเดตเฉพาะ field ที่ส่งมา ป้องกัน status=undefined ไปทับฐานข้อมูล
        const updateData = {};
        if (status) updateData.status = status;
        if (job_date) updateData.job_date = job_date;
        if (payment_status) updateData.payment_status = payment_status;
        if (paid_at) updateData.paid_at = paid_at;
        if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'ไม่มีข้อมูลสำหรับอัปเดต' });

        // 1. อัปเดตสถานะงาน (และเวลาถ้ามี) ให้เป็น DONE, IN_PROGRESS ฯลฯ
        const { data: updatedJob, error: jobError } = await supabase
            .from('jobs')
            .update(updateData) // 👈 เปลี่ยนมาใช้กล่องข้อมูลที่เราเตรียมไว้
            .eq('id', id)
            .select()
            .single();

        if (jobError) throw jobError;
        await writeJobAudit(id, payment_status && !status ? 'PAYMENT_STATUS_CHANGED' : 'STATUS_CHANGED',
            `${status ? `สถานะงาน ${status}` : ''}${payment_status ? `${status ? ' • ' : ''}การเงิน ${payment_status}` : ''}${job_date ? ` • นัด ${job_date}` : ''}`, null, updatedJob);
        // 2. 💡 ถ้าสถานะคือ DONE และมีค่าแรง ให้บันทึก 1 บิลต่อ 1 job เท่านั้น
        if (status === 'DONE' && wageData) {
            const totalWage = (Number(wageData.area) * Number(wageData.wagePerRai)) || 0;
            const wageNote = `คนทำ: ${wageData.workers} (พื้นที่ ${wageData.area} ไร่, เรท ${wageData.wagePerRai} บ./ไร่)`;

            // ✅ กันการกด DONE ซ้ำ / request ซ้ำ แล้วสร้างค่าแรงเบิ้ล
            const { data: existingWages, error: findWageError } = await supabase
                .from('transactions')
                .select('id')
                .eq('job_id', id)
                .eq('type', 'OUT')
                .eq('category', 'ค่าแรง')
                .order('created_at', { ascending: true })
                .limit(1);

            if (findWageError) throw findWageError;

            if (existingWages && existingWages.length > 0) {
                // มีบิลเดิมแล้ว: แก้เฉพาะยอด/รายละเอียด ไม่แตะสถานะจ่ายเดิม
                const { error: txError } = await supabase
                    .from('transactions')
                    .update({
                        total_amount: totalWage,
                        note: wageNote
                    })
                    .eq('id', existingWages[0].id);

                if (txError) throw txError;
            } else {
                const { error: txError } = await supabase
                    .from('transactions')
                    .insert([{
                        job_id: id,
                        type: 'OUT',
                        category: 'ค่าแรง',
                        total_amount: totalWage,
                        paid_amount: 0,
                        status: 'UNPAID',
                        note: wageNote
                    }]);

                if (txError) throw txError;
            }
        }

        res.json({ message: 'อัปเดตสถานะสำเร็จ', data: updatedJob });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ==========================================
// 🌾 ระบบ "รอบทำงาน" สำหรับงานข้าวหลายวัน / หลายแปลงย่อย
// ==========================================

// ดึงรอบทำงานของคิวเดียว
app.get('/api/jobs/:id/rounds', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('job_work_rounds')
            .select('*')
            .eq('job_id', req.params.id)
            .order('work_date', { ascending: true });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('Load Work Rounds Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

const safeRoundNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

// 🕘 Audit เป็น best-effort: ถ้ายังไม่ได้รัน SQL ระบบหลักยังทำงานได้ตามปกติ
const writeJobAudit = async (jobId, action, summary, beforeData = null, afterData = null) => {
    try {
        const { error } = await supabase.from('job_audit_log').insert([{
            job_id: Number(jobId), action: String(action || 'UPDATE'), summary: String(summary || ''),
            before_data: beforeData, after_data: afterData
        }]);
        if (error && !['42P01','PGRST205'].includes(error.code)) console.warn('Audit log:', error.message);
    } catch (_) {}
};

const createRoundWageTransaction = async ({ jobId, roundId, workers, wageArea, wagePerRai, roundDate, roundType }) => {
    const area = Math.max(0, safeRoundNumber(wageArea));
    const rate = Math.max(0, safeRoundNumber(wagePerRai, 60));
    if (area <= 0) return null;

    const totalWage = area * rate;
    const wageNote = `คนทำ: ${workers} (พื้นที่ ${area} ไร่, เรท ${rate} บ./ไร่) [รอบงาน:${roundId}] [${roundType === 'FINAL' ? 'รอบปิดงาน' : 'รอบรายวัน'}]`;

    const { data, error } = await supabase
        .from('transactions')
        .insert([{
            job_id: Number(jobId),
            type: 'OUT',
            category: 'ค่าแรง',
            total_amount: totalWage,
            paid_amount: 0,
            status: 'UNPAID',
            note: wageNote,
            transaction_date: roundDate || new Date().toISOString()
        }])
        .select('id')
        .single();

    if (error) throw error;
    return data?.id || null;
};


// 🤝 ปรับค่าแรงของ 'งาน/แปลงที่เลือก' ให้ตรงกับไร่ที่ลูกค้ายืนยัน
// หลักการ: ไม่แตะ measured_area และไม่แตะค่าแรงของ job/แปลงอื่น
// ถ้างานนี้มีหลายรอบ จะปรับทุก round ของงานนี้ตามสัดส่วนเดิม เพื่อให้ส่วนแบ่งคนงานยังยุติธรรม
// ตัวอย่าง: แปลงนี้ลงค่าแรง 15 ไร่ ลูกค้ายืนยัน 12 ไร่ => ค่าแรงของแปลงนี้ทั้งก้อนเหลือ 12 ไร่
const formatAreaForNote = (value) => {
    const n = Math.max(0, safeRoundNumber(value));
    return Number(n.toFixed(4)).toString();
};

const preservePaidMarkers = (note) => ((String(note || '').match(/\[จ่ายแล้ว:[^\]]+\]/g) || []).join(' '));

const roundWageNote = ({ workers, area, rate, roundId, roundType, existingNote = '' }) => {
    const paid = preservePaidMarkers(existingNote);
    return `คนทำ: ${workers} (พื้นที่ ${formatAreaForNote(area)} ไร่, เรท ${formatAreaForNote(rate)} บ./ไร่) [รอบงาน:${roundId}] [${roundType === 'FINAL' ? 'รอบปิดงาน' : 'รอบรายวัน'}] [ปรับตามไร่ลูกค้า]${paid ? ` ${paid}` : ''}`;
};

const parseLegacyWageMeta = (tx) => {
    const note = String(tx?.note || '');
    const areaMatch = note.match(/พื้นที่\s*([0-9.]+)\s*ไร่/i);
    const rateMatch = note.match(/เรท\s*([0-9.]+)\s*บ\.?\s*\/\s*ไร่/i);
    const workersMatch = note.match(/คนทำ:\s*([^\(\[]+)/i);
    const rate = Math.max(0, safeRoundNumber(rateMatch?.[1], 60));
    const fallbackArea = rate > 0 ? Math.max(0, safeRoundNumber(tx?.total_amount) / rate) : 0;
    return {
        area: Math.max(0, safeRoundNumber(areaMatch?.[1], fallbackArea)),
        rate,
        workers: String(workersMatch?.[1] || '').trim(),
        paidMarkers: preservePaidMarkers(note)
    };
};

const reconcileJobWageArea = async (jobId, targetArea, options = {}) => {
    const target = Math.max(0, safeRoundNumber(targetArea));
    const postMissingTransactions = options.postMissingTransactions === true;

    const { data: rounds, error: roundsError } = await supabase
        .from('job_work_rounds')
        .select('*')
        .eq('job_id', jobId)
        .order('work_date', { ascending: true });

    if (roundsError) throw roundsError;

    // ===== ระบบรอบงาน =====
    // ใช้ measured_area ของแต่ละรอบเป็น "น้ำหนักแบ่งค่าแรง"
    // เช่น วัดจริงรวม 45 แต่ลูกค้ารับ 42 => ทุก round ถูกสเกลรวมกันให้เหลือ 42
    // และจะสร้างบิลค่าแรงที่ยังไม่มี ก็ต่อเมื่อปิดงานทั้งหมดแล้วเท่านั้น
    if (rounds && rounds.length > 0) {
        const rows = rounds.map(r => ({
            ...r,
            old_area: Math.max(0, safeRoundNumber(r.wage_area)),
            basis_area: Math.max(0, safeRoundNumber(r.measured_area)),
            new_area: Math.max(0, safeRoundNumber(r.wage_area))
        }));
        const beforeArea = rows.reduce((sum, r) => sum + r.old_area, 0);
        const basisArea = rows.reduce((sum, r) => sum + r.basis_area, 0);

        if (basisArea > 1e-9) {
            rows.forEach(row => {
                row.new_area = Math.max(0, target * (row.basis_area / basisArea));
            });

            // ชดเชยเศษ floating point ให้รวมตรง target จริง
            const current = rows.reduce((sum, r) => sum + r.new_area, 0);
            const remainder = target - current;
            if (Math.abs(remainder) > 1e-9) {
                let idx = -1;
                for (let i = rows.length - 1; i >= 0; i--) {
                    if (rows[i].basis_area > 0 || String(rows[i].workers || '').trim()) { idx = i; break; }
                }
                if (idx >= 0) rows[idx].new_area = Math.max(0, rows[idx].new_area + remainder);
            }
        } else if (target > 1e-9) {
            // ไม่มีพื้นที่วัดจริง แต่มีไร่ที่ตกลงกับลูกค้า: ให้รอบสุดท้ายที่มีชื่อคนรับค่าแรงรับยอดนี้
            let idx = -1;
            for (let i = rows.length - 1; i >= 0; i--) {
                if (String(rows[i].workers || '').trim()) { idx = i; break; }
            }
            if (idx === -1) {
                const err = new Error(`ต้องลงค่าแรง ${target.toFixed(2)} ไร่ แต่ไม่พบชื่อคนรับค่าแรงในรอบงาน`);
                err.code = 'NO_WORKER_FOR_WAGE_INCREASE';
                throw err;
            }
            rows.forEach(row => { row.new_area = 0; });
            rows[idx].new_area = target;
        } else {
            rows.forEach(row => { row.new_area = 0; });
        }

        const changed = [];
        let amountBefore = 0;
        let amountAfter = 0;
        let postedCount = 0;

        try {
            for (const row of rows) {
                const rate = Math.max(0, safeRoundNumber(row.wage_per_rai, 60));
                amountBefore += row.old_area * rate;
                amountAfter += row.new_area * rate;

                const areaChanged = Math.abs(row.new_area - row.old_area) >= 1e-9;
                let wageTxId = row.wage_transaction_id || null;
                const shouldCreateMissing = postMissingTransactions && !wageTxId && row.new_area > 1e-9;

                // ถ้าไร่ไม่เปลี่ยน และยังไม่ถึงเวลาลงสมุด ก็ไม่ต้องแตะอะไร
                if (!areaChanged && !shouldCreateMissing) {
                    if (wageTxId && row.new_area > 1e-9) postedCount++;
                    continue;
                }

                let txSnapshot = null;
                let createdTxId = null;
                const snapshot = {
                    roundId: row.id,
                    oldArea: row.old_area,
                    oldWageTxId: row.wage_transaction_id || null,
                    txSnapshot: null,
                    createdTxId: null
                };
                changed.push(snapshot);

                if (wageTxId) {
                    const { data: txData, error: txFindError } = await supabase
                        .from('transactions')
                        .select('id,total_amount,note,status')
                        .eq('id', wageTxId)
                        .maybeSingle();
                    if (txFindError) throw txFindError;
                    txSnapshot = txData || null;
                    snapshot.txSnapshot = txSnapshot;
                    if (!txSnapshot) {
                        const err = new Error(`พบบิลค่าแรง #${wageTxId} แต่ Server อ่าน/แก้ไม่ได้ (ตรวจ SUPABASE_SERVICE_ROLE_KEY ที่ Render)`);
                        err.code = 'WAGE_TX_NOT_VISIBLE';
                        throw err;
                    }
                }

                if (areaChanged) {
                    const { data: roundUpdated, error: roundUpdateError } = await supabase
                        .from('job_work_rounds')
                        .update({ wage_area: row.new_area })
                        .eq('id', row.id)
                        .select('id,wage_area')
                        .maybeSingle();
                    if (roundUpdateError) throw roundUpdateError;
                    if (!roundUpdated) {
                        const err = new Error('แก้ไร่ค่าแรงใน job_work_rounds ไม่สำเร็จจริง (อาจถูก RLS บล็อก)');
                        err.code = 'WORK_ROUND_UPDATE_BLOCKED';
                        throw err;
                    }
                }

                if (wageTxId && txSnapshot && areaChanged) {
                    const nextNote = roundWageNote({
                        workers: String(row.workers || '').trim() || 'ไม่ระบุ',
                        area: row.new_area,
                        rate,
                        roundId: row.id,
                        roundType: row.round_type,
                        existingNote: txSnapshot.note
                    });
                    const nextAmount = row.new_area * rate;
                    const { data: txUpdated, error: txUpdateError } = await supabase
                        .from('transactions')
                        .update({ total_amount: nextAmount, note: nextNote })
                        .eq('id', wageTxId)
                        .select('id,total_amount,note')
                        .maybeSingle();
                    if (txUpdateError) throw txUpdateError;
                    if (!txUpdated) {
                        const err = new Error(`แก้บิลค่าแรง #${wageTxId} ไม่สำเร็จจริง (RLS อาจบล็อก UPDATE ตาราง transactions)`);
                        err.code = 'WAGE_TX_UPDATE_BLOCKED';
                        throw err;
                    }
                    if (Math.abs(Number(txUpdated.total_amount || 0) - nextAmount) > 0.01) {
                        const err = new Error(`ยอดบิลค่าแรง #${wageTxId} หลังบันทึกไม่ตรงกับที่คำนวณ`);
                        err.code = 'WAGE_TX_VERIFY_FAILED';
                        throw err;
                    }
                } else if (shouldCreateMissing) {
                    createdTxId = await createRoundWageTransaction({
                        jobId,
                        roundId: row.id,
                        workers: String(row.workers || '').trim() || 'ไม่ระบุ',
                        wageArea: row.new_area,
                        wagePerRai: rate,
                        roundDate: row.work_date,
                        roundType: row.round_type
                    });
                    snapshot.createdTxId = createdTxId;

                    if (createdTxId) {
                        const { data: linkedRound, error: linkError } = await supabase
                            .from('job_work_rounds')
                            .update({ wage_transaction_id: createdTxId })
                            .eq('id', row.id)
                            .select('id,wage_transaction_id')
                            .maybeSingle();
                        if (linkError) throw linkError;
                        if (!linkedRound) {
                            const err = new Error(`ผูกบิลค่าแรงกับรอบ #${row.id} ไม่สำเร็จ`);
                            err.code = 'WAGE_LINK_FAILED';
                            throw err;
                        }
                        wageTxId = createdTxId;
                    }
                }

                if (wageTxId && row.new_area > 1e-9) postedCount++;
            }
        } catch (err) {
            // พยายามย้อนคืนเฉพาะสิ่งที่แก้ใน helper นี้
            for (const item of [...changed].reverse()) {
                try {
                    await supabase.from('job_work_rounds')
                        .update({ wage_area: item.oldArea, wage_transaction_id: item.oldWageTxId })
                        .eq('id', item.roundId);
                } catch (_) {}
                if (item.createdTxId) {
                    try { await supabase.from('transactions').delete().eq('id', item.createdTxId); } catch (_) {}
                }
                if (item.txSnapshot) {
                    try {
                        await supabase.from('transactions').update({
                            total_amount: item.txSnapshot.total_amount,
                            note: item.txSnapshot.note,
                            status: item.txSnapshot.status
                        }).eq('id', item.txSnapshot.id);
                    } catch (_) {}
                }
            }
            throw err;
        }

        return {
            mode: 'ROUNDS',
            before_area: beforeArea,
            after_area: target,
            area_delta: target - beforeArea,
            amount_before: amountBefore,
            amount_after: amountAfter,
            amount_delta: amountAfter - amountBefore,
            posted_count: postedCount,
            allocation_mode: 'MEASURED_AREA_PROPORTIONAL',
            deferred_posting: postMissingTransactions
        };
    }

    // ===== งานเก่า: ไม่มี job_work_rounds แต่มีบิลค่าแรงเดิม =====
    const { data: legacyTxs, error: legacyError } = await supabase
        .from('transactions')
        .select('id,total_amount,note,status,created_at')
        .eq('job_id', jobId)
        .eq('type', 'OUT')
        .eq('category', 'ค่าแรง')
        .order('created_at', { ascending: true });

    if (legacyError) throw legacyError;
    if (!legacyTxs || legacyTxs.length === 0) {
        return {
            mode: 'NO_WAGE', before_area: 0, after_area: 0, area_delta: 0,
            amount_before: 0, amount_after: 0, amount_delta: 0,
            warning: 'ไม่พบบิลค่าแรงเดิมของงานนี้ จึงปรับเฉพาะไร่ลูกค้า'
        };
    }

    const rows = legacyTxs.map(tx => ({ tx, meta: parseLegacyWageMeta(tx) }));
    const beforeArea = rows.reduce((sum, r) => sum + r.meta.area, 0);

    // งานระบบเก่า: ปรับเฉพาะบิลค่าแรงที่ผูกกับ job นี้ และรักษาสัดส่วนของบิลเดิม
    let newAreas;
    if (beforeArea > 1e-9) {
        const ratio = target / beforeArea;
        newAreas = rows.map(r => Math.max(0, r.meta.area * ratio));
        const current = newAreas.reduce((sum, area) => sum + area, 0);
        const remainder = target - current;
        if (newAreas.length && Math.abs(remainder) > 1e-9) {
            newAreas[newAreas.length - 1] = Math.max(0, newAreas[newAreas.length - 1] + remainder);
        }
    } else {
        newAreas = rows.map(() => 0);
        if (target > 1e-9 && newAreas.length) newAreas[newAreas.length - 1] = target;
    }

    let amountBefore = 0;
    let amountAfter = 0;
    const snapshots = [];
    try {
        for (let i = 0; i < rows.length; i++) {
            const { tx, meta } = rows[i];
            const newArea = newAreas[i];
            amountBefore += meta.area * meta.rate;
            amountAfter += newArea * meta.rate;
            if (Math.abs(newArea - meta.area) < 1e-9) continue;

            snapshots.push({ ...tx });
            const paid = meta.paidMarkers ? ` ${meta.paidMarkers}` : '';
            const workerText = meta.workers || 'ไม่ระบุ';
            const note = `คนทำ: ${workerText} (พื้นที่ ${formatAreaForNote(newArea)} ไร่, เรท ${formatAreaForNote(meta.rate)} บ./ไร่) [ปรับตามไร่ลูกค้า]${paid}`;
            const expectedAmount = newArea * meta.rate;
            const { data: updatedTx, error: updateError } = await supabase
                .from('transactions')
                .update({ total_amount: expectedAmount, note })
                .eq('id', tx.id)
                .select('id,total_amount,note')
                .maybeSingle();
            if (updateError) throw updateError;
            if (!updatedTx) {
                const err = new Error(`แก้บิลค่าแรงเดิม #${tx.id} ไม่สำเร็จจริง (RLS อาจบล็อก UPDATE ตาราง transactions)`);
                err.code = 'LEGACY_WAGE_TX_UPDATE_BLOCKED';
                throw err;
            }
            if (Math.abs(Number(updatedTx.total_amount || 0) - expectedAmount) > 0.01) {
                const err = new Error(`ยอดบิลค่าแรงเดิม #${tx.id} หลังบันทึกไม่ตรงกับที่คำนวณ`);
                err.code = 'LEGACY_WAGE_TX_VERIFY_FAILED';
                throw err;
            }
        }
    } catch (err) {
        for (const tx of snapshots) {
            try { await supabase.from('transactions').update({ total_amount: tx.total_amount, note: tx.note, status: tx.status }).eq('id', tx.id); } catch (_) {}
        }
        throw err;
    }

    return {
        mode: 'LEGACY',
        before_area: beforeArea,
        after_area: target,
        area_delta: target - beforeArea,
        amount_before: amountBefore,
        amount_after: amountAfter,
        amount_delta: amountAfter - amountBefore
    };
};


// 🔗 JOB-ID AREA CASCADE
// การแก้ "จำนวนไร่" ใช้ jobs.id เป็นตัวหลักของการ์ดงาน
// ทำให้ยอดพื้นที่รอบงาน (measured_area) ของ job เดียวกันรวมเท่ากับค่าที่แก้
// โดยรักษาสัดส่วนเดิมของแต่ละรอบให้มากที่สุด
const syncJobRoundMeasuredArea = async (jobId, targetArea) => {
    const target = Math.max(0, safeRoundNumber(targetArea));

    const { data: rounds, error } = await supabase
        .from('job_work_rounds')
        .select('id,measured_area')
        .eq('job_id', jobId)
        .order('work_date', { ascending: true });

    if (error) throw error;
    if (!rounds || rounds.length === 0) {
        return { before_area: 0, after_area: 0, snapshots: [] };
    }

    const snapshots = rounds.map(r => ({
        id: r.id,
        measured_area: Math.max(0, safeRoundNumber(r.measured_area))
    }));
    const before = snapshots.reduce((sum, r) => sum + r.measured_area, 0);

    let nextAreas = snapshots.map(r => r.measured_area);
    if (before > 1e-9) {
        const ratio = target / before;
        nextAreas = snapshots.map(r => Math.max(0, r.measured_area * ratio));
        const diff = target - nextAreas.reduce((sum, n) => sum + n, 0);
        if (Math.abs(diff) > 1e-9) {
            nextAreas[nextAreas.length - 1] = Math.max(0, nextAreas[nextAreas.length - 1] + diff);
        }
    } else {
        nextAreas = snapshots.map(() => 0);
        if (target > 0) nextAreas[nextAreas.length - 1] = target;
    }

    const changed = [];
    try {
        for (let i = 0; i < snapshots.length; i++) {
            if (Math.abs(nextAreas[i] - snapshots[i].measured_area) < 1e-9) continue;
            const { data: updated, error: updateError } = await supabase
                .from('job_work_rounds')
                .update({ measured_area: nextAreas[i] })
                .eq('id', snapshots[i].id)
                .select('id,measured_area')
                .maybeSingle();

            if (updateError) throw updateError;
            if (!updated) {
                const e = new Error(`แก้พื้นที่รอบงาน #${snapshots[i].id} ไม่สำเร็จ`);
                e.code = 'ROUND_MEASURED_AREA_UPDATE_FAILED';
                throw e;
            }
            changed.push(snapshots[i]);
        }
    } catch (err) {
        for (const old of changed.reverse()) {
            try {
                await supabase.from('job_work_rounds')
                    .update({ measured_area: old.measured_area })
                    .eq('id', old.id);
            } catch (_) {}
        }
        throw err;
    }

    return { before_area: before, after_area: target, snapshots };
};

const restoreJobRoundMeasuredArea = async (snapshots = []) => {
    for (const old of snapshots) {
        try {
            await supabase.from('job_work_rounds')
                .update({ measured_area: old.measured_area })
                .eq('id', old.id);
        } catch (_) {}
    }
};

// 🌾 ปิด "รอบวันนี้" แต่ยังไม่ปิดงานลูกค้า
// measured_area = วันนี้วัดจริงกี่ไร่
// ✅ จำคนรับค่าแรง + เรท + พื้นที่ไว้ใน job_work_rounds ก่อน
// ❌ ยังไม่สร้าง transactions/สมุดค่าแรง จนกว่าจะกด 🏁 จบงานทั้งหมด
app.post('/api/jobs/:id/rounds', async (req, res) => {
    const jobId = Number(req.params.id);
    const {
        measured_area,
        measured_source = 'MANUAL',
        workers,
        wage_per_rai = 60,
        next_work_date = null,
        note = ''
    } = req.body || {};

    const measuredArea = safeRoundNumber(measured_area, NaN);
    const wagePerRai = safeRoundNumber(wage_per_rai, 60);
    const workerText = String(workers || '').trim();

    if (!Number.isFinite(jobId) || jobId <= 0) return res.status(400).json({ error: 'job_id ไม่ถูกต้อง' });
    if (!Number.isFinite(measuredArea) || measuredArea <= 0) return res.status(400).json({ error: 'กรุณาระบุพื้นที่ที่ทำจริงวันนี้มากกว่า 0 ไร่' });
    if (!workerText) return res.status(400).json({ error: 'กรุณาระบุคนที่ลงแปลงวันนี้' });
    if (!Number.isFinite(wagePerRai) || wagePerRai < 0) return res.status(400).json({ error: 'เรทค่าแรงไม่ถูกต้อง' });

    let roundId = null;
    try {
        const { data: job, error: jobError } = await supabase
            .from('jobs')
            .select('id, status')
            .eq('id', jobId)
            .single();

        if (jobError) throw jobError;
        if (!job) return res.status(404).json({ error: 'ไม่พบคิวงาน' });
        if (job.status === 'DONE') return res.status(400).json({ error: 'งานนี้ปิดจบแล้ว ไม่สามารถเพิ่มรอบได้' });

        const nowIso = new Date().toISOString();
        const { data: round, error: roundError } = await supabase
            .from('job_work_rounds')
            .insert([{
                job_id: jobId,
                work_date: nowIso,
                measured_area: measuredArea,
                // ยังไม่จัดสรรค่าแรงจนกว่าจะ 🏁 จบงานทั้งหมด
                wage_area: 0,
                wage_per_rai: wagePerRai,
                workers: workerText,
                note: `${String(note || '').trim()}${String(note || '').trim() ? ' ' : ''}[พื้นที่:${String(measured_source).toUpperCase() === 'GPS' ? 'GPS' : 'MANUAL'}]`,
                round_type: 'PARTIAL',
                wage_transaction_id: null
            }])
            .select()
            .single();

        if (roundError) throw roundError;
        roundId = round.id;

        const jobUpdate = { status: 'PAUSED' };
        if (next_work_date) jobUpdate.job_date = next_work_date;

        const { data: updatedJob, error: updateError } = await supabase
            .from('jobs')
            .update(jobUpdate)
            .eq('id', jobId)
            .select()
            .single();

        if (updateError) throw updateError;

        await writeJobAudit(jobId, 'ROUND_SAVED', `ปิดรอบ ${measuredArea.toFixed(2)} ไร่ • ${workerText} • ${String(measured_source).toUpperCase()==='GPS'?'GPS':'ปรับเอง'}`, null, {round_id:roundId, measured_area:measuredArea, workers:workerText, source:measured_source, next_work_date});

        res.status(201).json({
            success: true,
            message: 'บันทึกรอบวันนี้และจำคนรับค่าแรงแล้ว (ยังไม่ลงสมุดค่าแรง)',
            round,
            job: updatedJob,
            wage_posted: false
        });
    } catch (err) {
        if (roundId) {
            try { await supabase.from('job_work_rounds').delete().eq('id', roundId); } catch (_) {}
        }
        console.error('Create Work Round Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 🏁 ปิดงานทั้งหมด
// 1) รวมพื้นที่วัดจริงทุก round
// 2) เอา 🤝 billing_area ที่ตกลงกับลูกค้า เป็น "ไร่ค่าแรงรวม"
// 3) แบ่ง billing_area กลับเข้าทุกรอบตามสัดส่วน measured_area ของรอบนั้น
// 4) จากนั้นค่อยสร้าง/อัปเดต transactions ค่าแรงทั้งหมดของงานนี้ครั้งเดียว
app.post('/api/jobs/:id/finalize', async (req, res) => {
    const jobId = Number(req.params.id);
    const {
        measured_area = 0,
        measured_source = 'MANUAL',
        billing_area,
        workers = '',
        wage_per_rai = 60,
        note = ''
    } = req.body || {};

    const todayMeasured = Math.max(0, safeRoundNumber(measured_area, 0));
    const billingArea = safeRoundNumber(billing_area, NaN);
    const wagePerRai = Math.max(0, safeRoundNumber(wage_per_rai, 60));
    const workerText = String(workers || '').trim();

    if (!Number.isFinite(jobId) || jobId <= 0) return res.status(400).json({ error: 'job_id ไม่ถูกต้อง' });
    if (!Number.isFinite(billingArea) || billingArea < 0) return res.status(400).json({ error: 'กรุณาระบุพื้นที่ที่ตกลงคิดเงินกับลูกค้า' });
    if (todayMeasured > 0 && !workerText) return res.status(400).json({ error: 'วันนี้มีพื้นที่เกี่ยวเพิ่ม กรุณาระบุคนที่รับค่าแรงรอบสุดท้าย' });

    let roundId = null;
    let jobSnapshot = null;
    try {
        const { data: job, error: jobError } = await supabase
            .from('jobs')
            .select('id,status,price_per_rai,crop_type,billing_area,total_price,job_date,closed_at')
            .eq('id', jobId)
            .single();

        if (jobError) throw jobError;
        if (!job) return res.status(404).json({ error: 'ไม่พบคิวงาน' });
        if (job.status === 'DONE') return res.status(400).json({ error: 'งานนี้ปิดจบไปแล้ว' });
        jobSnapshot = { ...job };

        const { data: priorRounds, error: roundsError } = await supabase
            .from('job_work_rounds')
            .select('*')
            .eq('job_id', jobId)
            .order('work_date', { ascending: true });

        if (roundsError) throw roundsError;

        // ✅ งานระบบใหม่ที่ยังไม่เคยลง transaction ค่าแรง ใช้ Postgres RPC ตัวเดียว
        // เพื่อให้: เพิ่มรอบสุดท้าย + แบ่งค่าแรง + สร้างสมุด + ปิด job เป็น transaction เดียวจริง ๆ
        const hasLegacyPostedWage = (priorRounds || []).some(r => r.wage_transaction_id);
        if (!hasLegacyPostedWage) {
            const { data: atomicResult, error: atomicError } = await supabase.rpc('finalize_job_atomic', {
                p_job_id: jobId,
                p_today_measured: todayMeasured,
                p_billing_area: billingArea,
                p_workers: workerText,
                p_wage_per_rai: wagePerRai,
                p_note: String(note || '').trim(),
                p_measured_source: String(measured_source || 'MANUAL')
            });

            if (!atomicError && atomicResult?.success) {
                return res.json(atomicResult);
            }

            // ยังไม่ได้รัน SQL setup / ไม่มีสิทธิ์ execute => ใช้ fallback เดิมที่มี rollback ชดเชย
            const canFallback = atomicError && ['PGRST202', '42883', '42501'].includes(atomicError.code);
            if (atomicError && !canFallback) throw atomicError;
        }

        const priorMeasuredArea = (priorRounds || []).reduce((sum, r) => sum + (Number(r.measured_area) || 0), 0);
        const priorWageArea = (priorRounds || []).reduce((sum, r) => sum + (Number(r.wage_area) || 0), 0);
        const measuredAreaTotal = priorMeasuredArea + todayMeasured;

        // ถ้าไม่เคยมีรอบเลย แต่จะลงค่าแรงตามไร่ลูกค้า ต้องมีชื่อผู้รับค่าแรงอย่างน้อยหนึ่งคน
        if ((!priorRounds || priorRounds.length === 0) && billingArea > 0 && !workerText) {
            return res.status(400).json({ error: 'ยังไม่มีรอบงานเดิม กรุณาระบุคนที่จะรับค่าแรงก่อนปิดงาน' });
        }

        const nowIso = new Date().toISOString();

        // เพิ่มรอบสุดท้ายเฉพาะเมื่อวันนี้มีทำงานเพิ่ม
        // หรือเป็นงานที่ไม่มีรอบเดิมเลยแต่ต้องลงค่าแรงจากยอดลูกค้า
        if (todayMeasured > 0 || ((!priorRounds || priorRounds.length === 0) && billingArea > 0)) {
            const { data: round, error: roundError } = await supabase
                .from('job_work_rounds')
                .insert([{
                    job_id: jobId,
                    work_date: nowIso,
                    measured_area: todayMeasured,
                    wage_area: 0,
                    wage_per_rai: wagePerRai,
                    workers: workerText || 'ไม่ระบุ',
                    note: `${String(note || '').trim()}${String(note || '').trim() ? ' ' : ''}[พื้นที่:${String(measured_source).toUpperCase() === 'GPS' ? 'GPS' : 'MANUAL'}]`,
                    round_type: 'FINAL',
                    wage_transaction_id: null
                }])
                .select()
                .single();

            if (roundError) throw roundError;
            roundId = round.id;
        }

        const pricePerRai = Math.max(0, Number(job.price_per_rai) || 0);
        const totalPrice = billingArea * pricePerRai;

        // ปิดการ์ดก่อน แล้วค่อยลงสมุดค่าแรง เพื่อให้ helper รู้ว่านี่คือการปิดจริง
        const { data: updatedJob, error: updateError } = await supabase
            .from('jobs')
            .update({
                status: 'DONE',
                billing_area: billingArea,
                total_price: totalPrice,
                job_date: nowIso,
                closed_at: nowIso
            })
            .eq('id', jobId)
            .select()
            .single();

        if (updateError) throw updateError;

        let wageReconciliation;
        try {
            // ✅ จุดเดียวที่สร้างบิลค่าแรงที่ยังขาด: ตอน 🏁 จบงานทั้งหมด
            wageReconciliation = await reconcileJobWageArea(jobId, billingArea, { postMissingTransactions: true });
        } catch (wageErr) {
            // ถ้าลงสมุดค่าแรงไม่สำเร็จ ให้ย้อนสถานะการ์ดกลับ
            try {
                await supabase.from('jobs').update({
                    status: jobSnapshot.status,
                    billing_area: jobSnapshot.billing_area,
                    total_price: jobSnapshot.total_price,
                    job_date: jobSnapshot.job_date,
                    closed_at: jobSnapshot.closed_at
                }).eq('id', jobId);
            } catch (_) {}
            throw wageErr;
        }

        await writeJobAudit(jobId, 'FINALIZED', `จบงาน • ทำจริง ${measuredAreaTotal.toFixed(2)} ไร่ • ลูกค้ารับ ${billingArea.toFixed(2)} ไร่ • ค่าแรง ${wageReconciliation.after_area.toFixed(2)} ไร่`, jobSnapshot, updatedJob);

        res.json({
            success: true,
            message: 'ปิดงานทั้งหมดและลงสมุดค่าแรงเรียบร้อย',
            job: updatedJob,
            summary: {
                prior_measured_area: priorMeasuredArea,
                today_measured_area: todayMeasured,
                measured_area_total: measuredAreaTotal,
                prior_wage_area: priorWageArea,
                billing_area: billingArea,
                wage_area_total: wageReconciliation.after_area,
                wage_amount_total: wageReconciliation.amount_after,
                wage_rounds_posted: wageReconciliation.posted_count || 0,
                allocation_mode: wageReconciliation.allocation_mode,
                total_price: totalPrice
            }
        });
    } catch (err) {
        if (roundId) {
            try { await supabase.from('job_work_rounds').delete().eq('id', roundId); } catch (_) {}
        }
        console.error('Finalize Job Error:', err.message);
        res.status(500).json({ error: err.message, code: err.code || 'FINALIZE_FAILED' });
    }
});


// 📐 แก้จำนวนไร่ของการ์ดงาน โดยยึด jobs.id เป็นหลัก
// เปลี่ยน 12 -> 11 = การ์ดงาน / รอบงาน / ค่าแรง / ยอดลูกหนี้ ของ job id นี้เป็น 11 ทั้งหมด
// ส่วนลด "เป็นจำนวนเงิน" ยังคงเป็นระบบเดิม และไม่กระทบค่าแรง
app.patch('/api/jobs/:id/billing-area', async (req, res) => {
    const jobId = Number(req.params.id);
    const newArea = safeRoundNumber(req.body?.billing_area, NaN);

    if (!Number.isFinite(jobId) || jobId <= 0) return res.status(400).json({ error: 'job_id ไม่ถูกต้อง' });
    if (!Number.isFinite(newArea) || newArea < 0) return res.status(400).json({ error: 'กรุณาระบุจำนวนไร่ให้ถูกต้อง' });

    let wageResult = null;

    try {
        const { data: job, error: jobError } = await supabase
            .from('jobs')
            .select('id,status,payment_status,area_size,billing_area,price_per_rai,total_price')
            .eq('id', jobId)
            .single();

        if (jobError) throw jobError;
        if (!job) return res.status(404).json({ error: 'ไม่พบคิวงาน' });

        const oldArea = Math.max(0, safeRoundNumber(job.billing_area ?? job.area_size, 0));
        const rate = Math.max(0, safeRoundNumber(job.price_per_rai, 0));
        const oldInvoice = oldArea * rate;
        const oldDebt = Math.max(0, safeRoundNumber(job.total_price, 0));

        // ถ้ามีมัดจำ ให้รักษา "จำนวนเงินที่จ่ายแล้ว" ไว้
        const alreadyPaid = job.payment_status === 'DEPOSIT'
            ? Math.max(0, oldInvoice - oldDebt)
            : 0;

        const newInvoice = newArea * rate;
        const newDebt = Math.max(0, newInvoice - alreadyPaid);
        const nextPaymentStatus = alreadyPaid > 0
            ? (newDebt <= 0.000001 ? 'PAID' : 'DEPOSIT')
            : (job.payment_status || 'UNPAID');

        // 1) ค่าแรงของ job id นี้เท่านั้น
        wageResult = await reconcileJobWageArea(jobId, newArea, { postMissingTransactions: job.status === 'DONE' });

        // 2) measured_area / GPS คือข้อเท็จจริงหน้างาน — ห้ามแก้ทับด้วยไร่ที่ลูกค้าตกลง

        // 3) ไร่คิดเงิน + ยอดลูกหนี้
        const { data: updatedJob, error: updateError } = await supabase
            .from('jobs')
            .update({
                billing_area: newArea,
                total_price: newDebt,
                payment_status: nextPaymentStatus
            })
            .eq('id', jobId)
            .select()
            .single();

        if (updateError) {
            try { await reconcileJobWageArea(jobId, wageResult.before_area, { postMissingTransactions: job.status === 'DONE' }); } catch (_) {}
            throw updateError;
        }

        await writeJobAudit(jobId, 'BILLING_AREA_CHANGED', `ปรับไร่คิดเงิน ${oldArea.toFixed(2)} → ${newArea.toFixed(2)} ไร่ • ค่าแรงปรับตาม • วัดจริง/GPS คงเดิม`, job, updatedJob);

        res.json({
            success: true,
            message: 'ปรับไร่คิดเงิน + ค่าแรง + ลูกหนี้เรียบร้อย (วัดจริง/GPS คงเดิม)',
            job: updatedJob,
            summary: {
                job_id: jobId,
                old_area: oldArea,
                new_area: newArea,
                old_invoice: oldInvoice,
                new_invoice: newInvoice,
                already_paid: alreadyPaid,
                new_debt: newDebt,
                wage_area_before: wageResult.before_area,
                wage_area_after: wageResult.after_area,
                wage_amount_before: wageResult.amount_before,
                wage_amount_after: wageResult.amount_after,
                measured_area_before: null,
                measured_area_after: null,
                sync_mode: 'BILLING_WAGE_DEBT_ONLY'
            }
        });
    } catch (err) {
        console.error('Job Area Cascade Error:', err.message);
        res.status(500).json({ error: err.message, code: err.code || 'JOB_AREA_CASCADE_FAILED' });
    }
});

// API สำหรับแก้ไขข้อมูลคิวงาน (PUT)
// ✅ กฎหลัก: jobs.id คือ "การ์ดงาน"
// ถ้าแก้จำนวนไร่จาก 📋 ประวัติ ระบบจะซิงก์เฉพาะ job id นั้นทั้งชุด:
// area_size + billing_area + measured_area รอบงาน + wage_area/บิลค่าแรง + total_price/ลูกหนี้
app.put('/api/jobs/:id', async (req, res) => {
    const jobId = Number(req.params.id);
    let { customer_name, phone, address_note, crop_type, area_size, job_date, latitude, longitude, vehicle_id, price_per_rai, total_price, payment_status } = req.body;

    if (!Number.isFinite(jobId) || jobId <= 0) {
        return res.status(400).json({ error: 'job_id ไม่ถูกต้อง' });
    }

    const hasArea = area_size !== '' && area_size !== null && area_size !== undefined;
    const nextArea = hasArea ? Number(area_size) : null;
    if (hasArea && (!Number.isFinite(nextArea) || nextArea < 0)) {
        return res.status(400).json({ error: 'จำนวนไร่ไม่ถูกต้อง' });
    }

    const nextRate = price_per_rai !== '' && price_per_rai !== null && price_per_rai !== undefined
        ? Math.max(0, Number(price_per_rai) || 0)
        : 0;

    let wageResult = null;

    try {
        const { data: jobInfo, error: findError } = await supabase
            .from('jobs')
            .select('id,customer_id,status,area_size,billing_area,price_per_rai,total_price,payment_status')
            .eq('id', jobId)
            .single();

        if (findError) throw findError;
        if (!jobInfo) return res.status(404).json({ error: 'ไม่พบคิวงาน' });

        const isDone = jobInfo.status === 'DONE';
        const oldEstimateArea = jobInfo.area_size == null ? null : Math.max(0, safeRoundNumber(jobInfo.area_size, 0));
        const oldCanonicalArea = isDone
            ? Math.max(0, safeRoundNumber(jobInfo.billing_area ?? jobInfo.area_size, 0))
            : Math.max(0, safeRoundNumber(jobInfo.area_size, 0));
        const canonicalArea = hasArea ? Math.max(0, nextArea) : oldCanonicalArea;
        const rate = Number.isFinite(nextRate) ? nextRate : Math.max(0, safeRoundNumber(jobInfo.price_per_rai, 0));

        // ถ้ามีมัดจำอยู่ ให้เก็บ "เงินที่จ่ายมาแล้ว" ไว้ และคำนวณหนี้ใหม่
        const oldRate = Math.max(0, safeRoundNumber(jobInfo.price_per_rai, 0));
        const oldInvoice = oldCanonicalArea * oldRate;
        const oldDebt = Math.max(0, safeRoundNumber(jobInfo.total_price, 0));
        const alreadyPaid = jobInfo.payment_status === 'DEPOSIT'
            ? Math.max(0, oldInvoice - oldDebt)
            : 0;

        const newInvoice = canonicalArea * rate;
        let nextTotalPrice = newInvoice;
        let nextPaymentStatus = payment_status || jobInfo.payment_status || 'UNPAID';

        if (jobInfo.payment_status === 'DEPOSIT' || nextPaymentStatus === 'DEPOSIT') {
            nextTotalPrice = Math.max(0, newInvoice - alreadyPaid);
            nextPaymentStatus = nextTotalPrice <= 0.000001 ? 'PAID' : 'DEPOSIT';
        } else if (nextPaymentStatus === 'PAID') {
            // ประวัติรับเงินยังอิงยอดเต็มของการ์ด
            nextTotalPrice = newInvoice;
        }

        // ถ้า frontend ส่ง total_price มาจากส่วนลดเดิม และ "ไม่ได้แก้จำนวนไร่/เรท"
        // ให้รักษายอดนั้นไว้ เพื่อไม่ทำลายระบบลดราคาเป็นจำนวนเงิน
        const areaChanged = Math.abs(canonicalArea - oldCanonicalArea) > 1e-9;
        const rateChanged = Math.abs(rate - oldRate) > 1e-9;
        if (!areaChanged && !rateChanged && total_price !== '' && total_price !== null && total_price !== undefined) {
            const sentTotal = Number(total_price);
            if (Number.isFinite(sentTotal) && sentTotal >= 0) nextTotalPrice = sentTotal;
        }

        // งานที่ยังไม่จบ: area_size คือ "ลูกค้าแจ้งประมาณ" เท่านั้น
        // งาน DONE: ช่องไร่ในประวัติหมายถึง billing_area และปรับเฉพาะค่าแรง+ลูกหนี้ — measured/GPS คงเดิม
        if (areaChanged && isDone) {
            wageResult = await reconcileJobWageArea(jobId, canonicalArea, { postMissingTransactions: true });
        }

        if (jobInfo.customer_id) {
            // ✅ ช่องเบอร์ว่าง = ไม่แก้เบอร์เดิม
            // Frontend ซ่อนเบอร์จำลอง "ไม่มี-xxxxx" เป็นช่องว่างเพื่อให้ UI อ่านง่าย
            // จึงห้ามเขียน phone="" ทับฐานข้อมูล เพราะ customers.phone เป็น UNIQUE
            const customerUpdate = {};
            const cleanCustomerName = String(customer_name || '').trim();
            const cleanPhone = String(phone || '').trim();

            if (cleanCustomerName) customerUpdate.name = cleanCustomerName;

            if (cleanPhone) {
                // ถ้ากรอกเบอร์ใหม่จริง ตรวจว่าซ้ำกับลูกค้ารายอื่นหรือไม่
                const { data: phoneOwner, error: phoneLookupError } = await supabase
                    .from('customers')
                    .select('id,name')
                    .eq('phone', cleanPhone)
                    .neq('id', jobInfo.customer_id)
                    .maybeSingle();

                if (phoneLookupError) throw phoneLookupError;

                if (phoneOwner) {
                    const duplicateError = new Error(`เบอร์ ${cleanPhone} ถูกใช้กับลูกค้า "${phoneOwner.name || 'รายอื่น'}" อยู่แล้ว`);
                    duplicateError.code = 'CUSTOMER_PHONE_DUPLICATE';
                    throw duplicateError;
                }

                customerUpdate.phone = cleanPhone;
            }

            if (Object.keys(customerUpdate).length) {
                const { error: customerError } = await supabase
                    .from('customers')
                    .update(customerUpdate)
                    .eq('id', jobInfo.customer_id);
                if (customerError) throw customerError;
            }
        }

        const { data: updatedJob, error: jobError } = await supabase
            .from('jobs')
            .update({
                vehicle_id: vehicle_id === 0 ? null : vehicle_id,
                crop_type,
                ...(isDone ? { billing_area: canonicalArea } : { area_size: hasArea ? canonicalArea : oldEstimateArea }),
                job_date,
                latitude,
                longitude,
                price_per_rai: rate,
                total_price: nextTotalPrice,
                payment_status: nextPaymentStatus,
                address_note
            })
            .eq('id', jobId)
            .select()
            .single();

        if (jobError) {
            if (wageResult) {
                try { await reconcileJobWageArea(jobId, wageResult.before_area, { postMissingTransactions: jobInfo.status === 'DONE' }); } catch (_) {}
            }
            throw jobError;
        }

        await writeJobAudit(jobId, areaChanged ? (isDone ? 'BILLING_AREA_CHANGED' : 'ESTIMATE_CHANGED') : 'JOB_EDITED',
            areaChanged
                ? (isDone ? `แก้ไร่คิดเงินเป็น ${canonicalArea.toFixed(2)} ไร่ • ค่าแรง+ลูกหนี้ตาม • ทำจริง/GPS คงเดิม` : `แก้ยอดลูกค้าแจ้งประมาณเป็น ${canonicalArea.toFixed(2)} ไร่`)
                : 'แก้ข้อมูลคิวงาน', jobInfo, updatedJob);

        res.json({
            message: areaChanged
                ? (isDone ? `อัปเดตไร่คิดเงินของงาน #${jobId} และปรับค่าแรง+ลูกหนี้สำเร็จ` : `อัปเดตยอดประมาณของคิว #${jobId} สำเร็จ`)
                : 'อัปเดตข้อมูลสำเร็จ!',
            data: updatedJob,
            area_sync: areaChanged ? {
                job_id: jobId,
                old_area: oldCanonicalArea,
                new_area: canonicalArea,
                wage_area_before: wageResult?.before_area ?? null,
                wage_area_after: wageResult?.after_area ?? null,
                measured_area_before: null,
                measured_area_after: null,
                total_price: nextTotalPrice,
                mode: isDone ? 'BILLING_WAGE_DEBT_ONLY' : 'ESTIMATE_ONLY'
            } : null
        });
    } catch (err) {
        console.error('Error updating job:', err.message);
        const status = err.code === 'CUSTOMER_PHONE_DUPLICATE' ? 409 : 500;
        res.status(status).json({ error: err.message, code: err.code || 'JOB_UPDATE_FAILED' });
    }
});


// 🔍 ตรวจความสัมพันธ์ของ Job ID เดียวกัน — ไม่แก้ข้อมูล แค่รายงาน
app.get('/api/jobs/:id/integrity', async (req, res) => {
    const jobId = Number(req.params.id);
    if (!Number.isSafeInteger(jobId) || jobId <= 0) return res.status(400).json({error:'job_id ไม่ถูกต้อง'});
    try {
        const {data:job,error:jobError} = await supabase.from('jobs').select('*').eq('id',jobId).single();
        if(jobError) throw jobError;
        const {data:rounds,error:roundError} = await supabase.from('job_work_rounds').select('*').eq('job_id',jobId).order('work_date',{ascending:true});
        if(roundError) throw roundError;
        const {data:wages,error:wageError} = await supabase.from('transactions').select('id,total_amount,status,note,transaction_date').eq('job_id',jobId).eq('type','OUT').eq('category','ค่าแรง');
        if(wageError) throw wageError;

        let gps = {plot_count:0,area_rai:0,plots:[],invalid_count:0};
        try { const map = await loadGpsJobSummary(); gps = map.get(jobId) || gps; } catch (_) {}

        const measured = (rounds||[]).reduce((s,r)=>s+Math.max(0,Number(r.measured_area)||0),0);
        const wageArea = (rounds||[]).reduce((s,r)=>s+Math.max(0,Number(r.wage_area)||0),0);
        const expectedWage = (rounds||[]).reduce((s,r)=>s+(Math.max(0,Number(r.wage_area)||0)*Math.max(0,Number(r.wage_per_rai)||0)),0);
        const wageAmount = (wages||[]).reduce((s,t)=>s+Math.max(0,Number(t.total_amount)||0),0);
        const billing = job.billing_area == null ? null : Math.max(0,Number(job.billing_area)||0);
        const checks = [];
        const add=(level,title,detail)=>checks.push({level,title,detail});

        if(gps.invalid_count>0) add('WARN','ขอบแปลง GPS ต้องตรวจ',`มี ${gps.invalid_count} แปลงที่คำนวณไม่ได้`);
        else add('OK','GPS พร้อมใช้',`${gps.plot_count} แปลง • ${Number(gps.area_rai||0).toFixed(2)} ไร่`);

        if((rounds||[]).some(r=>!String(r.workers||'').trim())) add('ERROR','มีรอบที่ไม่มีชื่อคนงาน','กรุณาแก้ชื่อคนรับค่าแรงก่อนปิดบัญชี');
        else add('OK','ชื่อคนงานครบ',`${(rounds||[]).length} รอบ`);

        if(job.status==='DONE') {
            if(billing == null) add('ERROR','งานจบแต่ไม่มีไร่คิดเงิน','billing_area ว่าง');
            else if(Math.abs(wageArea-billing)>0.01) add('ERROR','ไร่ค่าแรงไม่ตรงไร่คิดเงิน',`คิดเงิน ${billing.toFixed(2)} แต่ค่าแรง ${wageArea.toFixed(2)} ไร่`);
            else add('OK','ค่าแรงตรงไร่คิดเงิน',`${wageArea.toFixed(2)} ไร่`);

            const missingTx=(rounds||[]).filter(r=>(Number(r.wage_area)||0)>0.000001 && !r.wage_transaction_id);
            if(missingTx.length) add('ERROR','มีค่าแรงที่ยังไม่ลงสมุด',`${missingTx.length} รอบ`);
            else add('OK','สมุดค่าแรงครบ','ทุกรอบที่มีค่าแรงมี Transaction แล้ว');

            if(Math.abs(expectedWage-wageAmount)>0.5) add('ERROR','ยอดบาทในสมุดค่าแรงไม่ตรง',`ควร ${expectedWage.toFixed(2)} แต่พบ ${wageAmount.toFixed(2)} บาท`);
            else add('OK','ยอดบาทค่าแรงตรง',`${wageAmount.toFixed(2)} บาท`);
        } else {
            const posted=(rounds||[]).filter(r=>r.wage_transaction_id).length;
            if(posted) add('WARN','งานยังไม่จบแต่มีค่าแรงเก่าในสมุด',`${posted} รอบ • ระบบจะปรับตอนจบงาน`);
            else add('OK','ยังไม่ลงสมุดค่าแรง','ถูกต้องตามกติกาใหม่ — รอลงตอนจบงานทั้งหมด');
        }

        if(gps.area_rai>0 && measured>gps.area_rai+0.05) add('WARN','ทำจริงมากกว่า GPS',`ทำจริง ${measured.toFixed(2)} > GPS ${Number(gps.area_rai).toFixed(2)} ไร่ • อาจมีการปรับมือหรือขาดแปลง GPS`);

        const invoice = billing == null ? null : billing * Math.max(0,Number(job.price_per_rai)||0);
        if(job.status==='DONE' && invoice != null && Math.abs(Number(job.total_price||0)-invoice)>0.5) add('WARN','ยอดเงินต่างจากไร่ × ราคา',`อาจเป็นส่วนลด/มัดจำ: เต็ม ${invoice.toFixed(2)} • เก็บในงาน ${Number(job.total_price||0).toFixed(2)} บาท`);

        let audit=[];
        try {
            const {data,error}=await supabase.from('job_audit_log').select('id,action,summary,created_at').eq('job_id',jobId).order('created_at',{ascending:false}).limit(30);
            if(!error) audit=data||[];
        } catch(_) {}

        const health = checks.some(c=>c.level==='ERROR') ? 'ERROR' : checks.some(c=>c.level==='WARN') ? 'WARN' : 'OK';
        res.set('Cache-Control','no-store').json({health,checks,audit,summary:{
            gps_area:Number(gps.area_rai||0), measured_area:measured, billing_area:billing, wage_area:wageArea,
            wage_amount:wageAmount, expected_wage_amount:expectedWage, plot_count:gps.plot_count, round_count:(rounds||[]).length,
            job_status:job.status, payment_status:job.payment_status
        }});
    } catch(err) {
        console.error('Integrity check:',err.message);
        res.status(500).json({error:err.message});
    }
});

// API สำหรับลบคิวงาน
app.delete('/api/jobs/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // ลบรอบทำงานก่อน เพราะเป็นประวัติย่อยของคิวนี้
        const { error: roundsError } = await supabase
            .from('job_work_rounds')
            .delete()
            .eq('job_id', id);
        if (roundsError) console.warn('⚠️ ลบรอบทำงานไม่สำเร็จ:', roundsError.message);

        const { error } = await supabase
            .from('jobs')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ message: 'ลบข้อมูลคิวงานสำเร็จเรียบร้อย' });
    } catch (err) {
        console.error('Error deleting job:', err.message);
        res.status(500).json({ error: err.message });
    }
});


// ==========================================
// 🚜 API สำหรับจัดการรถเกี่ยว (Vehicles)
// ==========================================

// ดึงรายชื่อรถเกี่ยวทั้งหมด
app.get('/api/vehicles', async (req, res) => {
    const { data, error } = await supabase.from('vehicles').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// เพิ่มรายชื่อรถเกี่ยวคันใหม่
app.post('/api/vehicles', async (req, res) => {
    // เปลี่ยนจาก phone เป็น driver_name
    const { name, driver_name } = req.body;
    
    const { data, error } = await supabase
        .from('vehicles')
        .insert([{ name, driver_name }]) // เปลี่ยนเป็น driver_name
        .select();
        
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ message: 'เพิ่มรถสำเร็จ', data });
});

// ลบรายชื่อรถเกี่ยว
app.delete('/api/vehicles/:id', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('vehicles').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'ลบรถสำเร็จ' });
});

// ==========================================
// 🛰️ API สำหรับระบบ GPS Tracker (ดูปัจจุบันและประวัติ)
// ==========================================

// ใน server.js บรรทัดประมาณ 215
// GPS edge exclusions are independent of raw logs and saved plot geometry.
const validRouteScope = (vehicle, date) => Number.isSafeInteger(Number(vehicle)) && Number(vehicle) > 0 &&
    typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) === date;
app.get('/api/gps-route-edits/:vehicle_id', async (req, res) => {
    if (!validRouteScope(req.params.vehicle_id, req.query.date)) return res.status(400).json({error:'รถหรือวันที่ไม่ถูกต้อง'});
    try {
        const {data,error} = await supabase.from('gps_route_edits').select('excluded_edges,revision')
            .eq('vehicle_id', Number(req.params.vehicle_id)).eq('work_date',req.query.date).maybeSingle();
        if(error) throw error;
        res.set('Cache-Control','no-store').json(data || {excluded_edges:[],revision:0});
    } catch(error) { res.status(500).json({error:'โหลดการตัดเส้นไม่ได้ กรุณาตรวจว่าติดตั้งตาราง gps_route_edits แล้ว'}); }
});
app.put('/api/gps-route-edits/:vehicle_id', async (req,res) => {
    const {work_date,excluded_edges,revision} = req.body || {};
    if(!validRouteScope(req.params.vehicle_id,work_date) || !Number.isSafeInteger(revision) || revision < 0 ||
        !Array.isArray(excluded_edges) || excluded_edges.length > 30000 ||
        excluded_edges.some(k => typeof k !== 'string' || k.length < 3 || k.length > 240 || !k.includes('>')) ||
        new Set(excluded_edges).size !== excluded_edges.length) return res.status(400).json({error:'ข้อมูลช่วงเส้นไม่ถูกต้อง หรือเกิน 30,000 ช่วง'});
    try {
        // Compare-and-swap prevents another PC/phone from silently overwriting changes.
        const row = {vehicle_id:Number(req.params.vehicle_id),work_date,excluded_edges,revision:revision+1,updated_at:new Date().toISOString()};
        const query = revision === 0 ? supabase.from('gps_route_edits').insert(row) :
            supabase.from('gps_route_edits').update(row).eq('vehicle_id',row.vehicle_id).eq('work_date',work_date).eq('revision',revision);
        const {data,error} = await query.select('excluded_edges,revision').maybeSingle();
        if(error?.code === '23505' || (!error && !data)) return res.status(409).json({error:'มีการแก้ไขจากหน้าจออื่น กรุณาโหลดใหม่แล้วเลือกเส้นอีกครั้ง'});
        if(error) throw error;
        res.json(data);
    } catch(error) { res.status(500).json({error:'บันทึกไม่สำเร็จ กรุณาตรวจตารางและสิทธิ์ฐานข้อมูล แล้วโหลดใหม่'}); }
});

app.get('/api/gps/:vehicle_id', async (req, res) => {
    const { vehicle_id } = req.params;
    let { date } = req.query;

    try {
        // ใช้ขอบเขตวันของประเทศไทย (+07:00) ชัดเจน ป้องกันข้อมูลเที่ยงคืนเหลื่อมวันบน Render/UTC
        if (!date) {
            const thaiParts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
            }).formatToParts(new Date());
            const y = thaiParts.find(p => p.type === 'year')?.value;
            const m = thaiParts.find(p => p.type === 'month')?.value;
            const d = thaiParts.find(p => p.type === 'day')?.value;
            date = `${y}-${m}-${d}`;
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'รูปแบบ date ต้องเป็น YYYY-MM-DD' });
        }

        const startDate = new Date(`${date}T00:00:00+07:00`);
        const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

        // Supabase defaults to a page limit; retrieve the full day in stable order.
        const allPoints = [];
        for (let offset = 0; offset < 100000; offset += 1000) {
            const {data,error} = await supabase.from('gps_logs').select('*')
                .eq('vehicle_id',vehicle_id).gte('created_at',startDate.toISOString()).lt('created_at',endDate.toISOString())
                .order('created_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+999);
            if(error) throw error;
            allPoints.push(...(data || []));
            if(!data || data.length < 1000) return res.json(allPoints);
        }
        return res.status(422).json({error:'ข้อมูลเกิน 100,000 จุดต่อวัน กรุณาแบ่งช่วงข้อมูลก่อนคำนวณ'});
    } catch (err) {
        console.error('GPS API Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 👥 API สำหรับจัดการลูกค้า (Customers)
// ==========================================

// ดึงรายชื่อลูกค้าทั้งหมด
app.get('/api/customers', async (req, res) => {
    const { data, error } = await supabase.from('customers').select('*').order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// เพิ่มลูกค้าใหม่ตรงๆ ผ่านหน้าตั้งค่า
app.post('/api/customers', async (req, res) => {
    const { name, phone, address_note } = req.body;
    const { data, error } = await supabase
        .from('customers')
        .insert([{ name, phone: phone || null, address_note }])
        .select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

// แก้ไขข้อมูลลูกค้า
app.put('/api/customers/:id', async (req, res) => {
    const { id } = req.params;
    const { name, phone, address_note } = req.body;
    const { data, error } = await supabase
        .from('customers')
        .update({ name, phone: phone || null, address_note })
        .eq('id', id)
        .select();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ลบข้อมูลลูกค้า
app.delete('/api/customers/:id', async (req, res) => {
    const { id } = req.params;
    // หมายเหตุ: ถ้าระบบผูกคิวงานไว้กับลูกค้านี้ อาจจะลบไม่ได้ถ้าไม่ได้ตั้งค่า Cascade Delete ในฐานข้อมูล
    const { error } = await supabase.from('customers').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'ลบลูกค้าสำเร็จ' });
});

// ==========================================
// 💰 API สำหรับจัดการค่าแรงและระบบบัญชี
// ==========================================

// ดึงรายการค่าแรงที่ค้างจ่าย (UNPAID)
app.get('/api/transactions/wages', async (req, res) => {
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('type', 'OUT')
        .eq('category', 'ค่าแรง')
        .order('created_at', { ascending: false });
        
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// อัปเดตสถานะการจ่ายเงินให้ลูกจ้าง (จาก UNPAID เป็น PAID)
app.patch('/api/transactions/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status, paid_at } = req.body; // 👈 เพิ่มการรับค่า paid_at
    
    try {
        const updateData = { status };
        if (paid_at) updateData.paid_at = paid_at; // 👈 สั่งบันทึกเวลาลงตาราง

        const { data, error } = await supabase
            .from('transactions')
            .update(updateData)
            .eq('id', id)
            .select();
            
        if (error) throw error;
        res.json({ message: 'อัปเดตสถานะสำเร็จ', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 📊 API สำหรับ Dashboard สรุปรายเดือน
// ==========================================
app.get('/api/dashboard', async (req, res) => {
    const { month, year } = req.query;
    
    // สร้างช่วงวันที่สำหรับค้นหาในเดือนนั้นๆ
    const startDate = new Date(year, month - 1, 1).toISOString();
    const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();

    try {
        // 1. ดึงข้อมูลรายรับ (จากคิวงานที่ 'DONE')
        const { data: jobs } = await supabase
            .from('jobs')
            .select('total_price, payment_status, area_size, billing_area')
            .eq('status', 'DONE')
            .gte('job_date', startDate)
            .lte('job_date', endDate);

        // 2. ดึงข้อมูลรายจ่าย (จาก transactions)
        const { data: expenses } = await supabase
            .from('transactions')
            .select('total_amount, category')
            .eq('type', 'OUT')
            .gte('created_at', startDate)
            .lte('created_at', endDate);

        // คำนวณยอดต่างๆ
        let totalIncome = 0;
        let totalUnpaid = 0;
        let totalArea = 0;
        let totalExpense = 0;

        if (jobs) {
            jobs.forEach(job => {
                const price = Number(job.total_price) || 0;
                totalArea += Number(job.billing_area ?? job.area_size) || 0;
                
                if (job.payment_status === 'PAID') {
                    totalIncome += price;
                } else {
                    totalUnpaid += price; // ยอดที่ลูกค้ายังไม่จ่าย
                }
            });
        }

        if (expenses) {
            expenses.forEach(exp => {
                // ✅ ค่าแรงถูกบันทึกเป็นต้นทุนไปแล้วตอนปิดงาน
                // การ 'เบิกค่าแรง' เป็นเพียงการชำระหนี้ค่าแรง จึงห้ามนับเป็นต้นทุนซ้ำอีกครั้ง
                if (exp.category !== 'เบิกค่าแรง') {
                    totalExpense += Number(exp.total_amount) || 0;
                }
            });
        }

        res.json({
            totalIncome,
            totalUnpaid,
            totalExpense,
            netProfit: totalIncome - totalExpense,
            totalArea
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 💡 API สำหรับแก้ไขรายจ่าย (PUT)
app.put('/api/transactions/expenses/:id', upload.single('receipt'), async (req, res) => {
    const { id } = req.params;
    let { category, total_amount, vehicle_id, spender_name, transaction_date, note, existing_receipt_url } = req.body;
    const file = req.file;
    let receiptUrl = existing_receipt_url || null; // ถ้าไม่ได้แนบรูปใหม่ ให้ใช้รูปเดิมไปก่อน

    try {
        // 1. ถ้ามีการอัปโหลดรูป "ใหม่" เข้ามา ให้เอาขึ้น Storage
        if (file) {
            const fileExt = file.originalname.split('.').pop() || 'jpg';
            const fileName = `expense_${Date.now()}.${fileExt}`;
            
            const { data: storageData, error: storageError } = await supabase.storage
                .from('job-attachments') 
                .upload(fileName, file.buffer, { contentType: file.mimetype });
            
            if (storageError) throw storageError;

            const { data: publicUrlData } = supabase.storage
                .from('job-attachments')
                .getPublicUrl(fileName);
            receiptUrl = publicUrlData.publicUrl;
        }

        // 2. จัดเตรียมข้อมูลที่จะอัปเดต
        const updateData = {
            category: category || 'ทั่วไป',
            total_amount: Number(total_amount),
            paid_amount: Number(total_amount),
            vehicle_id: vehicle_id ? Number(vehicle_id) : null,
            spender_name: spender_name,
            note: note,
            transaction_date: transaction_date || new Date().toISOString(),
            receipt_url: receiptUrl
        };

        // 3. บันทึกการแก้ไขลงตาราง
        const { data, error } = await supabase
            .from('transactions')
            .update(updateData)
            .eq('id', id)
            .select();

        if (error) throw error;
        res.json({ message: 'แก้ไขค่าใช้จ่ายสำเร็จ', data });

    } catch (err) {
        console.error('Update Expense API Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});


// 💰 API สำหรับบันทึกค่าใช้จ่ายทั่วไป (พร้อมแนบใบเสร็จ)
app.post('/api/transactions/expenses', upload.single('receipt'), async (req, res) => {
    let { category, total_amount, job_id, vehicle_id, spender_name, transaction_date, note } = req.body;
    const file = req.file;
    let receiptUrl = null;

    try {
        // 1. ถ้ามีการแนบรูปใบเสร็จมา ให้อัปโหลดขึ้น Supabase Storage ก่อน
        if (file) {
            const fileExt = file.originalname.split('.').pop() || 'jpg';
            const fileName = `expense_${Date.now()}.${fileExt}`;
            
            const { data: storageData, error: storageError } = await supabase.storage
                .from('job-attachments') // ✅ เปลี่ยนเป็นชื่อถังที่มีอยู่แล้ว
                .upload(fileName, file.buffer, { contentType: file.mimetype });
            
            if (storageError) throw storageError;

            const { data: publicUrlData } = supabase.storage
                .from('job-attachments') // ✅ เปลี่ยนเป็นชื่อถังที่มีอยู่แล้ว
                .getPublicUrl(fileName);
            receiptUrl = publicUrlData.publicUrl;
        }

        // 2. บันทึกข้อมูลลงตาราง transactions
        const { data, error } = await supabase
            .from('transactions')
            .insert([{
                type: 'OUT',
                category: category || 'ทั่วไป',
                total_amount: Number(total_amount),
                paid_amount: Number(total_amount), // ถือว่าจ่ายไปแล้ว
                status: 'PAID', // ไม่ต้องรอเบิก
                job_id: job_id ? Number(job_id) : null,
                vehicle_id: vehicle_id ? Number(vehicle_id) : null,
                spender_name: spender_name,
                note: note,
                transaction_date: transaction_date || new Date().toISOString(),
                receipt_url: receiptUrl
            }])
            .select();

        if (error) throw error;
        res.status(201).json({ message: 'บันทึกค่าใช้จ่ายสำเร็จ', data });

    } catch (err) {
        console.error('Expense API Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// เพิ่ม Route สำหรับดึงข้อมูลรายจ่าย
app.get('/api/transactions/expenses', async (req, res) => {
  try {
    // ✅ ดึง OUT ทั้งหมด เพราะ Dashboard ต้องใช้ทั้งต้นทุน 'ค่าแรง' และรายจ่ายทั่วไป
    // ส่วน 'เบิกค่าแรง' จะถูกแยกออกตอนคำนวณกำไร เพื่อไม่ให้นับต้นทุนซ้ำ
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('type', 'OUT')
      .not('category', 'is', null)
      .order('transaction_date', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// เพิ่ม Route สำหรับลบรายจ่าย
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 💸 API สำหรับจัดการสถานะการเงิน (ทวงหนี้)
app.patch('/api/jobs/:id/payment', async (req, res) => {
    const { id } = req.params;
    const { payment_status, paid_at } = req.body; // 👈 เพิ่มการรับเวลาที่กดจ่ายเงิน

    try {
        const updateData = { payment_status };
        if (paid_at) updateData.paid_at = paid_at; // 👈 บันทึกเวลาลงฐานข้อมูล

        const { data, error } = await supabase
            .from('jobs')
            .update(updateData)
            .eq('id', id)
            .select();

        if (error) throw error;
        await writeJobAudit(id, 'PAYMENT_STATUS_CHANGED', `สถานะการเงินเป็น ${payment_status}${paid_at ? ` • เวลา ${paid_at}` : ''}`, null, data?.[0] || null);
        res.json({ message: 'อัปเดตสถานะการเงินสำเร็จ', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 📸 API สำหรับอัปโหลดและดึงรูปภาพ (Attachments)
// ==========================================

// 1. ดึงรูปภาพของคิวงานนั้นๆ (GET)
app.get('/api/jobs/:id/attachments', async (req, res) => {
    const { id } = req.params;
    try {
        const { data, error } = await supabase
            .from('attachments')
            .select('*')
            .eq('job_id', id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. อัปโหลดรูปภาพใหม่ (POST)
app.post('/api/jobs/:id/attachments', upload.single('image'), async (req, res) => {
    const { id } = req.params;
    const { category } = req.body; 
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'กรุณาแนบไฟล์รูปภาพ' });

    try {
        // 1. ตั้งชื่อไฟล์ใหม่ไม่ให้ซ้ำกัน
        const fileExt = file.originalname.split('.').pop() || 'jpg';
        const fileName = `job_${id}_${Date.now()}.${fileExt}`;
        
        // 2. โยนไฟล์ขึ้นถัง Supabase Storage
        const { data: storageData, error: storageError } = await supabase.storage
            .from('job-attachments')
            .upload(fileName, file.buffer, {
                contentType: file.mimetype,
            });
        if (storageError) throw storageError;

        // 3. ขอลิงก์ Public URL จาก Supabase 
        const { data: publicUrlData } = supabase.storage
            .from('job-attachments')
            .getPublicUrl(fileName);
        const imageUrl = publicUrlData.publicUrl;

        // 4. บันทึกลิงก์ URL ลงในตาราง attachments
        const { data: dbData, error: dbError } = await supabase
            .from('attachments')
            .insert([{ job_id: id, category: category || 'GENERAL', image_url: imageUrl }])
            .select();
        if (dbError) throw dbError;

        res.status(201).json({ message: 'อัปโหลดสำเร็จ!', data: dbData });
    } catch (err) {
        console.error('Upload Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 3. ลบรูปภาพ (DELETE)
app.delete('/api/jobs/attachments/:id', async (req, res) => {
    const { id } = req.params;
    const { image_url } = req.body; // รับ URL ของรูปมาเพื่อไปตามลบไฟล์ทิ้ง

    try {
        // 1. ลบไฟล์ออกจากถัง Storage (เพื่อไม่ให้เปลืองพื้นที่แพ็กเกจฟรี)
        if (image_url) {
            const fileName = image_url.split('/').pop(); 
            await supabase.storage.from('job-attachments').remove([fileName]);
        }

        // 2. ลบประวัติออกจากฐานข้อมูล
        const { error } = await supabase.from('attachments').delete().eq('id', id);
        if (error) throw error;

        res.json({ message: 'ลบรูปภาพสำเร็จเรียบร้อย' });
    } catch (err) {
        console.error('Delete Image Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 🧹 ระบบทำความสะอาด: ลบข้อมูลพิกัด GPS ที่เก่าเกิน 7 วันทิ้งอัตโนมัติ
setInterval(async () => {
    // คำนวณหาวันที่ย้อนหลัง 7 วัน
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    try {
        const { error } = await supabase
            .from('gps_logs')
            .delete()
            .lt('created_at', sevenDaysAgo.toISOString()); // ลบข้อมูลที่เก่ากว่า 7 วัน

        if (error) throw error;
        console.log(`🗑️ ล้างข้อมูล GPS ที่เก่ากว่าวันที่ ${sevenDaysAgo.toLocaleDateString()} ออกจากระบบเรียบร้อย`);
    } catch (err) {
        console.error('❌ เกิดข้อผิดพลาดในการลบข้อมูล GPS เก่า:', err.message);
    }
}, 1000 * 60 * 60 * 24); // สั่งให้ระบบทำงานทุกๆ 24 ชั่วโมง (1 วัน)

// ==========================================
// 🌾 ระบบจัดการแปลงที่วาด (เก็บถาวร)
// ==========================================

// Validate ring structure without dropping hole metadata or changing legacy plots.
// Geometry clipping/area use Turf in App.jsx; no extra backend package or SQL migration.
const validatePlotsData = (plots) => {
    if (!Array.isArray(plots) || plots.length > 200) return 'plots_data ต้องเป็น Array ไม่เกิน 200 แปลง';
    const validRing = (points) => Array.isArray(points) && points.length >= 3 && points.length <= 2000 && points.every(p =>
        p && p.lat != null && p.lng != null && p.lat !== '' && p.lng !== '' &&
        ['number', 'string'].includes(typeof p.lat) && ['number', 'string'].includes(typeof p.lng) &&
        Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) &&
        Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lng)) <= 180
    );
    for (let i = 0; i < plots.length; i++) {
        const plot = plots[i];
        if (!plot || !validRing(plot.points)) return `ขอบแปลง ${i + 1} ไม่ถูกต้อง (3–2000 จุด)`;
        for (const field of ['holes', 'holeSuggestions']) {
            if (plot[field] === undefined) continue; // Old saved plots have no holes.
            if (!Array.isArray(plot[field]) || plot[field].length > 100) return `${field} ของแปลง ${i + 1} ต้องเป็น Array ไม่เกิน 100 วง`;
            const ids = new Set();
            for (const hole of plot[field]) {
                if (!hole || typeof hole.id !== 'string' || !hole.id || hole.id.length > 120 || ids.has(hole.id) || !validRing(hole.points)) {
                    return `วงพื้นที่หักของแปลง ${i + 1} ไม่ถูกต้อง`;
                }
                if (field === 'holeSuggestions' && !['pending', 'dismissed'].includes(hole.status)) return 'สถานะข้อเสนอพื้นที่หักไม่ถูกต้อง';
                ids.add(hole.id);
            }
        }
    }
    return null;
};

// 💾 ดึงแปลงตามรถ + วันที่
app.get('/api/plots-snapshot/:vehicle_id', async (req,res) => {
    if(!validRouteScope(req.params.vehicle_id,req.query.date)) return res.status(400).json({error:'รถหรือวันที่ไม่ถูกต้อง'});
    try {
      const {data,error}=await supabase.from('harvest_plots').select('plots_data,revision').eq('vehicle_id',Number(req.params.vehicle_id)).eq('work_date',req.query.date).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
      if(error) throw error;
      res.set('Cache-Control','no-store').json({plots_data:data?.plots_data || [],revision:data?.revision || 0});
    } catch(e) { res.status(500).json({error:'โหลดแปลงไม่สำเร็จ ตรวจ migration GPS_JOB_LINK.sql'}); }
});

app.get('/api/plots/:vehicle_id', async (req, res) => {
    const { vehicle_id } = req.params;
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'กรุณาระบุ date รูปแบบ YYYY-MM-DD' });
    }

    try {
        const { data, error } = await supabase
            .from('harvest_plots')
            .select('id, plots_data, created_at')
            .eq('vehicle_id', vehicle_id)
            .eq('work_date', date)
            .order('created_at', { ascending: false })
            .limit(1);

        if (error) throw error;
        res.json(data && data.length > 0 && Array.isArray(data[0].plots_data) ? data[0].plots_data : []);
    } catch (err) {
        console.error('Load Plots API Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 💾 บันทึกแบบปลอดภัย: ถ้ามีแถวเดิมให้อัปเดต ไม่ลบก่อน insert
app.post('/api/plots', async (req,res) => {
    const {vehicle_id,work_date,plots_data,expected_revision}=req.body || {};
    if(!validRouteScope(vehicle_id,work_date) || !Number.isSafeInteger(expected_revision) || expected_revision<0) return res.status(400).json({error:'กรุณาอัปเดตหน้าแอปและโหลดแปลงล่าสุดก่อนบันทึก'});
    const invalid=validatePlotsData(plots_data);
    if(invalid) return res.status(400).json({error:invalid});
    let normalized;
    try { normalized=normalizeJobPlots(plots_data,vehicle_id,work_date); } catch(e) {return res.status(400).json({error:e.message});}
    try {
      const {data,error}=await supabase.rpc('save_gps_job_plots',{p_vehicle_id:Number(vehicle_id),p_work_date:work_date,p_plots:normalized,p_expected_revision:expected_revision});
      if(error) {
        if(String(error.message).includes('GPS_REVISION_CONFLICT')) return res.status(409).json({error:'อีกหน้าจอแก้แปลงแล้ว กรุณาโหลดแปลงล่าสุด แล้วเลือกคิวใหม่'});
        if(String(error.message).includes('GPS_JOB_NOT_FOUND')) return res.status(400).json({error:'คิวที่เลือกถูกลบแล้ว กรุณาเลือกคิวใหม่'});
        throw error;
      }
      res.json({success:true,...data});
    } catch(e) {res.status(500).json({error:'บันทึกแปลงไม่ได้ กรุณาตรวจ GPS_JOB_LINK.sql และสิทธิ์เซิร์ฟเวอร์'});}
});

// หมายเหตุ: แปลงที่วาดจะเก็บถาวร ไม่ถูกลบตามระบบล้าง GPS 7 วัน

// ล็อก Port ที่ 3000 และเปิดเซิร์ฟเวอร์
const server = app.listen(3000, () => {
    console.log(`✅ เซิร์ฟเวอร์รันแล้วที่: http://localhost:3000`);
    console.log(`⏳ ระบบกำลังเปิดค้างไว้เพื่อรอรับแขก... (ห้ามปิดหน้าจอนี้นะครับ)`);
});

// ดักจับ Error เผื่อระบบรันไม่ได้หรือ Port โดนแย่งใช้งาน
server.on('error', (err) => {
    console.error('❌ เซิร์ฟเวอร์รันไม่ได้ เกิดข้อผิดพลาด:', err.message);
});

// ทริกยื้อชีวิตเซิร์ฟเวอร์ บังคับไม่ให้ปิดตัวเอง
setInterval(() => {}, 1000 * 60 * 60);

// ==========================================
// 🛰️ TCP Server สำหรับรับข้อมูลจากกล่อง GPS ST-901
// ==========================================
const net = require('net');

// ฟังก์ชันแปลงพิกัด (จาก DDMM.MMMM ของ GPS ให้เป็น Decimal ปกติของ Google Maps)
function convertToDecimal(raw, dir) {
    let degrees, minutes;
    if (raw.indexOf('.') === 4) { 
        degrees = parseInt(raw.substring(0, 2));
        minutes = parseFloat(raw.substring(2));
    } else { 
        degrees = parseInt(raw.substring(0, 3));
        minutes = parseFloat(raw.substring(3));
    }
    let decimal = degrees + (minutes / 60);
    if (dir === 'S' || dir === 'W') decimal = decimal * -1;
    return decimal.toFixed(7);
}

const GPS_PORT = 5000;

// 🧠 จำจุดล่าสุดของรถไว้ใน RAM เพื่อช่วยประเมินความเร็วจริงจากระยะทาง
// มีประโยชน์กับ ST-901 ที่บางครั้งรายงาน speed=0 ตอนรถคลานช้าในแปลง
const lastGpsByVehicle = new Map();

function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (v) => (Number(v) * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(Number(lat2) - Number(lat1));
    const dLon = toRad(Number(lon2) - Number(lon1));
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

const gpsServer = net.createServer((socket) => {
    console.log('📡 มีการเชื่อมต่อเข้ามาที่ Port GPS!');

    socket.on('data', async (data) => {
        const rawData = data.toString().trim();
        console.log(`[Raw Data]: ${rawData}`); // แสดงข้อมูลดิบที่ส่งมาจากกล่อง

        // ตัวอย่างข้อมูล: *HQ,IMEI,V1,Time,A,Lat,N,Lon,E,Speed,Course,Date,VehicleStatus#
        if (rawData.startsWith('*HQ') && rawData.endsWith('#')) {
            const parts = rawData.replace('*HQ,', '').replace('#', '').split(',');
            
            // เช็คว่าเป็นข้อมูลพิกัด (V1)
            if (parts.length >= 12 && parts[1].startsWith('V')) {
                const status = parts[3];     
                const latRaw = parts[4]; 
                const latDir = parts[5]; 
                const lonRaw = parts[6]; 
                const lonDir = parts[7];

                // 💡 1. ดึงค่าความเร็วจากกล่อง (หน่วย Knots แล้วแปลงเป็น กม./ชม.)
                const speedKnots = parseFloat(parts[8]) || 0;
                const speedKmH = speedKnots * 1.852; 

                if (status === 'A') {
                    const lat = Number(convertToDecimal(latRaw, latDir));
                    const lon = Number(convertToDecimal(lonRaw, lonDir));
                    const vehicleId = 1; // TODO V3: ผูก IMEI -> vehicle_id อัตโนมัติ

                    // 💡 วิเคราะห์กำลังเกี่ยว 2 ชั้น
                    // 1) ความเร็วจากกล่อง
                    const byDeviceSpeed = speedKmH >= 0.4 && speedKmH <= 15;

                    // 2) ถ้ากล่องรายงาน 0 ให้คำนวณจากระยะ GPS / เวลาจริง
                    const nowMs = Date.now();
                    const prev = lastGpsByVehicle.get(vehicleId);
                    let inferredSpeedKmH = null;
                    let byMovement = false;

                    if (prev) {
                        const dtSec = (nowMs - prev.at) / 1000;
                        const km = haversineKm(prev.lat, prev.lon, lat, lon);

                        if (dtSec > 0 && dtSec <= 180 && Number.isFinite(km) && km < 0.25) {
                            inferredSpeedKmH = km / (dtSec / 3600);
                            const movedMeters = km * 1000;
                            byMovement =
                                movedMeters >= 1.5 &&
                                inferredSpeedKmH >= 0.4 &&
                                inferredSpeedKmH <= 15;
                        }
                    }

                    const isHarvesting = byDeviceSpeed || byMovement;
                    lastGpsByVehicle.set(vehicleId, { lat, lon, at: nowMs });

                    console.log(
                        `📍 Lat ${lat}, Lon ${lon}` +
                        ` | 🚀 กล่อง: ${speedKmH.toFixed(2)} กม./ชม.` +
                        ` | 🧭 คำนวณ: ${inferredSpeedKmH === null ? '-' : inferredSpeedKmH.toFixed(2)} กม./ชม.` +
                        ` | 🌾 กำลังเกี่ยว: ${isHarvesting}`
                    );

                    // โยนข้อมูลเข้า Database Supabase ของเรา
                    try {
                        // 💡 สมมติให้กล่องนี้เป็นของรถ "คันที่ 1" (vehicle_id: 1) ในช่วงทดสอบ
                        const { error } = await supabase.from('gps_logs').insert([{
                            vehicle_id: vehicleId,
                            latitude: lat,
                            longitude: lon,
                            is_harvesting: isHarvesting // 👈 บันทึกความฉลาด (true/false) ลงฐานข้อมูล
                        }]);
                        
                        if (error) throw error;
                        console.log(`✅ บันทึกพิกัดลงฐานข้อมูลสำเร็จ!`);
                    } catch (err) {
                        console.error('❌ บันทึกพิกัดไม่สำเร็จ:', err.message);
                    }
                } else {
                    console.log('⚠️ กล่องยังจับสัญญาณดาวเทียมไม่ได้ (รอสักครู่)');
                }
            }
        }
    });

    socket.on('error', (err) => {
        console.error('⚠️ ข้อผิดพลาดจากระบบรับ GPS:', err.message);
    });
});

gpsServer.listen(GPS_PORT, () => {
    console.log(`📡 TCP GPS Server รันแล้วที่ Port: ${GPS_PORT}`);
    console.log(`⏳ รอรับสัญญาณจากกล่อง ST-901 ผ่าน Ngrok...`);
});