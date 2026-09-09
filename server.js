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

    res.json((data || []).map(job => {
        const work_rounds = roundsByJob.get(Number(job.id)) || [];
        const measured_area_total = work_rounds.reduce((sum, r) => sum + (Number(r.measured_area) || 0), 0);
        const wage_area_total = work_rounds.reduce((sum, r) => sum + (Number(r.wage_area) || 0), 0);
        return {
            ...job,
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
        res.status(201).json({ message: 'บันทึกคิวงานสำเร็จ!', data: newJob });

    } catch (err) {
        console.error('API Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// API สำหรับอัปเดตเปลี่ยนสถานะงาน (เช่น กดเสร็จสิ้น หรือ กำลังเกี่ยว)
app.patch('/api/jobs/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status, wageData, job_date } = req.body;

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

        // 💡 สร้างกล่องเก็บข้อมูลที่จะอัปเดต
        const updateData = { status };
        if (job_date) {
            updateData.job_date = job_date; // ถ้ามีวันที่ส่งมาด้วย ให้จับใส่กล่องไปอัปเดตพร้อมกัน
        }

        // 1. อัปเดตสถานะงาน (และเวลาถ้ามี) ให้เป็น DONE, IN_PROGRESS ฯลฯ
        const { data: updatedJob, error: jobError } = await supabase
            .from('jobs')
            .update(updateData) // 👈 เปลี่ยนมาใช้กล่องข้อมูลที่เราเตรียมไว้
            .eq('id', id)
            .select()
            .single();

        if (jobError) throw jobError;
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

const reconcileJobWageArea = async (jobId, targetArea) => {
    const target = Math.max(0, safeRoundNumber(targetArea));

    const { data: rounds, error: roundsError } = await supabase
        .from('job_work_rounds')
        .select('*')
        .eq('job_id', jobId)
        .order('work_date', { ascending: true });

    if (roundsError) throw roundsError;

    // ===== ระบบรอบงานใหม่ =====
    if (rounds && rounds.length > 0) {
        const rows = rounds.map(r => ({ ...r, old_area: Math.max(0, safeRoundNumber(r.wage_area)), new_area: Math.max(0, safeRoundNumber(r.wage_area)) }));
        const beforeArea = rows.reduce((sum, r) => sum + r.old_area, 0);

        // ✅ ปรับตรงที่ "งาน/แปลงนี้" เท่านั้น
        // ถ้ามีหลายรอบใน job เดียวกัน ให้รักษาสัดส่วนเดิมของแต่ละรอบ/คนงาน
        if (beforeArea > 1e-9) {
            const ratio = target / beforeArea;
            rows.forEach(row => {
                row.new_area = Math.max(0, row.old_area * ratio);
            });

            // ชดเชยเศษ floating point ให้ยอดรวมสุดท้ายตรง target จริง
            const current = rows.reduce((sum, r) => sum + r.new_area, 0);
            const remainder = target - current;
            if (Math.abs(remainder) > 1e-9) {
                let idx = -1;
                for (let i = rows.length - 1; i >= 0; i--) {
                    if (rows[i].old_area > 0 || String(rows[i].workers || '').trim()) { idx = i; break; }
                }
                if (idx >= 0) rows[idx].new_area = Math.max(0, rows[idx].new_area + remainder);
            }
        } else if (target > 1e-9) {
            // งานเก่าบางรายการอาจมี round แต่ wage_area เดิมเป็น 0
            let idx = -1;
            for (let i = rows.length - 1; i >= 0; i--) {
                if (String(rows[i].workers || '').trim()) { idx = i; break; }
            }
            if (idx === -1) {
                const err = new Error(`ต้องเพิ่มค่าแรง ${target.toFixed(2)} ไร่ แต่ไม่พบชื่อคนงานในรอบเดิม`);
                err.code = 'NO_WORKER_FOR_WAGE_INCREASE';
                throw err;
            }
            rows[idx].new_area = target;
        } else {
            rows.forEach(row => { row.new_area = 0; });
        }

        const changed = [];
        let amountBefore = 0;
        let amountAfter = 0;
        try {
            for (const row of rows) {
                const rate = Math.max(0, safeRoundNumber(row.wage_per_rai, 60));
                amountBefore += row.old_area * rate;
                amountAfter += row.new_area * rate;
                if (Math.abs(row.new_area - row.old_area) < 1e-9) continue;

                let txSnapshot = null;
                let createdTxId = null;
                let wageTxId = row.wage_transaction_id || null;

                if (wageTxId) {
                    const { data: txData, error: txFindError } = await supabase
                        .from('transactions')
                        .select('id,total_amount,note,status')
                        .eq('id', wageTxId)
                        .maybeSingle();
                    if (txFindError) throw txFindError;
                    txSnapshot = txData || null;
                }

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

                if (wageTxId && !txSnapshot) {
                    // สำคัญ: ถ้ามี transaction id อยู่ แต่ server อ่านไม่เห็น ห้ามสร้างบิลซ้ำ
                    const err = new Error(`พบบิลค่าแรง #${wageTxId} แต่ Server อ่าน/แก้ไม่ได้ (ตรวจ SUPABASE_SERVICE_ROLE_KEY ที่ Render)`);
                    err.code = 'WAGE_TX_NOT_VISIBLE';
                    throw err;
                }

                if (wageTxId && txSnapshot) {
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
                } else if (row.new_area > 0) {
                    createdTxId = await createRoundWageTransaction({
                        jobId,
                        roundId: row.id,
                        workers: String(row.workers || '').trim() || 'ไม่ระบุ',
                        wageArea: row.new_area,
                        wagePerRai: rate,
                        roundDate: row.work_date,
                        roundType: row.round_type
                    });
                    if (createdTxId) {
                        const { error: linkError } = await supabase
                            .from('job_work_rounds')
                            .update({ wage_transaction_id: createdTxId })
                            .eq('id', row.id);
                        if (linkError) throw linkError;
                        wageTxId = createdTxId;
                    }
                }

                changed.push({
                    roundId: row.id,
                    oldArea: row.old_area,
                    oldWageTxId: row.wage_transaction_id || null,
                    txSnapshot,
                    createdTxId
                });
            }
        } catch (err) {
            // พยายามย้อนคืนเฉพาะสิ่งที่แก้ใน helper นี้
            for (const item of [...changed].reverse()) {
                try { await supabase.from('job_work_rounds').update({ wage_area: item.oldArea, wage_transaction_id: item.oldWageTxId }).eq('id', item.roundId); } catch (_) {}
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
            allocation_mode: 'SAME_JOB_PROPORTIONAL'
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

// 🌾 ปิด "รอบวันนี้" แต่ยังไม่ปิดงานลูกค้า
// measured_area = วันนี้วัดจริงกี่ไร่
// ค่าแรงรอบกลางทางจะล็อกตาม measured_area วันนี้ทันที
app.post('/api/jobs/:id/rounds', async (req, res) => {
    const jobId = Number(req.params.id);
    const {
        measured_area,
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
    let wageTransactionId = null;
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
                wage_area: measuredArea,
                wage_per_rai: wagePerRai,
                workers: workerText,
                note: String(note || '').trim() || null,
                round_type: 'PARTIAL'
            }])
            .select()
            .single();

        if (roundError) throw roundError;
        roundId = round.id;

        wageTransactionId = await createRoundWageTransaction({
            jobId,
            roundId: round.id,
            workers: workerText,
            wageArea: measuredArea,
            wagePerRai,
            roundDate: nowIso,
            roundType: 'PARTIAL'
        });

        if (wageTransactionId) {
            const { error: linkError } = await supabase
                .from('job_work_rounds')
                .update({ wage_transaction_id: wageTransactionId })
                .eq('id', round.id);
            if (linkError) throw linkError;
        }

        const jobUpdate = { status: 'PAUSED' };
        if (next_work_date) jobUpdate.job_date = next_work_date;

        const { data: updatedJob, error: updateError } = await supabase
            .from('jobs')
            .update(jobUpdate)
            .eq('id', jobId)
            .select()
            .single();

        if (updateError) throw updateError;

        res.status(201).json({
            success: true,
            message: 'บันทึกรอบวันนี้และค่าแรงเรียบร้อย',
            round: { ...round, wage_transaction_id: wageTransactionId },
            job: updatedJob
        });
    } catch (err) {
        if (wageTransactionId) {
            try { await supabase.from('transactions').delete().eq('id', wageTransactionId); } catch (_) {}
        }
        if (roundId) {
            try { await supabase.from('job_work_rounds').delete().eq('id', roundId); } catch (_) {}
        }
        console.error('Create Work Round Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 🏁 ปิดงานทั้งหมด
// วัดจริงสะสม = รอบก่อน + measured_area วันนี้
// ค่าแรงรอบสุดท้าย = max(0, พื้นที่ที่ตกลงกับลูกค้า - ค่าแรงที่ล็อกไปก่อนหน้า)
// ตัวอย่าง: ล็อกไป 10 ไร่, วัดจริงรวม 37, ลูกค้าตกลง 35 => รอบสุดท้ายลงค่าแรง 25 ไร่
app.post('/api/jobs/:id/finalize', async (req, res) => {
    const jobId = Number(req.params.id);
    const {
        measured_area = 0,
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

    let roundId = null;
    let wageTransactionId = null;
    try {
        const { data: job, error: jobError } = await supabase
            .from('jobs')
            .select('id, status, price_per_rai, crop_type')
            .eq('id', jobId)
            .single();

        if (jobError) throw jobError;
        if (!job) return res.status(404).json({ error: 'ไม่พบคิวงาน' });
        if (job.status === 'DONE') return res.status(400).json({ error: 'งานนี้ปิดจบไปแล้ว' });

        const { data: priorRounds, error: roundsError } = await supabase
            .from('job_work_rounds')
            .select('measured_area, wage_area')
            .eq('job_id', jobId);

        if (roundsError) throw roundsError;

        const priorMeasuredArea = (priorRounds || []).reduce((sum, r) => sum + (Number(r.measured_area) || 0), 0);
        const priorWageArea = (priorRounds || []).reduce((sum, r) => sum + (Number(r.wage_area) || 0), 0);

        const measuredAreaTotal = priorMeasuredArea + todayMeasured;
        const finalWageArea = Math.max(0, billingArea - priorWageArea);
        // ถ้ายอดลูกค้าต่ำกว่าค่าแรงที่ล็อกก่อนหน้า หลังสร้างรอบสุดท้ายจะปรับค่าแรงย้อนหลังให้ตรงยอดลูกค้า
        const wageOverageAreaBeforeAdjust = Math.max(0, priorWageArea - billingArea);

        if (finalWageArea > 0 && !workerText) {
            return res.status(400).json({ error: `ยังเหลือค่าแรง ${finalWageArea.toFixed(2)} ไร่ กรุณาระบุคนที่จะรับค่าแรงรอบสุดท้าย` });
        }

        const nowIso = new Date().toISOString();
        const { data: round, error: roundError } = await supabase
            .from('job_work_rounds')
            .insert([{
                job_id: jobId,
                work_date: nowIso,
                measured_area: todayMeasured,
                wage_area: finalWageArea,
                wage_per_rai: wagePerRai,
                workers: workerText || 'ปรับยอดปิดงาน',
                note: String(note || '').trim() || null,
                round_type: 'FINAL'
            }])
            .select()
            .single();

        if (roundError) throw roundError;
        roundId = round.id;

        wageTransactionId = await createRoundWageTransaction({
            jobId,
            roundId: round.id,
            workers: workerText || 'ปรับยอดปิดงาน',
            wageArea: finalWageArea,
            wagePerRai,
            roundDate: nowIso,
            roundType: 'FINAL'
        });

        if (wageTransactionId) {
            const { error: linkError } = await supabase
                .from('job_work_rounds')
                .update({ wage_transaction_id: wageTransactionId })
                .eq('id', round.id);
            if (linkError) throw linkError;
        }

        // ✅ กฎใหม่: ไร่ค่าแรงสุดท้ายต้องตรงกับไร่ที่ลูกค้ายืนยัน
        // วัดจริงยังเก็บเท่าเดิม แต่ wage_area / บิลค่าแรงจะถูกปรับให้รวม = billingArea
        const wageReconciliation = await reconcileJobWageArea(jobId, billingArea);

        const pricePerRai = Math.max(0, Number(job.price_per_rai) || 0);
        const totalPrice = billingArea * pricePerRai;

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

        res.json({
            success: true,
            message: 'ปิดงานทั้งหมดเรียบร้อย',
            job: updatedJob,
            summary: {
                prior_measured_area: priorMeasuredArea,
                today_measured_area: todayMeasured,
                measured_area_total: measuredAreaTotal,
                prior_wage_area: priorWageArea,
                final_wage_area: finalWageArea,
                wage_area_total: wageReconciliation.after_area,
                billing_area: billingArea,
                wage_overage_area_before_adjust: wageOverageAreaBeforeAdjust,
                wage_adjustment_area: wageReconciliation.area_delta,
                wage_adjustment_amount: wageReconciliation.amount_delta,
                total_price: totalPrice
            }
        });
    } catch (err) {
        if (wageTransactionId) {
            try { await supabase.from('transactions').delete().eq('id', wageTransactionId); } catch (_) {}
        }
        if (roundId) {
            try { await supabase.from('job_work_rounds').delete().eq('id', roundId); } catch (_) {}
        }
        console.error('Finalize Job Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});


// 📐 แก้ "ไร่ที่ลูกค้ายืนยัน" หลังปิดงาน แต่ก่อนรับเงินเสร็จ
// - measured_area / area_size ไม่แก้ทับ: เก็บเป็นหลักฐานวัดจริง/ข้อมูลเดิม
// - billing_area + total_price ปรับตามลูกค้า
// - ค่าแรงทั้งงานถูก reconcile ให้จำนวนไร่รวมตรง billing_area
// - ส่วนลดเป็น "จำนวนเงิน" ยังเป็นระบบเดิมและไม่กระทบค่าแรง
app.patch('/api/jobs/:id/billing-area', async (req, res) => {
    const jobId = Number(req.params.id);
    const billingArea = safeRoundNumber(req.body?.billing_area, NaN);

    if (!Number.isFinite(jobId) || jobId <= 0) return res.status(400).json({ error: 'job_id ไม่ถูกต้อง' });
    if (!Number.isFinite(billingArea) || billingArea < 0) return res.status(400).json({ error: 'กรุณาระบุไร่ที่ลูกค้ายืนยันให้ถูกต้อง' });

    let wageResult = null;
    let oldJobSnapshot = null;
    try {
        const { data: job, error: jobError } = await supabase
            .from('jobs')
            .select('id,status,payment_status,area_size,billing_area,price_per_rai,total_price')
            .eq('id', jobId)
            .single();

        if (jobError) throw jobError;
        if (!job) return res.status(404).json({ error: 'ไม่พบคิวงาน' });
        if (job.status !== 'DONE') return res.status(400).json({ error: 'แก้ไร่ลูกค้าได้หลังปิดงานแล้วเท่านั้น' });
        if (job.payment_status === 'PAID') return res.status(400).json({ error: 'งานนี้รับเงินและปิดบิลแล้ว กรุณาอย่าแก้ไร่ย้อนหลังจากหน้าลูกหนี้' });

        const oldBillingArea = Math.max(0, safeRoundNumber(job.billing_area ?? job.area_size, 0));
        const rate = Math.max(0, safeRoundNumber(job.price_per_rai, 0));
        const oldInvoice = oldBillingArea * rate;
        const currentDebt = Math.max(0, safeRoundNumber(job.total_price, 0));
        const alreadyPaid = job.payment_status === 'DEPOSIT'
            ? Math.max(0, oldInvoice - currentDebt)
            : 0;

        const newInvoice = billingArea * rate;
        const newDebt = Math.max(0, newInvoice - alreadyPaid);
        const newPaymentStatus = alreadyPaid > 0
            ? (newDebt <= 0.000001 ? 'PAID' : 'DEPOSIT')
            : (job.payment_status || 'UNPAID');

        // ปรับค่าแรงก่อน ถ้าล้มเหลวจะยังไม่แตะยอดลูกค้า
        wageResult = await reconcileJobWageArea(jobId, billingArea);

        oldJobSnapshot = {
            billing_area: job.billing_area,
            total_price: job.total_price,
            payment_status: job.payment_status
        };

        const { data: updatedJob, error: updateError } = await supabase
            .from('jobs')
            .update({
                billing_area: billingArea,
                total_price: newDebt,
                payment_status: newPaymentStatus
            })
            .eq('id', jobId)
            .select()
            .single();

        if (updateError) {
            // ค่าแรงถูกปรับแล้ว แต่ยอดลูกค้าอัปเดตไม่ได้: พยายามย้อนค่าแรงกลับ
            try { await reconcileJobWageArea(jobId, wageResult.before_area); } catch (_) {}
            throw updateError;
        }

        res.json({
            success: true,
            message: 'ปรับไร่ลูกค้าและค่าแรงเรียบร้อย',
            job: updatedJob,
            summary: {
                measured_or_original_area: Math.max(0, safeRoundNumber(job.area_size, 0)),
                old_billing_area: oldBillingArea,
                new_billing_area: billingArea,
                billing_area_delta: billingArea - oldBillingArea,
                old_invoice: oldInvoice,
                new_invoice: newInvoice,
                already_paid: alreadyPaid,
                new_debt: newDebt,
                wage_area_before: wageResult.before_area,
                wage_area_after: wageResult.after_area,
                wage_area_delta: wageResult.area_delta,
                wage_amount_before: wageResult.amount_before,
                wage_amount_after: wageResult.amount_after,
                wage_amount_delta: wageResult.amount_delta,
                wage_mode: wageResult.mode,
                wage_warning: wageResult.warning || null
            }
        });
    } catch (err) {
        console.error('Adjust Billing Area Error:', err.message);
        res.status(500).json({ error: err.message, code: err.code || 'BILLING_AREA_ADJUST_FAILED' });
    }
});

// API สำหรับแก้ไขข้อมูลคิวงาน (PUT)
app.put('/api/jobs/:id', async (req, res) => {
    const { id } = req.params;
    let { customer_name, phone, address_note, crop_type, area_size, job_date, latitude, longitude, vehicle_id, price_per_rai, total_price, payment_status } = req.body;

    // แปลงค่าตัวเลข
    area_size = area_size ? Number(area_size) : null;
    price_per_rai = price_per_rai ? Number(price_per_rai) : 0;
    total_price = total_price ? Number(total_price) : 0;

    try {
        const { data: jobInfo, error: findError } = await supabase.from('jobs').select('customer_id').eq('id', id).single();
        if (findError) throw findError;

        if (jobInfo.customer_id) {
            // 👇 แก้ไขตรงนี้: เปลี่ยน phone || null เป็น phone || "" 👇
            await supabase.from('customers').update({ name: customer_name, phone: phone || "" }).eq('id', jobInfo.customer_id);
        }

        const { data: updatedJob, error: jobError } = await supabase
            .from('jobs')
            .update({
                vehicle_id: vehicle_id === 0 ? null : vehicle_id,
                crop_type,
                area_size,
                job_date,
                latitude,
                longitude,
                price_per_rai,
                total_price,
                payment_status,
                address_note: address_note 
            })
            .eq('id', id)
            .select();

        if (jobError) throw jobError;
        res.json({ message: 'อัปเดตข้อมูลสำเร็จ!', data: updatedJob });
    } catch (err) {
        console.error('Error updating job:', err.message);
        res.status(500).json({ error: err.message });
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

        const { data, error } = await supabase
            .from('gps_logs')
            .select('*')
            .eq('vehicle_id', vehicle_id)
            .gte('created_at', startDate.toISOString())
            .lt('created_at', endDate.toISOString())
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json(data || []);
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
app.post('/api/plots', async (req, res) => {
    const { vehicle_id, work_date, plots_data } = req.body;
    const numericVehicleId = Number(vehicle_id);

    if (!Number.isFinite(numericVehicleId) || numericVehicleId <= 0) {
        return res.status(400).json({ error: 'vehicle_id ไม่ถูกต้อง' });
    }
    if (!work_date || !/^\d{4}-\d{2}-\d{2}$/.test(work_date)) {
        return res.status(400).json({ error: 'work_date ต้องเป็น YYYY-MM-DD' });
    }
    const validationError = validatePlotsData(plots_data);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
        const { data: existingRows, error: findError } = await supabase
            .from('harvest_plots')
            .select('id')
            .eq('vehicle_id', numericVehicleId)
            .eq('work_date', work_date)
            .order('created_at', { ascending: false })
            .limit(1);

        if (findError) throw findError;

        let savedRow;
        if (existingRows && existingRows.length > 0) {
            const { data, error } = await supabase
                .from('harvest_plots')
                .update({ plots_data })
                .eq('id', existingRows[0].id)
                .select('plots_data')
                .single();
            if (error) throw error;
            savedRow = data;
        } else {
            const { data, error } = await supabase
                .from('harvest_plots')
                .insert([{
                    vehicle_id: numericVehicleId,
                    work_date,
                    plots_data
                }])
                .select('plots_data')
                .single();
            if (error) throw error;
            savedRow = data;
        }

        res.json({
            success: true,
            vehicle_id: numericVehicleId,
            work_date,
            plots_data: Array.isArray(savedRow?.plots_data) ? savedRow.plots_data : plots_data
        });
    } catch (err) {
        console.error('Save Plots API Error:', err.message);

        const isRlsError = String(err.message || '').toLowerCase().includes('row-level security');
        if (isRlsError) {
            return res.status(500).json({
                error: err.message,
                code: 'HARVEST_PLOTS_RLS',
                hint: 'ตั้ง SUPABASE_SERVICE_ROLE_KEY ใน Vercel Environment Variables แล้ว Redeploy'
            });
        }

        res.status(500).json({ error: err.message });
    }
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