require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// เชื่อมต่อฐานข้อมูล Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.get('/', (req, res) => {
    res.send('🚀 ระบบคิวรถเกี่ยว (Harvester API) กำลังทำงาน!');
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
    res.json(data);
});

// API สำหรับเพิ่มคิวงานใหม่
app.post('/api/jobs', async (req, res) => {
    const { customer_name, phone, address_note, crop_type, area_size, job_date, latitude, longitude, vehicle_id, price_per_rai, total_price, payment_status } = req.body;

    try {
        let customerId;
        let existingCustomer = null;

        // 🛠️ แก้ไข: เช็คก่อนว่ามีเบอร์โทรส่งมาจริงๆ และไม่ใช่ค่าว่าง ถึงจะไปค้นหา
        if (phone && phone.trim() !== "") {
            const { data } = await supabase
                .from('customers')
                .select('id')
                .eq('phone', phone)
                .single();
            existingCustomer = data;
        }

        if (existingCustomer) {
            customerId = existingCustomer.id;
            // ถอด address_note ออก เพื่อไม่ให้ไปทับของเก่าลูกค้า
            await supabase.from('customers').update({ name: customer_name }).eq('id', customerId); 
        } else {
            // 🛠️ แก้ไข: ถ้าไม่มีเบอร์โทร ให้บังคับบันทึกเป็น null เพื่อป้องกันปัญหา
            const { data: newCustomer, error: custError } = await supabase
                .from('customers')
                .insert([{ name: customer_name, phone: phone || null }]) 
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
                price_per_rai: price_per_rai || 0,
                total_price: total_price || 0,
                payment_status: payment_status || 'UNPAID',
                address_note: address_note // 👈 โยกมาบันทึกลงตาราง jobs ตรงนี้
            }])
            .select();

        if (jobError) throw jobError;
        res.status(201).json({ message: 'บันทึกคิวงานสำเร็จ!', data: newJob });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API สำหรับอัปเดตเปลี่ยนสถานะงาน (เช่น กดเสร็จสิ้น หรือ กำลังเกี่ยว)
app.patch('/api/jobs/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status, wageData } = req.body; // 👈 รับข้อมูล wageData เพิ่มเข้ามา

    try {
        // 1. อัปเดตสถานะงานให้เป็น DONE, IN_PROGRESS ฯลฯ
        const { data: updatedJob, error: jobError } = await supabase
            .from('jobs')
            .update({ status })
            .eq('id', id)
            .select()
            .single();

        if (jobError) throw jobError;

        // 2. 💡 พิเศษ: ถ้าสถานะคือ DONE และมีการส่งค่าแรงมา ให้บันทึกลงตาราง Transactions
        if (status === 'DONE' && wageData) {
            const totalWage = (Number(wageData.area) * Number(wageData.wagePerRai)) || 0;
            
            const { error: txError } = await supabase
                .from('transactions')
                .insert([{
                    job_id: id,
                    type: 'OUT',            // รายจ่าย
                    category: 'ค่าแรง',       // หมวดหมู่
                    total_amount: totalWage,
                    paid_amount: 0,         // ยังไม่ได้จ่าย
                    status: 'UNPAID',       // สถานะรอเบิก
                    note: `คนทำ: ${wageData.workers} (พื้นที่ ${wageData.area} ไร่, เรท ${wageData.wagePerRai} บ./ไร่)` // 👈 บันทึกเป็นหลักฐาน
                }]);
            
            if (txError) console.error('Error saving transaction:', txError.message);
        }

        res.json({ message: 'อัปเดตสถานะสำเร็จ', data: updatedJob });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API สำหรับแก้ไขข้อมูลคิวงาน (PUT)
app.put('/api/jobs/:id', async (req, res) => {
    const { id } = req.params;
    const { customer_name, phone, address_note, crop_type, area_size, job_date, latitude, longitude, vehicle_id, price_per_rai, total_price, payment_status } = req.body;

    try {
        const { data: jobInfo, error: findError } = await supabase.from('jobs').select('customer_id').eq('id', id).single();
        if (findError) throw findError;

        if (jobInfo.customer_id) {
            // ถอด address_note ออก เพื่อไม่ให้ไปทับของเก่าลูกค้า
            await supabase.from('customers').update({ name: customer_name, phone: phone }).eq('id', jobInfo.customer_id);
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
                address_note: address_note // 👈 โยกมาบันทึกลงตาราง jobs ตรงนี้
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

app.get('/api/gps/:vehicle_id', async (req, res) => {
    const { vehicle_id } = req.params;
    const { date } = req.query; // วันที่สำหรับดูประวัติย้อนหลัง (ถ้ามี)
    
    // ถ้ามี date ให้ใช้วันนั้น ถ้าไม่มีให้ใช้วันนี้ปัจจุบัน
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);
    
    try {
        const { data, error } = await supabase
            .from('gps_logs')
            .select('*')
            .eq('vehicle_id', vehicle_id)
            // .eq('is_harvesting', true) // 💡 ถ้าอยากดูแค่รอยเกี่ยวข้าว ให้เปิดใช้งานบรรทัดนี้
            .gte('created_at', targetDate.toISOString())
            .lt('created_at', nextDate.toISOString())
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
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
    const { status } = req.body;
    
    const { data, error } = await supabase
        .from('transactions')
        .update({ status })
        .eq('id', id)
        .select();
        
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'อัปเดตสถานะสำเร็จ', data });
});

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