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

// API สำหรับดึงข้อมูลคิวงานทั้งหมด
app.get('/api/jobs', async (req, res) => {
    const { data, error } = await supabase
        .from('jobs')
        .select(`
            *,
            customers ( name, phone, address_note ),
            vehicles ( name, driver_name )
        `);
    
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ==========================================
// 📝 API สำหรับเพิ่มคิวงานใหม่ (POST)
// ==========================================
app.post('/api/jobs', async (req, res) => {
    const { customer_name, phone, address_note, crop_type, area_size, job_date, latitude, longitude, vehicle_id, price_per_rai, total_price, payment_status } = req.body;

    try {
        let customerId;
        let existingCustomer = null;

        // 💡 เช็คก่อนว่ามีเบอร์โทรส่งมาไหม ถ้ามีค่อยไปค้นหาลูกค้าเก่า
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
            // อัปเดตแค่ชื่อลูกค้า ไม่เอาหมายเหตุไปทับ
            await supabase.from('customers').update({ name: customer_name }).eq('id', customerId); 
        } else {
            // 💡 ถ้าไม่มีเบอร์ (หรือเบอร์ใหม่) ให้สร้างลูกค้าใหม่ โดยตั้งค่า phone เป็น null แทนช่องว่าง
            const { data: newCustomer, error: custError } = await supabase
                .from('customers')
                .insert([{ name: customer_name, phone: phone || null }]) 
                .select()
                .single();
            if (custError) throw custError;
            customerId = newCustomer.id;
        }

        // บันทึกข้อมูลคิวงานลงตาราง jobs
        const { data: newJob, error: jobError } = await supabase
            .from('jobs')
            .insert([{
                customer_id: customerId,
                vehicle_id: vehicle_id || null,
                crop_type,
                area_size: area_size || 0, // 💡 ถ้าไม่ใส่จำนวนไร่มา ให้บันทึกเป็น 0 ไว้ก่อน
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
    const { status } = req.body;

    const { data, error } = await supabase
        .from('jobs')
        .update({ status })
        .eq('id', id)
        .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'อัปเดตสถานะสำเร็จ', data });
});

// ==========================================
// ✏️ API สำหรับแก้ไขข้อมูลคิวงาน (PUT)
// ==========================================
app.put('/api/jobs/:id', async (req, res) => {
    const { id } = req.params;
    const { customer_name, phone, address_note, crop_type, area_size, job_date, latitude, longitude, vehicle_id, price_per_rai, total_price, payment_status } = req.body;

    try {
        const { data: jobInfo, error: findError } = await supabase.from('jobs').select('customer_id').eq('id', id).single();
        if (findError) throw findError;

        if (jobInfo.customer_id) {
            // อัปเดตข้อมูลลูกค้า (เปลี่ยนเบอร์โทรเป็น null ได้ถ้าลบเบอร์ออก)
            await supabase.from('customers').update({ name: customer_name, phone: phone || null }).eq('id', jobInfo.customer_id);
        }

        const { data: updatedJob, error: jobError } = await supabase
            .from('jobs')
            .update({
                vehicle_id: vehicle_id === 0 ? null : vehicle_id,
                crop_type,
                area_size: area_size || 0, // 💡 ถ้าไม่ใส่จำนวนไร่มา ให้บันทึกเป็น 0
                job_date,
                latitude,
                longitude,
                price_per_rai: price_per_rai || 0,
                total_price: total_price || 0,
                payment_status,
                address_note: address_note // 👈 บันทึกหมายเหตุลงตาราง jobs
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
    const { name, driver_name } = req.body;
    
    const { data, error } = await supabase
        .from('vehicles')
        .insert([{ name, driver_name }])
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
// 🚀 การรันเซิร์ฟเวอร์
// ==========================================

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