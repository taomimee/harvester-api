require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() }); // ให้ระบบพักไฟล์ไว้ในแรมก่อนส่งขึ้น Supabase
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
    const { date } = req.query; 
    
    // 💡 ถ้าไม่ได้ส่ง date มา (โหมดปัจจุบัน) มันจะดึงข้อมูลเฉพาะ "วันนี้" ตามเวลา UTC 
    // ซึ่งบางทีเวลา UTC กับเวลาไทยมันเหลื่อมกัน ทำให้ข้อมูลของวันนี้ถูกมองว่าเป็น "เมื่อวาน" ครับ!
    
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
            .select('total_price, payment_status, area_size')
            .eq('status', 'DONE')
            .gte('job_date', startDate)
            .lte('job_date', endDate);

        // 2. ดึงข้อมูลรายจ่าย (จาก transactions)
        const { data: expenses } = await supabase
            .from('transactions')
            .select('total_amount')
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
                totalArea += Number(job.area_size) || 0;
                
                if (job.payment_status === 'PAID') {
                    totalIncome += price;
                } else {
                    totalUnpaid += price; // ยอดที่ลูกค้ายังไม่จ่าย
                }
            });
        }

        if (expenses) {
            expenses.forEach(exp => {
                totalExpense += Number(exp.total_amount) || 0;
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

const gpsServer = net.createServer((socket) => {
    console.log('📡 มีการเชื่อมต่อเข้ามาที่ Port GPS!');

    socket.on('data', async (data) => {
        const rawData = data.toString().trim();
        console.log(`[Raw Data]: ${rawData}`); // แสดงข้อมูลดิบที่ส่งมาจากกล่อง

        // ตัวอย่างข้อมูล: *HQ,IMEI,V1,Time,A,Lat,N,Lon,E,Speed,Course,Date,VehicleStatus#
        if (rawData.startsWith('*HQ') && rawData.endsWith('#')) {
            const parts = rawData.replace('*HQ,', '').replace('#', '').split(',');
            
            // เช็คว่าเป็นข้อมูลพิกัด (V1)
            if (parts.length >= 12 && parts[1] === 'V1') {
                const status = parts[3];     // A = จับสัญญาณได้, V = จับไม่ได้
                const latRaw = parts[4]; 
                const latDir = parts[5]; 
                const lonRaw = parts[6]; 
                const lonDir = parts[7]; 

                if (status === 'A') {
                    const lat = convertToDecimal(latRaw, latDir);
                    const lon = convertToDecimal(lonRaw, lonDir);
                    
                    console.log(`📍 ถอดรหัสพิกัดได้: Lat ${lat}, Lon ${lon}`);

                    // โยนข้อมูลเข้า Database Supabase ของเรา
                    try {
                        // 💡 สมมติให้กล่องนี้เป็นของรถ "คันที่ 1" (vehicle_id: 1) ในช่วงทดสอบ
                        const { error } = await supabase.from('gps_logs').insert([{
                            vehicle_id: 1, 
                            latitude: lat,
                            longitude: lon,
                            is_harvesting: true 
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