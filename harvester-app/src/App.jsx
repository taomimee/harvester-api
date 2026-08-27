import { useEffect, useState, useRef } from 'react'
import L from 'leaflet'
import * as turf from '@turf/turf'
import 'leaflet/dist/leaflet.css'

// 🗺️ ระบบแผนที่เป้าเล็ง + ค้นหาสถานที่อัจฉริยะ + แผนที่ดาวเทียมมีป้ายชื่อ
function LingStyleMap({ initialCenter, onConfirm, onCancel }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layerGroup = useRef(null);
  const [points, setPoints] = useState([]);
  const [areaInfo, setAreaInfo] = useState({ text: '0 ไร่ 0 งาน 0 ตร.ว.', rawRai: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [foundLocation, setFoundLocation] = useState(''); 

  const calculateThaiArea = (sqMeters) => {
    const rai = Math.floor(sqMeters / 1600);
    let remain = sqMeters % 1600;
    const ngan = Math.floor(remain / 400);
    remain = remain % 400;
    const sqWah = (remain / 4).toFixed(1);
    const rawRai = (sqMeters / 1600).toFixed(2);
    return { text: `${rai} ไร่ ${ngan} งาน ${sqWah} ตร.ว.`, rawRai };
  }

  useEffect(() => {
    if (!mapRef.current) return;
    const center = initialCenter && initialCenter[0] ? initialCenter : [15.7012, 101.1012];
    mapInstance.current = L.map(mapRef.current, { zoomControl: false }).setView(center, 17);
    L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      attribution: 'Google Maps', maxZoom: 20
    }).addTo(mapInstance.current);
    layerGroup.current = L.layerGroup().addTo(mapInstance.current);
    return () => { if (mapInstance.current) mapInstance.current.remove(); };
  }, [initialCenter]);

  useEffect(() => {
    if (!layerGroup.current || !mapInstance.current) return;
    layerGroup.current.clearLayers();
    if (points.length > 0) {
      const latlngs = points.map(p => [p.lat, p.lng]);
      let shape; 
      if (points.length >= 3) {
        shape = L.polygon(latlngs, { color: '#16A34A', fillColor: '#4ADE80', fillOpacity: 0.5, weight: 3 }).addTo(layerGroup.current);
        const turfCoords = points.map(p => [p.lng, p.lat]);
        turfCoords.push([points[0].lng, points[0].lat]);
        const turfPolygon = turf.polygon([turfCoords]);
        const sqM = turf.area(turfPolygon);
        setAreaInfo(calculateThaiArea(sqM));
      } else {
        shape = L.polyline(latlngs, { color: '#16A34A', weight: 3, dashArray: '5, 5' }).addTo(layerGroup.current);
        setAreaInfo({ text: 'ต้องมีอย่างน้อย 3 จุด', rawRai: 0 });
      }

      points.forEach((p, idx) => {
        const customIcon = L.divIcon({
          className: 'bg-transparent border-0',
          html: `<div class="bg-green-600 text-white rounded-full w-6 h-6 flex items-center justify-center font-bold text-xs border-2 border-white shadow-md cursor-pointer" style="margin-left: -12px; margin-top: -12px;">${idx + 1}</div>`,
          iconSize: [0, 0]
        });
        const marker = L.marker([p.lat, p.lng], { icon: customIcon, draggable: true }).addTo(layerGroup.current);
        marker.on('drag', (e) => {
          const newLatLng = e.target.getLatLng();
          latlngs[idx] = [newLatLng.lat, newLatLng.lng];
          shape.setLatLngs(latlngs);
        });
        marker.on('dragend', (e) => {
          const newLatLng = e.target.getLatLng();
          const newPoints = [...points];
          newPoints[idx] = { lat: newLatLng.lat, lng: newLatLng.lng };
          setPoints(newPoints);
        });
      });
    } else {
      setAreaInfo({ text: 'เลื่อนเป้าแล้วกด + เพื่อเริ่มวาด', rawRai: 0 });
    }
  }, [points]);

  const addPoint = () => {
    const center = mapInstance.current.getCenter();
    setPoints([...points, { lat: center.lat, lng: center.lng }]);
  };
  const undoPoint = () => { setPoints(points.slice(0, -1)); };
  const handleConfirm = () => {
    if (points.length < 3) return alert("ต้องระบุอย่างน้อย 3 มุมขึ้นไปครับ");
    onConfirm(points, areaInfo.rawRai);
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setFoundLocation('กำลังค้นหา...');
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=th&q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        const { lat, lon, display_name } = data[0];
        setFoundLocation(display_name); 
        if (mapInstance.current) mapInstance.current.flyTo([lat, lon], 15);
      } else {
        setFoundLocation('❌ ไม่พบสถานที่ ลองพิมพ์ชื่อตำบลตามด้วยอำเภอ');
      }
    } catch (err) {
      console.error(err);
      setFoundLocation('❌ เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่าย');
    }
  };

  return (
    <div className="relative w-full h-full bg-gray-200 rounded-xl overflow-hidden shadow-inner flex flex-col">
      <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-col gap-2">
        <form onSubmit={handleSearch} className="flex gap-2 bg-white/95 backdrop-blur p-2 rounded-xl shadow-lg border border-gray-200">
          <input
            type="text" placeholder="🔍 พิมพ์ค้นหา ตำบล, อำเภอ..."
            className="flex-1 p-2 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-orange-400"
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
          />
          <button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-md transition" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
            ไป!
          </button>
        </form>
        {foundLocation && (
          <div className="bg-blue-50/95 backdrop-blur p-2 rounded-xl shadow-md border border-blue-200 text-xs text-blue-800 font-semibold leading-relaxed">
            📍 พาไปที่: {foundLocation}
          </div>
        )}
      </div>

      <div className="absolute top-28 left-1/2 transform -translate-x-1/2 z-[400] bg-white/95 backdrop-blur px-5 py-2 rounded-full shadow-lg border border-green-300">
        <span className="font-bold text-green-700 text-sm whitespace-nowrap">📐 พื้นที่: {areaInfo.text}</span>
      </div>
      <div ref={mapRef} className="flex-1 w-full z-0" />
      <div className="absolute inset-0 pointer-events-none z-[400] flex items-center justify-center">
        <div className="relative flex items-center justify-center w-12 h-12">
          <div className="absolute w-full h-0.5 bg-red-500/90 drop-shadow-md"></div>
          <div className="absolute h-full w-0.5 bg-red-500/90 drop-shadow-md"></div>
          <div className="absolute w-3.5 h-3.5 border-2 border-white rounded-full bg-red-500 shadow-md"></div>
        </div>
      </div>
      <div className="absolute bottom-6 left-0 right-0 z-[400] px-6 flex justify-between items-end">
        <button onClick={onCancel} className="bg-red-500 hover:bg-red-600 text-white w-12 h-12 rounded-full shadow-xl font-bold flex items-center justify-center border-2 border-white text-lg transition">❌</button>
        <div className="flex gap-4 items-end">
          <button onClick={undoPoint} disabled={points.length === 0} className={`w-12 h-12 rounded-full shadow-xl font-bold flex items-center justify-center border-2 border-white text-xl ${points.length === 0 ? 'bg-gray-300 text-gray-500' : 'bg-orange-400 text-white hover:bg-orange-500'}`}>↩️</button>
          <button onClick={addPoint} className="w-20 h-20 bg-green-600 hover:bg-green-700 text-white rounded-full shadow-2xl font-bold flex items-center justify-center border-4 border-white text-4xl transform active:scale-95">+</button>
          <button onClick={handleConfirm} disabled={points.length < 3} className={`w-12 h-12 rounded-full shadow-xl font-bold flex items-center justify-center border-2 border-white text-lg ${points.length < 3 ? 'bg-gray-300 text-gray-500' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>💾</button>
        </div>
      </div>
    </div>
  );
}

// 🗺️ แผนที่สำหรับดูเส้นทางรถเกี่ยวโดยเฉพาะ (Tracking Map)
function TrackingMap({ pathData }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const polylineLayer = useRef(null);

  useEffect(() => {
    if (!mapRef.current) return;
    // ตั้งค่าพิกัดเริ่มต้น (ถ้าไม่มีข้อมูลให้ซูมระดับประเทศ)
    const center = pathData.length > 0 ? [pathData[pathData.length-1].latitude, pathData[pathData.length-1].longitude] : [15.7012, 101.1012];
    const zoom = pathData.length > 0 ? 17 : 6;

    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, { zoomControl: true }).setView(center, zoom);
      L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps', maxZoom: 20
      }).addTo(mapInstance.current);
    } else {
      mapInstance.current.setView(center, zoom);
    }

    // 💡 พระเอกอยู่ตรงนี้: สั่งให้แผนที่รีเฟรชขนาดตัวเองใหม่ (แก้บั๊กแผนที่ครึ่งจอ)
    setTimeout(() => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize();
      }
    }, 200);

    // วาดเส้นทางใหม่
    if (polylineLayer.current) mapInstance.current.removeLayer(polylineLayer.current);
    
    if (pathData.length > 0) {
      // 💡 แยกสี: วิ่งบนถนน (สีเทา) / กำลังเกี่ยวข้าว (สีน้ำเงินเข้มแบบในรูป)
      const latlngs = pathData.map(p => [p.latitude, p.longitude]);
      polylineLayer.current = L.polyline(latlngs, { 
        color: '#2563EB', // สีน้ำเงิน
        weight: 4, 
        opacity: 0.8 
      }).addTo(mapInstance.current);
      
      // ปักหมุดจุดล่าสุด (รูปรถเกี่ยว)
      const lastPoint = pathData[pathData.length - 1];
      const carIcon = L.divIcon({
        className: 'bg-transparent border-0',
        html: `<div class="bg-orange-500 hover:bg-orange-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-lg border-2 border-white shadow-lg drop-shadow-md cursor-pointer transition transform hover:scale-110" style="margin-left: -16px; margin-top: -16px;">🚜</div>`,
        iconSize: [0, 0]
      });
      
      const marker = L.marker([lastPoint.latitude, lastPoint.longitude], { icon: carIcon }).addTo(mapInstance.current);
      
      // 👇 เพิ่มอีเวนต์ให้กดที่ตัวรถแล้วเด้งไป Google Maps
      marker.bindTooltip("คลิกเพื่อเปิด Google Maps นำทางไปหารถ", { direction: 'top', offset: [0, -10] });
      marker.on('click', () => {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lastPoint.latitude},${lastPoint.longitude}`, '_blank');
      });
    }

    return () => {};
  }, [pathData]);

  return <div ref={mapRef} className="w-full h-full z-0" />;
}

function App() {
  const [jobs, setJobs] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [activeTab, setActiveTab] = useState('active') 
  const [financeSubTab, setFinanceSubTab] = useState('dashboard'); // 👈 เพิ่ม State สำหรับคุมเมนูย่อยในหน้าบัญชี
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [customersList, setCustomersList] = useState([])

  // 📸 State สำหรับระบบแกลเลอรี่รูปภาพ
  const [jobAttachments, setJobAttachments] = useState([]); // เก็บรูปของงานที่กำลังกดดู
  const [isUploadingImage, setIsUploadingImage] = useState(false); // สถานะตอนกำลังโหลดรูป
  const [uploadCategory, setUploadCategory] = useState('BEFORE'); // หมวดหมู่เริ่มต้น
  const [fullScreenIndex, setFullScreenIndex] = useState(null); // เปลี่ยนมาเก็บลำดับรูปแทน
  const [touchStartX, setTouchStartX] = useState(null); // เก็บพิกัดตอนเริ่มเอานิ้วแตะจอ
  const [touchEndX, setTouchEndX] = useState(null); // เก็บพิกัดตอนลากนิ้ว

  // 💰 State สำหรับคิดค่าแรงลูกจ้างตอนปิดงาน
  const [finishingJob, setFinishingJob] = useState(null);
  const [wageData, setWageData] = useState({ area: '', wagePerRai: 60, workers: '' });
  // 💰 State สำหรับหน้าสรุปค่าแรง
  const [showWageSummary, setShowWageSummary] = useState(false);
  const [wageTab, setWageTab] = useState('UNPAID'); // 👈 เพิ่มบรรทัดนี้ สำหรับสลับแท็บค่าแรง
  const [wageTransactions, setWageTransactions] = useState([]);

  // 📊 State สำหรับ Dashboard
  const [dashboardData, setDashboardData] = useState({ totalIncome: 0, totalUnpaid: 0, totalExpense: 0, netProfit: 0, totalArea: 0 });
  const [dashMonth, setDashMonth] = useState(new Date().getMonth() + 1);
  const [dashYear, setDashYear] = useState(new Date().getFullYear());
  const [isFetchingDash, setIsFetchingDash] = useState(false);
  
  // ระบบแบ่งหน้า 
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10; 

  const [editingId, setEditingId] = useState(null);
  const [currentCoords, setCurrentCoords] = useState([15.7012, 101.1012]); 

  const [formData, setFormData] = useState({
    customer_name: '', phone: '', address_note: '', crop_type: 'ข้าว',
    area_size: '', job_date: '', latitude: '', longitude: '',
    vehicle_id: 0, boundaries: [], price_per_rai: '', total_price: '', payment_status: 'UNPAID'
  })

  // 📅 State สำหรับปฏิทิน
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDayJobs, setSelectedDayJobs] = useState(null); 

  // 🚜 State สำหรับจัดการรถเกี่ยว
  const [vehicles, setVehicles] = useState([]);
  const [showVehicleManager, setShowVehicleManager] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ name: '', driver_name: '' });

  // 👥 State สำหรับจัดการลูกค้าในหน้าตั้งค่า
  const [showCustomerManager, setShowCustomerManager] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', address_note: '' });

  // 👇 วาง State สำหรับ GPS ตรงนี้ 👇
  const [trackingVehicleId, setTrackingVehicleId] = useState('');
  const [trackingMode, setTrackingMode] = useState('realtime');
  const [trackingDate, setTrackingDate] = useState(new Date().toISOString().slice(0, 10));
  const [gpsPathData, setGpsPathData] = useState([]);
  const [isFetchingGps, setIsFetchingGps] = useState(false);
  // 👆 จบการวาง State 👆

  // ฟังก์ชันดึงรายชื่อรถ
  const fetchVehicles = async () => {
    try {
      const res = await fetch('https://harvester-api-server.onrender.com/api/vehicles');
      const data = await res.json();
      setVehicles(data);
    } catch (err) { console.error("ดึงข้อมูลรถไม่ได้:", err); }
  };

  // ฟังก์ชันดึงรายชื่อลูกค้าทั้งหมด (ใช้กับค้นหาและหน้าตั้งค่า)
  const fetchAllCustomers = async () => {
    try {
      const res = await fetch('https://harvester-api-server.onrender.com/api/customers');
      const data = await res.json();
      setCustomersList(data);
    } catch (err) { console.error("ดึงข้อมูลลูกค้าไม่ได้:", err); }
  };

  const fetchWages = async () => {
    try {
      const res = await fetch('https://harvester-api-server.onrender.com/api/transactions/wages');
      const data = await res.json();
      setWageTransactions(data);
    } catch (err) { console.error("ดึงข้อมูลค่าแรงไม่ได้:", err); }
  };

  const fetchDashboard = async () => {
    setIsFetchingDash(true);
    try {
      const res = await fetch(`https://harvester-api-server.onrender.com/api/dashboard?month=${dashMonth}&year=${dashYear}`);
      const data = await res.json();
      setDashboardData(data);
    } catch (err) { console.error(err); }
    setIsFetchingDash(false);
  };

  // ดึงข้อมูลใหม่ทุกครั้งที่เปลี่ยนเดือน/ปี หรือเข้าหน้าสรุปยอด
  useEffect(() => {
    if (activeTab === 'finance' && financeSubTab === 'dashboard') fetchDashboard();
  }, [activeTab, financeSubTab, dashMonth, dashYear]);

  useEffect(() => { 
    document.documentElement.lang = 'th'; 
    fetchJobs();
    fetchVehicles(); 
    fetchAllCustomers(); // ดึงลูกค้ามาเตรียมไว้
  }, []);

  const handleAddVehicle = async () => {
    if (!newVehicle.name.trim()) return alert("กรุณาใส่ชื่อรถครับ");
    try {
      const res = await fetch('https://harvester-api-server.onrender.com/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newVehicle)
      });
      if (res.ok) {
        fetchVehicles(); 
        setNewVehicle({ name: '', driver_name: '' }); 
      }
    } catch (err) { alert("เพิ่มรถไม่สำเร็จ"); }
  };

  const handleDeleteVehicle = async (id) => {
    if(!window.confirm('⚠️ ลบรถคันนี้ออกจากระบบหรือไม่?')) return;
    try {
      const res = await fetch(`https://harvester-api-server.onrender.com/api/vehicles/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchVehicles();
        if(formData.vehicle_id === id) setFormData({...formData, vehicle_id: 0});
      }
    } catch (err) { alert("ลบรถไม่สำเร็จ"); }
  };

  // ฟังก์ชันบันทึกข้อมูลลูกค้า (หน้าตั้งค่า)
  const handleSaveCustomer = async () => {
    if (!newCustomer.name.trim()) return alert("กรุณาใส่ชื่อลูกค้าครับ");
    const method = editingCustomer ? 'PUT' : 'POST';
    const url = editingCustomer 
      ? `https://harvester-api-server.onrender.com/api/customers/${editingCustomer.id}` 
      : 'https://harvester-api-server.onrender.com/api/customers';

    try {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCustomer)
      });
      if (res.ok) {
        fetchAllCustomers();
        setNewCustomer({ name: '', phone: '', address_note: '' });
        setEditingCustomer(null);
        alert(editingCustomer ? "อัปเดตลูกค้าสำเร็จ!" : "เพิ่มลูกค้าสำเร็จ!");
      }
    } catch (err) { alert("บันทึกข้อมูลลูกค้าไม่สำเร็จ"); }
  };

  // ฟังก์ชันลบลูกค้า (หน้าตั้งค่า)
  const handleDeleteCustomer = async (id) => {
    if(!window.confirm('⚠️ ลบลูกค้ารายนี้หรือไม่? (ถ้าลูกค้ามีคิวงานค้างอยู่อาจลบไม่ได้)')) return;
    try {
      const res = await fetch(`https://harvester-api-server.onrender.com/api/customers/${id}`, { method: 'DELETE' });
      if (res.ok) { fetchAllCustomers(); alert("ลบสำเร็จ!"); }
      else { alert("ลบไม่สำเร็จ (ลูกค้าอาจมีคิวงานผูกอยู่)"); }
    } catch (err) { alert("ลบข้อมูลลูกค้าไม่สำเร็จ"); }
  };

  const fetchJobs = () => {
    fetch('https://harvester-api-server.onrender.com/api/jobs')
      .then(res => res.json())
      .then(data => { setJobs(data); })
      .catch(err => console.error("ดึงข้อมูลงานไม่ได้:", err))
  }

// 📸 1. ฟังก์ชันดึงรูปภาพของคิวงานนั้นๆ
  const fetchAttachments = async (id) => {
    try {
      const res = await fetch(`https://harvester-api-server.onrender.com/api/jobs/${id}/attachments`);
      const data = await res.json();
      setJobAttachments(data || []);
    } catch(e) { console.error(e); }
  }

  // 📸 2. สั่งให้ดึงรูปอัตโนมัติ เวลาเถ้าแก่กดขยายดูรายละเอียดงาน
  useEffect(() => {
    if (expandedId) {
      setJobAttachments([]); // ล้างรูปเก่าออกก่อน
      fetchAttachments(expandedId);
    }
  }, [expandedId]);

// 📸 3. ฟังก์ชันอัปโหลดรูปร่วมกับ "ระบบบีบอัดภาพ" (เซฟพื้นที่ Supabase)
  const handleImageUpload = async (e, jobId) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsUploadingImage(true);

    // 💡 ฟังก์ชันจำลองตัวเองเป็น "โรงงานบีบอัดรูป"
    const compressImage = (sourceFile) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(sourceFile);
        reader.onload = (event) => {
          const img = new Image();
          img.src = event.target.result;
          img.onload = () => {
            // ตั้งค่าความละเอียดสูงสุด (1024px ก็ชัดพอสำหรับดูสลิปหรือรูปงานแล้ว)
            const MAX_WIDTH = 1024; 
            const MAX_HEIGHT = 1024;
            let width = img.width;
            let height = img.height;

            // คำนวณสัดส่วนใหม่ไม่ให้รูปเบี้ยว
            if (width > height) {
              if (width > MAX_WIDTH) { height = Math.round(height * (MAX_WIDTH / width)); width = MAX_WIDTH; }
            } else {
              if (height > MAX_HEIGHT) { width = Math.round(width * (MAX_HEIGHT / height)); height = MAX_HEIGHT; }
            }

            // วาดรูปลงกระดาน (Canvas) เพื่อเตรียมย่อขนาด
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // 🌟 พระเอกอยู่ตรงนี้: แปลงรูปกลับเป็นไฟล์ JPEG และลดคุณภาพเหลือ 70% (0.7)
            canvas.toBlob((blob) => {
              // เปลี่ยนนามสกุลไฟล์เป็น .jpg ให้หมดเพื่อความชัวร์
              const newFileName = sourceFile.name.replace(/\.[^/.]+$/, "") + "_compressed.jpg";
              resolve(new File([blob], newFileName, { type: 'image/jpeg' }));
            }, 'image/jpeg', 0.7);
          };
        };
      });
    };

    try {
      // 1. นำไฟล์ดิบเข้าโรงงานบีบอัดก่อน
      const compressedFile = await compressImage(file);

      // 2. เอาไฟล์ที่บีบอัดแล้ว ห่อเตรียมส่งขึ้นเซิร์ฟเวอร์
      const formData = new FormData();
      formData.append('image', compressedFile);
      formData.append('category', uploadCategory);

      // 3. ส่งไปให้ API หลังบ้าน
      const res = await fetch(`https://harvester-api-server.onrender.com/api/jobs/${jobId}/attachments`, {
        method: 'POST',
        body: formData
      });
      
      if (res.ok) {
         fetchAttachments(jobId); // โหลดรูปใหม่มาโชว์ทันที
         e.target.value = null; // ล้างค่าปุ่ม เพื่อให้กดอัปรูปรอบต่อไปได้
      } else { 
         const err = await res.json();
         alert(`❌ อัปโหลดไม่สำเร็จ: ${err.error}`); 
      }
    } catch (err) { 
      console.error(err);
      alert('❌ เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่'); 
    }
    setIsUploadingImage(false);
  };

  // 📸 4. ฟังก์ชันลบรูปภาพ (ปรับปรุงให้ดักจับ Error ได้แม่นขึ้น)
  const handleDeleteImage = async (e, imageId, imageUrl, jobId) => {
    e.preventDefault();
    e.stopPropagation(); 
    if (!window.confirm('⚠️ แน่ใจหรือไม่ว่าต้องการลบรูปนี้?')) return;

    try {
      const res = await fetch(`https://harvester-api-server.onrender.com/api/jobs/attachments/${imageId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }) 
      });
      
      if (res.ok) {
        fetchAttachments(jobId); 
      } else {
        const errData = await res.json();
        alert(`❌ ลบไม่สำเร็จ: ${errData.error || 'ไม่พบ API บนเซิร์ฟเวอร์'}`);
      }
    } catch (err) {
      console.error(err);
      alert('❌ เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  // 👆 ----------------- จบฟังก์ชันลบรูป ----------------- 👆

  // 👇 📸 ฟังก์ชันสำหรับระบบ ปัดจอ (Swipe) เลื่อนดูรูป 👇
  const handleTouchStart = (e) => setTouchStartX(e.targetTouches[0].clientX);
  const handleTouchMove = (e) => setTouchEndX(e.targetTouches[0].clientX);
  const handleTouchEnd = () => {
    if (!touchStartX || !touchEndX || jobAttachments.length <= 1) return;
    const distance = touchStartX - touchEndX;
    const swipeThreshold = 50; // ระยะการปัดขั้นต่ำ
    
    if (distance > swipeThreshold) {
      // ปัดซ้าย -> เลื่อนไปรูปถัดไป
      setFullScreenIndex((prev) => (prev + 1) % jobAttachments.length);
    } else if (distance < -swipeThreshold) {
      // ปัดขวา -> เลื่อนกลับรูปก่อนหน้า
      setFullScreenIndex((prev) => (prev - 1 + jobAttachments.length) % jobAttachments.length);
    }
    setTouchStartX(null);
    setTouchEndX(null);
  };

  const handleGetCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentCoords([position.coords.latitude, position.coords.longitude]);
          setFormData({ ...formData, latitude: position.coords.latitude, longitude: position.coords.longitude });
          alert('📍 ดึงพิกัด GPS สำเร็จ!');
        },
        (error) => { alert('❌ ไม่สามารถดึงพิกัดได้: ' + error.message); }
      );
    } else { alert('❌ เบราว์เซอร์ของคุณไม่รองรับการระบุพิกัด'); }
  }

  const handleMapConfirm = (points, areaRai) => {
    const turfCoords = points.map(p => [p.lng, p.lat]);
    turfCoords.push([points[0].lng, points[0].lat]); 
    const polygon = turf.polygon([turfCoords]);
    const center = turf.centerOfMass(polygon).geometry.coordinates; 

    setFormData(prev => ({
      ...prev,
      area_size: areaRai,
      latitude: center[1].toFixed(6), 
      longitude: center[0].toFixed(6),
      boundaries: points
    }));
    setShowMapPicker(false);
  };

  const openEditForm = (job) => {
    setEditingId(job.id);
    let formattedDate = '';
    if (job.job_date) {
      const d = new Date(job.job_date);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      formattedDate = d.toISOString().slice(0, 16);
    }
    setFormData({
      customer_name: job.customers?.name || '',
      phone: job.customers?.phone || '',
      address_note: job.address_note || job.customers?.address_note || '', // 💡 ดึงหมายเหตุงานก่อน
      crop_type: job.crop_type || 'ข้าว',
      area_size: job.area_size || '',
      job_date: formattedDate,
      latitude: job.latitude || '',
      longitude: job.longitude || '',
      vehicle_id: job.vehicles?.id || job.vehicle_id || 0,
      boundaries: job.boundaries || [],
      price_per_rai: job.price_per_rai || '',
      total_price: job.total_price || '',
      payment_status: job.payment_status || 'UNPAID'
    });
    if (job.latitude && job.longitude) setCurrentCoords([job.latitude, job.longitude]);
    setShowAddForm(true);
  };

  const openAddFormForDate = (date) => {
    const d = new Date(date);
    d.setHours(8, 0, 0, 0);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    setEditingId(null);
    setFormData({ customer_name: '', phone: '', address_note: '', crop_type: 'ข้าว', area_size: '', job_date: d.toISOString().slice(0, 16), latitude: '', longitude: '', vehicle_id: 0, boundaries: [], price_per_rai: '', total_price: '', payment_status: 'UNPAID' });
    setShowAddForm(true);
  }

  const handleDeleteJob = async (id) => {
    if (!window.confirm('⚠️ แน่ใจหรือไม่ว่าต้องการ "ลบ" คิวงานนี้?')) return;
    try {
      const response = await fetch(`https://harvester-api-server.onrender.com/api/jobs/${id}`, { method: 'DELETE' });
      if (response.ok) { 
        alert('🗑️ ลบคิวงานเรียบร้อย'); 
        fetchJobs();
        setSelectedDayJobs(null); 
      } else { alert('❌ ลบไม่สำเร็จ'); }
    } catch (err) { console.error(err); }
  };

  const handleAddJob = async (e) => {
    e.preventDefault();

    // เช็คคิวซ้อน (Double Booking)
    if (formData.vehicle_id && formData.vehicle_id !== 0 && formData.job_date) {
      const selectedDate = new Date(formData.job_date).toDateString();
      const conflictingJobs = jobs.filter(job => {
        if (editingId && job.id === editingId) return false;
        if (job.status === 'DONE') return false;
        const currentVehicleId = job.vehicles?.id || job.vehicle_id;
        if (currentVehicleId !== formData.vehicle_id) return false;
        const jobDate = new Date(job.job_date).toDateString();
        return jobDate === selectedDate;
      });

      if (conflictingJobs.length > 0) {
        const cJob = conflictingJobs[0]; 
        const time = new Date(cJob.job_date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        const location = cJob.address_note || cJob.customers?.name || 'ไม่ระบุพิกัด';
        const isConfirm = window.confirm(`🛑 แจ้งเตือนรถคิวทับซ้อน!\n\nรถคันนี้มีคิวงานของวันนี้อยู่แล้วที่:\n📍 ${location}\n⏰ เวลา ${time} น.\n\nคุณต้องการยืนยันที่จะ "แทรกคิว" นี้จริงๆ หรือไม่?`);
        if (!isConfirm) return; 
      }
    }

    try {
      const url = editingId ? `https://harvester-api-server.onrender.com/api/jobs/${editingId}` : 'https://harvester-api-server.onrender.com/api/jobs';
      const method = editingId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (response.ok) {
        alert(editingId ? '✅ อัปเดตข้อมูลสำเร็จ!' : '✅ บันทึกคิวงานสำเร็จ!');
        setShowAddForm(false);
        setEditingId(null);
        setSelectedDayJobs(null);
        setFormData({ customer_name: '', phone: '', address_note: '', crop_type: 'ข้าว', area_size: '', job_date: '', latitude: '', longitude: '', vehicle_id: 0, boundaries: [], price_per_rai: '', total_price: '', payment_status: 'UNPAID' });
        fetchJobs();
        fetchAllCustomers(); 
      } else { 
        // 💡 เพิ่มตรงนี้ เพื่อให้มันโชว์ว่า Database ฟ้องว่าอะไร
        const errorData = await response.json();
        alert(`❌ บันทึกไม่สำเร็จ:\n${errorData.error}`); 
      }
    } catch (err) { console.error(err); alert('❌ เกิดข้อผิดพลาดเซิร์ฟเวอร์'); }
  }

  const updateStatus = async (id, newStatus, extraWageData = null) => {
    try {
      const payload = { status: newStatus, wageData: extraWageData };
      
      // 💡 แก้บั๊กเวลา: ปรับให้เป็นเวลาประเทศไทย (Local Time) ก่อนส่งไปหลังบ้าน
      if (newStatus === 'DONE') {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); // ชดเชยเวลาให้ตรงกับเขตเวลาของเครื่อง
        payload.job_date = now.toISOString().slice(0, 16); // ตัดเอาแค่ ปี-เดือน-วันTชั่วโมง:นาที
      }

      const response = await fetch(`https://harvester-api-server.onrender.com/api/jobs/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) fetchJobs();
    } catch (err) { console.error(err); }
  }

  const getStatusDisplay = (status) => {
    switch (status) {
      case 'PENDING': return { text: 'รอคิว', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' }
      case 'IN_PROGRESS': return { text: 'กำลังเกี่ยว', color: 'bg-blue-100 text-blue-800 border-blue-300' }
      case 'DONE': return { text: 'เสร็จสิ้น', color: 'bg-green-100 text-green-800 border-green-300' }
      case 'PAUSED': return { text: 'พักคิว/ติดฝน', color: 'bg-red-100 text-red-800 border-red-300' }
      default: return { text: status, color: 'bg-gray-100 text-gray-800 border-gray-300' }
    }
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }),
      time: date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
    }
  }

  // --- จัดการข้อมูลที่จะแสดงผล & แบ่งหน้า ---
  const activeJobs = jobs.filter(j => j.status !== 'DONE').sort((a, b) => {
    const priority = { 'IN_PROGRESS': 1, 'PAUSED': 2, 'PENDING': 3 };
    if (priority[a.status] !== priority[b.status]) return priority[a.status] - priority[b.status];
    return new Date(a.job_date) - new Date(b.job_date);
  });
  
  const updatePaymentStatus = async (id, newStatus) => {
    try {
      const payload = { payment_status: newStatus };
      
      // 💡 ถ้ารับเงิน ให้บันทึกเวลาปัจจุบันของเครื่องส่งไปด้วย
      if (newStatus === 'PAID') {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        payload.paid_at = now.toISOString();
      }

      const response = await fetch(`https://harvester-api-server.onrender.com/api/jobs/${id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) fetchJobs();
    } catch (err) { console.error(err); }
  }

  const historyJobs = jobs.filter(j => j.status === 'DONE').sort((a, b) => new Date(b.job_date) - new Date(a.job_date));

  const totalPages = Math.ceil(historyJobs.length / itemsPerPage);
  const currentHistoryJobs = historyJobs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const displayJobs = activeTab === 'active' ? activeJobs : currentHistoryJobs;

  const searchKeyword = formData.customer_name.trim().toLowerCase();
  const isExactMatch = customersList.some(c => c.name === formData.customer_name && (c.phone || '') === formData.phone);
  
  const filteredCustomers = (searchKeyword.length > 0 && !isExactMatch) ? customersList.filter(c => {
    const nameLower = c.name.toLowerCase();
    const phoneStr = c.phone || '';
    const keywords = searchKeyword.split(/\s+/);
    return keywords.every(kw => nameLower.includes(kw) || phoneStr.includes(kw));
  }) : [];

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const monthNames = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));

    return (
      <div className="bg-white rounded-xl shadow-md p-4 mt-2">
        <div className="flex justify-between items-center mb-4">
          <button onClick={() => setCurrentMonth(new Date(year, month - 1, 1))} className="text-xl p-2 font-bold text-gray-500 hover:text-orange-500">{"<"}</button>
          <h2 className="text-lg font-bold text-gray-800">{monthNames[month]} {year + 543}</h2>
          <button onClick={() => setCurrentMonth(new Date(year, month + 1, 1))} className="text-xl p-2 font-bold text-gray-500 hover:text-orange-500">{">"}</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-gray-500 mb-2">
          <div>อา</div><div>จ</div><div>อ</div><div>พ</div><div>พฤ</div><div>ศ</div><div>ส</div>
        </div>
        <div className="grid grid-cols-7 gap-2 text-center">
          {days.map((day, idx) => {
            if (!day) return <div key={idx} className="p-2"></div>;
            const jobsOnThisDay = jobs.filter(j => new Date(j.job_date).toDateString() === day.toDateString());
            const hasJobs = jobsOnThisDay.length > 0;
            const isToday = new Date().toDateString() === day.toDateString();

            return (
              <div 
                key={idx} 
                onClick={() => {
                  if (hasJobs) setSelectedDayJobs({ date: day, jobs: jobsOnThisDay });
                  else openAddFormForDate(day);
                }}
                className={`relative p-2 h-10 w-full flex items-center justify-center rounded-lg cursor-pointer transition ${isToday ? 'bg-orange-100 border border-orange-300 text-orange-800' : 'hover:bg-gray-100'}`}
              >
                <span className="font-semibold text-gray-700">{day.getDate()}</span>
                {hasJobs && <span className="absolute bottom-1 w-1.5 h-1.5 bg-red-500 rounded-full"></span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 font-sans pb-24">
      <div className="max-w-md mx-auto">
        {/* 🐘 Header ช้างขาวเจริญทรัพย์ */}
        <div className="bg-gradient-to-r from-emerald-800 via-green-700 to-teal-900 py-3.5 px-4 rounded-2xl shadow-lg mb-3 text-center relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center">
            <div className="relative mb-1">
              <div className="absolute inset-0 bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 rounded-xl blur-lg opacity-80 animate-pulse"></div>
              <div className="absolute -top-2 -left-2 text-yellow-100 text-xs font-bold animate-pulse">✦</div>
              <div className="absolute -top-2 -right-2 text-yellow-300 text-xs font-bold animate-pulse">✦</div>
              <div className="absolute -bottom-1 -left-2 text-amber-200 text-xs font-bold animate-pulse">✦</div>
              <div className="absolute -bottom-1 -right-2 text-amber-300 text-xs font-bold animate-pulse">✦</div>
              <div className="relative inline-flex items-center justify-center w-14 h-14 bg-black/20 backdrop-blur-md rounded-xl shadow-inner border border-amber-300/40">
                <img src="/elephant.png" alt="ช้างขาว" className="w-full h-full object-contain scale-[1.25] drop-shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
              </div>
            </div>
            <h1 className="text-xl font-black tracking-wide bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-400 bg-clip-text text-transparent drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] leading-tight">
              ช้างขาวเจริญทรัพย์
            </h1>
            <div className="mt-1.5 inline-flex items-center gap-1.5 bg-black/30 backdrop-blur-md py-0.5 px-3 rounded-full border border-amber-300/30 text-sm font-semibold text-amber-200">
              <span className="text-base">🌾</span><span>ระบบจัดการคิวรถเกี่ยว</span>
            </div>
          </div>
        </div>

        {/* 🔘 ปุ่มสลับแท็บหลัก (Main Tab Bar - จำกัด 5 เมนู) */}
        <div className="flex bg-white rounded-2xl p-1.5 mb-5 shadow-sm border border-gray-100 overflow-x-auto gap-1">
          <button onClick={() => setActiveTab('active')} className={`min-w-[60px] flex-1 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs transition-all duration-200 ${activeTab === 'active' ? 'bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-md shadow-green-200 scale-[1.02]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>🚜 คิวงาน</button>
          
          <button onClick={() => setActiveTab('calendar')} className={`min-w-[60px] flex-1 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs transition-all duration-200 ${activeTab === 'calendar' ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-orange-200 scale-[1.02]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>📅 ปฏิทิน</button>
          
          <button onClick={() => setActiveTab('gps')} className={`min-w-[60px] flex-1 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs transition-all duration-200 ${activeTab === 'gps' ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-200 scale-[1.02]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>🛰️ พิกัด</button>
          
          {/* 💡 รวบเมนู บัญชี, ลูกหนี้, ประวัติ ไว้ในแท็บนี้ */}
          <button onClick={() => { setActiveTab('finance'); fetchDashboard(); }} className={`min-w-[60px] flex-1 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs transition-all duration-200 ${activeTab === 'finance' ? 'bg-gradient-to-r from-purple-500 to-fuchsia-600 text-white shadow-md shadow-purple-200 scale-[1.02]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>💰 บัญชี</button>
          
          <button onClick={() => { setActiveTab('settings'); fetchAllCustomers(); }} className={`min-w-[60px] flex-1 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs transition-all duration-200 ${activeTab === 'settings' ? 'bg-gradient-to-r from-slate-600 to-slate-700 text-white shadow-md shadow-slate-200 scale-[1.02]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>⚙️ ตั้งค่า</button>
        </div>

        {/* 📑 เมนูย่อยสำหรับแท็บบัญชี (โชว์เฉพาะตอนกดแท็บ 💰 บัญชี) */}
        {activeTab === 'finance' && (
          <div className="flex bg-gray-200 rounded-xl p-1 mb-5 gap-1 shadow-inner overflow-x-auto">
             <button onClick={() => { setFinanceSubTab('dashboard'); fetchDashboard(); }} className={`min-w-[65px] flex-1 py-2 rounded-lg font-bold text-xs transition ${financeSubTab === 'dashboard' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>📊 สรุปยอด</button>
             <button onClick={() => setFinanceSubTab('debt')} className={`min-w-[65px] flex-1 py-2 rounded-lg font-bold text-xs transition ${financeSubTab === 'debt' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>💸 ลูกหนี้</button>
             
             {/* 👇 ปุ่มที่เพิ่มใหม่ สำหรับดูคนเพิ่งจ่ายเงิน 👇 */}
             <button onClick={() => setFinanceSubTab('income')} className={`min-w-[65px] flex-1 py-2 rounded-lg font-bold text-xs transition ${financeSubTab === 'income' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>💵 รับเงิน</button>
             
             <button onClick={() => setFinanceSubTab('history')} className={`min-w-[65px] flex-1 py-2 rounded-lg font-bold text-xs transition ${financeSubTab === 'history' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>📋 ประวัติ</button>
          </div>
        )}

        {activeTab === 'calendar' && renderCalendar()}

        {/* 👇 วางหน้าจอ GPS ตรงนี้ 👇 */}
        {activeTab === 'gps' && (
          <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden flex flex-col h-[75vh]">
            
            {/* แผงควบคุมด้านบน */}
            <div className="p-4 bg-gray-50 border-b border-gray-200 z-10 relative shadow-sm">
              <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                <span className="text-blue-600">🛰️</span> ระบบติดตามรถเกี่ยว
              </h2>
              
              <div className="flex gap-2 mb-3 bg-gray-200 p-1 rounded-lg">
                <button 
                  onClick={() => setTrackingMode('realtime')}
                  className={`flex-1 py-1.5 text-sm font-bold rounded-md transition ${trackingMode === 'realtime' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
                >
                  🟢 ทำงานปัจจุบัน
                </button>
                <button 
                  onClick={() => setTrackingMode('history')}
                  className={`flex-1 py-1.5 text-sm font-bold rounded-md transition ${trackingMode === 'history' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}
                >
                  🕒 ดูประวัติย้อนหลัง
                </button>
              </div>

              <div className="flex gap-2">
                <select 
                  className="flex-1 border border-gray-300 p-2 rounded-lg bg-white text-sm font-bold text-gray-700"
                  value={trackingVehicleId}
                  onChange={(e) => setTrackingVehicleId(e.target.value)}
                >
                  <option value="">-- เลือกรถเกี่ยว --</option>
                  {vehicles.map(v => ( <option key={v.id} value={v.id}>🚜 {v.name}</option> ))}
                </select>

                {trackingMode === 'history' && (
                  <input 
                    type="date" 
                    className="flex-1 border border-gray-300 p-2 rounded-lg bg-white text-sm"
                    value={trackingDate}
                    onChange={(e) => setTrackingDate(e.target.value)}
                  />
                )}
              </div>

              <button 
                onClick={async () => {
                  if(!trackingVehicleId) return alert('กรุณาเลือกรถเกี่ยวครับ');
                  setIsFetchingGps(true);
                  try {
                    // 💡 แก้บั๊ก Timezone: ถ้าเป็น Realtime บังคับสร้างวันที่ปัจจุบัน (เวลาไทย) ส่งไปเลย
                    let dateToSend = trackingDate;
                    if (trackingMode === 'realtime') {
                      const now = new Date();
                      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                      dateToSend = now.toISOString().slice(0, 10);
                    }
                    
                    // บังคับแนบ ?date= ไปที่ API เสมอ เพื่อให้หลังบ้านใช้สูตร +07:00 ที่เราเขียนไว้
                    const res = await fetch(`https://harvester-api-server.onrender.com/api/gps/${trackingVehicleId}?date=${dateToSend}`);
                    const data = await res.json();
                    
                    if(data.length === 0) alert('ไม่มีข้อมูลการวิ่งในวันที่เลือกครับ (รถอาจจะยังไม่สตาร์ท)');
                    setGpsPathData(data);
                  } catch(e) { console.error(e); }
                  setIsFetchingGps(false);
                }}
                className="w-full mt-3 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg text-sm shadow-md transition flex justify-center items-center gap-2"
              >
                {isFetchingGps ? '⏳ กำลังดึงข้อมูล...' : '🔍 ค้นหาเส้นทาง'}
              </button>
            </div>

            {/* แผงบอกสถานะ (ย้ายออกมาจัดเรียงด้านบน ไม่ให้ลอยบังแผนที่บนมือถือ) */}
            {gpsPathData.length > 0 && (
              <div className="bg-white border-b border-gray-200 p-3 z-10 shadow-sm">
                 
                 {/* ส่วนที่ 1: เวลาล่าสุด + ปุ่มนำทางด่วน */}
                 <div className="flex justify-between items-start">
                    <div>
                       <p className="text-xs text-gray-500 mb-0.5">ข้อมูลจุดล่าสุด (เวลา):</p>
                       <p className="font-bold text-blue-800 text-sm">
                         {new Date(gpsPathData[gpsPathData.length-1].created_at).toLocaleString('th-TH')}
                       </p>
                    </div>
                    <button 
                      onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${gpsPathData[gpsPathData.length-1].latitude},${gpsPathData[gpsPathData.length-1].longitude}`, '_blank')}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded-lg shadow-sm font-bold flex items-center gap-1 transition"
                    >
                      📍 นำทาง
                    </button>
                 </div>
                 
                 {/* ส่วนที่ 2: โชว์พิกัด + ปุ่มคัดลอก */}
                 <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center">
                    <div>
                      <p className="text-xs text-gray-500">พิกัด GPS (Lat, Lon):</p>
                      <p className="font-mono text-xs text-gray-700 font-semibold">
                        {gpsPathData[gpsPathData.length-1].latitude}, {gpsPathData[gpsPathData.length-1].longitude}
                      </p>
                    </div>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(`${gpsPathData[gpsPathData.length-1].latitude}, ${gpsPathData[gpsPathData.length-1].longitude}`);
                        alert('📋 คัดลอกพิกัดเรียบร้อยแล้ว นำไปวางได้เลยครับ!');
                      }}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs px-3 py-1.5 rounded-lg font-bold transition shadow-sm"
                    >
                      📋 คัดลอก
                    </button>
                 </div>

                 {/* ส่วนที่ 3: ระบบคำนวณพื้นที่อัตโนมัติ */}
                 {gpsPathData.length >= 3 && (
                   <div className="mt-2 pt-2 border-t border-green-100 bg-green-50/50 -mx-3 -mb-3 p-3 flex justify-between items-center">
                      <p className="text-xs text-green-700 font-bold">📐 พื้นที่วิ่งงานโดยประมาณ:</p>
                      <p className="font-bold text-green-700 text-sm bg-green-200/50 px-2 py-1 rounded-md">
                        {(() => {
                           try {
                             const turfPoints = turf.featureCollection(gpsPathData.map(p => turf.point([p.longitude, p.latitude])));
                             const hull = turf.convex(turfPoints);
                             if (!hull) return 'กำลังรวบรวมข้อมูล...';
                             const sqM = turf.area(hull);
                             const rai = Math.floor(sqM / 1600);
                             const ngan = Math.floor((sqM % 1600) / 400);
                             const sqWah = ((sqM % 400) / 4).toFixed(1);
                             return `${rai} ไร่ ${ngan} งาน ${sqWah} ตร.ว.`;
                           } catch (e) {
                             return 'กำลังคำนวณ...';
                           }
                        })()}
                      </p>
                   </div>
                 )}

              </div>
            )}

            {/* ส่วนแสดงแผนที่ */}
            <div className="flex-1 relative bg-gray-200 min-h-[300px]">
              <TrackingMap pathData={gpsPathData} />
              
              {/* ข้อความแจ้งเตือนตอนยังไม่มีข้อมูล */}
              {gpsPathData.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center z-[400] pointer-events-none">
                  <div className="bg-white/90 backdrop-blur border border-gray-300 p-3 rounded-xl shadow-sm text-center text-gray-500 text-sm font-bold pointer-events-auto">
                    กรุณากดปุ่มค้นหาเพื่อดูเส้นทาง
                  </div>
                </div>
              )}
            </div>

          </div>
        )}
        {/* 👆 จบหน้าจอ GPS 👆 */}

        {/* ⚙️ หน้าตั้งค่าระบบ */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-5 shadow-md border border-gray-200">
              <h2 className="text-lg font-bold text-gray-800 mb-4">🛠️ ตั้งค่าระบบ</h2>
              <div className="space-y-3">
                <button onClick={() => setShowCustomerManager(true)} className="w-full flex items-center justify-between p-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition">
                  <span className="font-bold text-blue-800">👥 จัดการฐานข้อมูลลูกค้า</span>
                  <span className="text-blue-500 font-bold">▶</span>
                </button>
                <button onClick={() => setShowVehicleManager(true)} className="w-full flex items-center justify-between p-4 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl transition">
                  <span className="font-bold text-orange-800">🚜 จัดการรายชื่อรถเกี่ยว</span>
                  <span className="text-orange-500 font-bold">▶</span>
                </button>

                {/* 👇 ปุ่มที่เพิ่มใหม่ สำหรับดูสรุปยอดค่าแรง 👇 */}
                <button 
                  onClick={() => { setShowWageSummary(true); fetchWages(); }} 
                  className="w-full flex items-center justify-between p-4 bg-green-50 hover:bg-green-100 border border-green-200 rounded-xl transition shadow-sm"
                >
                  <span className="font-bold text-green-800">💰 สมุดจดค่าแรงลูกจ้าง</span>
                  <span className="text-green-500 font-bold">▶</span>
                </button>

              </div>
            </div>
          </div>
        )}

        {/* แสดงข้อความแจ้งเตือนเมื่อไม่มีข้อมูล */}
        {((activeTab === 'active' && activeJobs.length === 0) || 
          (activeTab === 'finance' && financeSubTab === 'history' && historyJobs.length === 0)) && (
          <div className="text-center text-gray-500 mt-10">
            <p className="text-4xl mb-2">🍃</p>
            <p>ยังไม่มีข้อมูลในหน้านี้ครับ</p>
          </div>
        )}

        {(activeTab === 'active' || (activeTab === 'finance' && financeSubTab === 'history')) && (
          <div className="space-y-4">
            {displayJobs.map((job) => {
              const statusObj = getStatusDisplay(job.status);
              const isExpanded = expandedId === job.id;
              const jobDateTime = formatDate(job.job_date);
              const assignedVehicle = vehicles.find(v => v.id === job.vehicle_id);

              return (
                <div key={job.id} className="bg-white rounded-xl p-5 shadow-md border border-gray-200">
                  <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-2 mb-3">
                    <div className="text-indigo-800 font-bold text-sm flex justify-between px-1">
                      <span>📅 {jobDateTime.date}</span>
                      <span>⏰ {jobDateTime.time} น.</span>
                    </div>
                  </div>

                  <div className="cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : job.id)}>
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">{job.customers?.name || 'ไม่ระบุชื่อ'}</h2>
                        <p className="text-sm text-gray-500">
                          📞 {job.customers?.phone && job.customers.phone !== '-' && !job.customers.phone.startsWith('ไม่มี') ? (
                            <a 
                              href={`tel:${job.customers.phone}`} 
                              onClick={(e) => e.stopPropagation()} 
                              className="text-blue-600 font-bold hover:underline"
                            >
                              {job.customers.phone}
                            </a>
                          ) : (
                            <span>{job.customers?.phone || '-'}</span>
                          )}
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${statusObj.color}`}>
                        {statusObj.text}
                      </span>
                    </div>

                    {/* 💡 กล่องประเภทพืชแบบแยกสี + ไอคอน */}
                    <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                      <div className={`p-2 rounded-lg border ${
                        job.crop_type === 'ข้าว' ? 'bg-amber-50 border-amber-200' :
                        job.crop_type === 'ข้าวโพด' ? 'bg-orange-50 border-orange-200' :
                        job.crop_type === 'ถั่ว' ? 'bg-emerald-50 border-emerald-200' :
                        'bg-gray-50 border-gray-200'
                      }`}>
                        <span className="block text-gray-500 text-xs">ประเภทพืช</span>
                        <span className={`font-bold ${
                          job.crop_type === 'ข้าว' ? 'text-amber-700' :
                          job.crop_type === 'ข้าวโพด' ? 'text-orange-700' :
                          job.crop_type === 'ถั่ว' ? 'text-emerald-700' :
                          'text-gray-800'
                        }`}>
                          {job.crop_type === 'ข้าว' ? '🌾 ' : 
                           job.crop_type === 'ข้าวโพด' ? '🌽 ' : 
                           job.crop_type === 'ถั่ว' ? '🥜 ' : ''}
                          {job.crop_type}
                        </span>
                      </div>
                      
                      <div className="bg-gray-50 border border-gray-200 p-2 rounded-lg">
                        <span className="block text-gray-500 text-xs">พื้นที่</span>
                        <span className="font-semibold text-gray-800">{job.area_size || 0} ไร่</span>
                      </div>
                    </div>
                    
                    {/* 💰 กล่องโชว์ยอดเงิน (แก้บั๊กเลข 0 ลอยตัว) */}
                    {(Number(job.price_per_rai) > 0 || Number(job.total_price) > 0) ? (
                      <div className="bg-green-50 p-2 rounded-lg mb-3 flex justify-between items-center border border-green-200">
                        <div>
                          <span className="block text-green-700 text-xs">
                            ยอดรวม ({job.price_per_rai || 0} บ./ไร่)
                          </span>
                          <span className="font-bold text-green-800 text-lg">
                            {job.total_price ? Number(job.total_price).toLocaleString() : '0'} บาท
                          </span>
                        </div>
                        <div>
                          <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                            job.payment_status === 'PAID'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : job.payment_status === 'DEPOSIT'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : 'bg-slate-100 text-slate-700 border border-slate-300'
                          }`}>
                            {job.payment_status === 'PAID'
                              ? '✅ ชำระเรียบร้อย'
                              : job.payment_status === 'DEPOSIT'
                              ? '💳 มัดจำแล้ว'
                              : '⏳ รอชำระเงิน'}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-300">
                      <div className="bg-yellow-50 p-3 rounded-lg text-sm text-gray-800 mb-4 border border-yellow-200">
                        <span className="font-bold text-yellow-700">📍 หมายเหตุ:</span><br/>
                        {/* 💡 ดึงหมายเหตุของคิวงานมาโชว์ */}
                        {job.address_note || job.customers?.address_note || 'ไม่มีข้อมูล'}
                      </div>

                      {/* 👇 📸 ส่วนของแกลเลอรี่รูปภาพ 👇 */}
                      <div className="mb-4">
                        <h3 className="font-bold text-gray-800 text-sm mb-3">📸 แกลเลอรี่ภาพ (รูปงาน & สลิป)</h3>

                        {/* ฟอร์มอัปโหลดรูป */}
                        <div className="flex gap-2 mb-3 bg-gray-50 p-2 rounded-lg border border-gray-200 items-center">
                          <select
                            className="text-xs p-2 rounded-md border border-gray-300 flex-1 outline-none font-bold text-gray-700 bg-white"
                            value={uploadCategory}
                            onChange={(e) => setUploadCategory(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="MAP">🗺️ รูปวัดแปลง </option>
                            <option value="BEFORE">🌾 ก่อนเกี่ยว</option>
                            <option value="DURING">🚜 ระหว่างทำ</option>
                            <option value="AFTER">✅ หลังเกี่ยวเสร็จ</option>
                            <option value="SLIP">🧾 สลิปโอนเงิน</option>
                            <option value="DAMAGE">⚠️ รถพัง/เสียหาย</option>
                            <option value="OTHER">📁 อื่นๆ</option>
                          </select>
                          <label className={`bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2.5 px-4 rounded-md cursor-pointer transition shadow-sm ${isUploadingImage ? 'opacity-50 pointer-events-none' : ''}`} onClick={(e) => e.stopPropagation()}>
                            {isUploadingImage ? '⏳ กำลังอัป...' : '➕ อัปโหลด'}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleImageUpload(e, job.id)}
                            />
                          </label>
                        </div>

                        {/* ตะแกรงโชว์รูปภาพ */}
                        {jobAttachments.length === 0 ? (
                          <div className="text-center text-xs text-gray-400 py-6 bg-gray-50 rounded-lg border border-dashed border-gray-300 font-semibold">
                            ยังไม่มีรูปภาพสำหรับงานนี้
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            {/* 👇 สังเกตตรงวงเล็บ (img, idx) และ setFullScreenIndex(idx) นะครับ 👇 */}
                            {jobAttachments.map((img, idx) => (
                              <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 shadow-sm cursor-pointer hover:opacity-90 transition group" onClick={(e) => { e.stopPropagation(); setFullScreenIndex(idx); }}>
                                
                                {/* ปุ่มกากบาทสีแดงสำหรับลบรูป */}
                                <button 
                                  onClick={(e) => handleDeleteImage(e, img.id, img.image_url, job.id)}
                                  className="absolute top-1 right-1 bg-red-500/90 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-md hover:bg-red-600 z-10"
                                >
                                  ✕
                                </button>

                                <img src={img.image_url} alt="job-attachment" className="w-full h-full object-cover" />
                                
                                <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] text-center py-1 font-bold">
                                  {img.category === 'MAP' ? 'รูปวัดแปลง' : 
                                   img.category === 'BEFORE' ? 'ก่อนเกี่ยว' : 
                                   img.category === 'DURING' ? 'ระหว่างทำ' : 
                                   img.category === 'AFTER' ? 'เสร็จสิ้น' : 
                                   img.category === 'SLIP' ? 'สลิป' : 
                                   img.category === 'DAMAGE' ? 'รถพัง' : 'ทั่วไป'}
                                </span>
                                
                                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center pointer-events-none">
                                  <span className="text-white text-xl">🔍</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* 👆 จบส่วนแกลเลอรี่ 👆 */}

                      {/* กลุ่มปุ่มเปลี่ยนสถานะงาน */}
                      <div className="flex gap-2 pt-3 border-t border-gray-200">
                        {job.status !== 'IN_PROGRESS' && <button onClick={() => updateStatus(job.id, 'IN_PROGRESS')} className="flex-1 bg-blue-500 hover:bg-blue-600 text-white text-xs py-2.5 rounded-lg font-bold shadow-sm transition">▶️ เริ่มเกี่ยว</button>}
                        
                        {job.status !== 'DONE' && (
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setWageData({ area: job.area_size || '', wagePerRai: 60, workers: '' }); 
                              setFinishingJob(job); 
                            }} 
                            className="flex-1 bg-green-500 hover:bg-green-600 text-white text-xs py-2.5 rounded-lg font-bold shadow-sm transition"
                          >
                            ✅ เสร็จสิ้น
                          </button>
                        )}

                        {job.status !== 'PENDING' && <button onClick={() => updateStatus(job.id, 'PENDING')} className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white text-xs py-2.5 rounded-lg font-bold shadow-sm transition">⏳ รอคิว</button>}
                      </div>

                      {/* กลุ่มปุ่มแก้ไขข้อมูล */}
                      <div className="flex gap-2 pt-2 mt-2">
                        <button onClick={(e) => { e.stopPropagation(); openEditForm(job); }} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white text-xs py-2 rounded-lg font-bold transition">✏️ แก้ไขข้อมูล</button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteJob(job.id); }} className="flex-1 bg-red-500 hover:bg-red-600 text-white text-xs py-2 rounded-lg font-bold transition">🗑️ ลบงาน</button>
                      </div>
                    </div>
                  )}
                  
                  <div className="text-sm flex justify-between items-center border-t pt-3 mt-3">
                    <div>
                      <p>🚜 รถ: <span className="font-semibold text-blue-700">
                        {assignedVehicle ? assignedVehicle.name : '⏳ ยังไม่จัดรถ'}
                      </span></p>
                      {assignedVehicle && assignedVehicle.driver_name && (
                        <p className="text-xs text-gray-500 mt-1">👨‍🌾 คนขับ: {assignedVehicle.driver_name}</p>
                      )}
                    </div>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${job.latitude},${job.longitude}`} target="_blank" className="bg-blue-600 text-white text-xs font-bold py-2 px-4 rounded-lg" onClick={(e) => e.stopPropagation()}>📍 นำทาง</a>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ปุ่มแบ่งหน้า (ประวัติ) */}
        {activeTab === 'finance' && financeSubTab === 'history' && historyJobs.length > 0 && (
          <div className="flex justify-between items-center mt-6 bg-white p-3 rounded-xl shadow-sm border border-gray-200">
            <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} className={`px-4 py-2 rounded-lg font-bold text-sm transition ${currentPage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-orange-100 text-orange-700 hover:bg-orange-200 shadow-sm'}`}>◀ ก่อนหน้า</button>
            <span className="text-sm font-bold text-gray-600">หน้า {currentPage} / {totalPages || 1}</span>
            <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} className={`px-4 py-2 rounded-lg font-bold text-sm transition ${currentPage === totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-orange-100 text-orange-700 hover:bg-orange-200 shadow-sm'}`}>ถัดไป ▶</button>
          </div>
        )}

        {/* 📊 หน้าจอ Dashboard */}
        {activeTab === 'finance' && financeSubTab === 'dashboard' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-5 shadow-md border border-gray-200">
              
              {/* ตัวกรองเดือนและปี */}
              <div className="flex gap-2 mb-5">
                <select 
                  className="flex-1 border border-gray-300 p-2 rounded-lg bg-gray-50 font-bold text-gray-700 outline-none focus:ring-2 focus:ring-purple-400"
                  value={dashMonth} onChange={(e) => setDashMonth(Number(e.target.value))}
                >
                  {["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"].map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                  ))}
                </select>
                <select 
                  className="w-1/3 border border-gray-300 p-2 rounded-lg bg-gray-50 font-bold text-gray-700 outline-none focus:ring-2 focus:ring-purple-400"
                  value={dashYear} onChange={(e) => setDashYear(Number(e.target.value))}
                >
                  <option value={new Date().getFullYear()}>ปีนี้</option>
                  <option value={new Date().getFullYear() - 1}>ปีที่แล้ว</option>
                </select>
              </div>

              {isFetchingDash ? (
                <div className="text-center py-10 text-gray-500 font-bold">⏳ กำลังคำนวณบัญชี...</div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  
                  <div className="bg-green-50 p-4 rounded-xl border border-green-200 shadow-sm">
                    <p className="text-green-800 text-xs font-bold mb-1">📈 รายรับ (เก็บเงินแล้ว)</p>
                    <p className="text-2xl font-black text-green-600">{dashboardData.totalIncome.toLocaleString()} ฿</p>
                  </div>
                  
                  <div className="bg-red-50 p-4 rounded-xl border border-red-200 shadow-sm">
                    <p className="text-red-800 text-xs font-bold mb-1">📉 รายจ่าย (ค่าแรง ฯลฯ)</p>
                    <p className="text-2xl font-black text-red-500">{dashboardData.totalExpense.toLocaleString()} ฿</p>
                  </div>

                  <div className="col-span-2 bg-gradient-to-r from-blue-500 to-indigo-600 p-4 rounded-xl shadow-md text-white mt-2">
                    <p className="text-blue-100 text-sm font-bold mb-1">💰 กำไรสุทธิ (เดือนนี้)</p>
                    <p className="text-4xl font-black">{dashboardData.netProfit.toLocaleString()} <span className="text-lg font-normal">บาท</span></p>
                    <p className="text-xs text-blue-200 mt-2">พื้นที่เก็บเกี่ยวรวม: <span className="font-bold text-white">{dashboardData.totalArea} ไร่</span></p>
                  </div>

                  <div className="col-span-2 bg-orange-50 p-4 rounded-xl border border-orange-200 shadow-sm mt-2 flex justify-between items-center">
                    <div>
                      <p className="text-orange-900 text-sm font-bold">⚠️ ลูกหนี้ค้างชำระ</p>
                      <p className="text-xs text-orange-700">คิวงานที่ยังไม่ได้เก็บเงิน</p>
                    </div>
                    <p className="text-2xl font-black text-orange-600">{dashboardData.totalUnpaid.toLocaleString()} ฿</p>
                  </div>

                </div>
              )}
            </div>
          </div>
        )}

        {/* 💸 หน้าจอจัดการลูกหนี้ */}
        {activeTab === 'finance' && financeSubTab === 'debt' && (
          <div className="space-y-4">
            
            {/* กล่องสรุปยอดหนี้รวม */}
            <div className="bg-gradient-to-r from-red-50 to-orange-50 p-5 rounded-xl border border-red-200 shadow-sm flex justify-between items-center">
               <div>
                 <h2 className="text-lg font-black text-red-800">💸 บัญชีลูกหนี้</h2>
                 <p className="text-xs text-red-600 font-semibold mt-1">คิวงานที่เสร็จแล้วแต่ค้างจ่าย</p>
               </div>
               <div className="text-right">
                 <span className="block text-xs text-red-700 font-bold mb-1">ยอดหนี้รวมทั้งหมด</span>
                 <span className="text-3xl font-black text-red-600">
                   {jobs.filter(j => j.status === 'DONE' && j.payment_status !== 'PAID').reduce((sum, j) => sum + (Number(j.total_price) || 0), 0).toLocaleString()} <span className="text-sm">฿</span>
                 </span>
               </div>
            </div>

            {/* รายการลูกหนี้ */}
            {jobs.filter(j => j.status === 'DONE' && j.payment_status !== 'PAID').length === 0 ? (
              <div className="text-center text-gray-500 py-10 bg-white rounded-xl shadow-sm border border-gray-200">
                 <span className="text-4xl mb-2 block">🎉</span>
                 <p className="font-bold">ไม่มีลูกหนี้ค้างชำระ!</p>
                 <p className="text-sm mt-1">เก็บเงินครบทุกงานแล้วครับ เถ้าแก่ยิ้มได้เลย</p>
              </div>
            ) : (
              jobs.filter(j => j.status === 'DONE' && j.payment_status !== 'PAID')
                .sort((a, b) => new Date(b.job_date) - new Date(a.job_date)) // เรียงจากเก่าไปใหม่
                .map(job => (
                  <div key={job.id} className="bg-white p-5 rounded-xl shadow-md border border-red-100 relative overflow-hidden">
                     <div className="absolute top-0 left-0 w-1.5 h-full bg-red-400"></div>
                     <div className="flex justify-between items-start mb-3 pl-2">
                        <div>
                          <h3 className="font-bold text-gray-900 text-lg">{job.customers?.name || 'ไม่ระบุชื่อ'}</h3>
                          <p className="text-sm text-gray-500">
                            📞 {job.customers?.phone && job.customers.phone !== '-' && !job.customers.phone.startsWith('ไม่มี') ? (
                              <a 
                                href={`tel:${job.customers.phone}`} 
                                onClick={(e) => e.stopPropagation()} 
                                className="text-blue-600 font-bold hover:underline"
                              >
                                {job.customers.phone}
                              </a>
                            ) : (
                              <span>{job.customers?.phone || '-'}</span>
                            )}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="block font-black text-red-600 text-2xl leading-none">
                            {Number(job.total_price).toLocaleString()} <span className="text-sm">฿</span>
                          </span>
                          <span className={`inline-block px-2 py-1 rounded text-[10px] font-bold mt-1.5 ${job.payment_status === 'DEPOSIT' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>
                            {job.payment_status === 'DEPOSIT' ? '💳 มัดจำแล้ว (ค้างส่วนต่าง)' : '⏳ ยังไม่จ่ายเลย'}
                          </span>
                        </div>
                     </div>
                     
                     <div className="pl-2 mb-4 text-sm text-gray-600 bg-gray-50 p-2 rounded-lg border border-gray-100">
                       <p>📅 <strong>วันที่เกี่ยว:</strong> {new Date(job.job_date).toLocaleDateString('th-TH')}</p>
                       <p>📐 <strong>รายละเอียด:</strong> {job.area_size || 0} ไร่ ({job.crop_type})</p>
                       {job.address_note && <p className="text-xs text-gray-500 mt-1">📍 {job.address_note}</p>}
                     </div>

                     <div className="flex gap-2 pl-2">
                        <button 
                          onClick={() => {
                            // 💬 จัดฟอร์แมตข้อความทวงหนี้แบบสุภาพ
                            const text = `แจ้งยอดค้างชำระค่าเกี่ยวข้าวครับ 🌾\n\n👤 ชื่อลูกค้า: ${job.customers?.name}\n📅 วันที่เกี่ยว: ${new Date(job.job_date).toLocaleDateString('th-TH')}\n📐 พื้นที่: ${job.area_size || 0} ไร่ (${job.crop_type})\n\n💰 ยอดที่ต้องชำระ: ${Number(job.total_price).toLocaleString()} บาท\n\nรบกวนโอนชำระและส่งสลิปให้ด้วยนะครับ ขอบคุณครับ 🙏`;
                            navigator.clipboard.writeText(text);
                            alert('📋 คัดลอกข้อความทวงหนี้เรียบร้อยแล้ว!\nนำไปกด "วาง" (Paste) ในแชท LINE ลูกค้าได้เลยครับ');
                          }}
                          className="flex-1 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 border border-blue-200 font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1 shadow-sm"
                        >
                          💬 ก๊อปปี้ข้อความทวง
                        </button>
                        <button 
                          onClick={() => {
                            if(window.confirm(`ยืนยันว่าลูกค้า [ ${job.customers?.name} ] จ่ายเงินยอด ${Number(job.total_price).toLocaleString()} บาท เรียบร้อยแล้วใช่ไหมครับ?\n\n(ถ้ายืนยัน งานนี้จะหายไปจากหน้าลูกหนี้ทันที)`)) {
                              updatePaymentStatus(job.id, 'PAID');
                            }
                          }}
                          className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-2.5 rounded-xl text-xs shadow-md transition flex items-center justify-center gap-1"
                        >
                          ✅ รับเงินเรียบร้อย
                        </button>
                     </div>
                  </div>
              ))
            )}
          </div>
        )}

        {/* 💵 หน้าจอประวัติการรับเงิน (เช็คยอดรายวัน) */}
        {activeTab === 'finance' && financeSubTab === 'income' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-5 rounded-xl border border-green-200 shadow-sm flex justify-between items-center">
               <div>
                 <h2 className="text-lg font-black text-green-800">💵 ประวัติรับเงิน</h2>
                 <p className="text-xs text-green-600 font-semibold mt-1">รายการโอน/เงินสด ที่เก็บแล้ว</p>
               </div>
               <div className="text-right">
                 <span className="block text-xs text-green-700 font-bold mb-1">ยอดรับรวมทั้งหมด</span>
                 <span className="text-3xl font-black text-green-600">
                   {jobs.filter(j => j.payment_status === 'PAID').reduce((sum, j) => sum + (Number(j.total_price) || 0), 0).toLocaleString()} <span className="text-sm">฿</span>
                 </span>
               </div>
            </div>

            {jobs.filter(j => j.payment_status === 'PAID').length === 0 ? (
               <div className="text-center text-gray-500 py-10 bg-white rounded-xl shadow-sm border border-gray-200">
                 <span className="text-4xl mb-2 block">🍃</span>
                 <p className="font-bold">ยังไม่มีประวัติการรับเงินครับ</p>
              </div>
            ) : (
              jobs.filter(j => j.payment_status === 'PAID')
                  .sort((a, b) => new Date(b.paid_at || b.job_date) - new Date(a.paid_at || a.job_date)) // เรียงจากรับเงินล่าสุดอยู่บน
                  .slice(0, 50) // โชว์แค่ 50 รายการล่าสุด ป้องกันเครื่องค้าง
                  .map(job => (
                    <div key={job.id} className="bg-white p-4 rounded-xl shadow-md border border-green-100 relative overflow-hidden flex justify-between items-center">
                       <div className="absolute top-0 left-0 w-1.5 h-full bg-green-400"></div>
                       <div className="pl-2">
                         <h3 className="font-bold text-gray-900 text-lg">{job.customers?.name || 'ไม่ระบุชื่อ'}</h3>
                         <p className="text-[11px] text-gray-500 mt-0.5">
                           📅 รับเงิน: <span className="font-semibold text-gray-800">{job.paid_at ? new Date(job.paid_at).toLocaleString('th-TH') : 'ไม่มีข้อมูลเวลา (งานเก่า)'}</span>
                         </p>
                       </div>
                       <div className="text-right">
                         <span className="block font-black text-green-600 text-xl leading-none">
                           {Number(job.total_price).toLocaleString()} <span className="text-sm">฿</span>
                         </span>
                         <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold mt-1.5 bg-green-100 text-green-700 border border-green-200">
                           ✅ จ่ายแล้ว
                         </span>
                       </div>
                    </div>
                  ))
            )}
          </div>
        )}

        {/* Popup คิวงานรายวันจากปฏิทิน */}
        {selectedDayJobs && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[100]">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-gray-800">📋 คิวงานวันที่ {selectedDayJobs.date.toLocaleDateString('th-TH')}</h2>
                <button onClick={() => setSelectedDayJobs(null)} className="text-gray-500 font-bold text-xl">❌</button>
              </div>
              <div className="space-y-3">
                {selectedDayJobs.jobs.map(job => (
                  <div key={job.id} onClick={() => { setSelectedDayJobs(null); openEditForm(job); }} className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                    <div className="flex justify-between items-center"><span className="font-bold text-gray-900">{job.customers?.name || 'ไม่ระบุชื่อ'}</span></div>
                    <p className="text-xs text-gray-500 mt-1">⏰ {new Date(job.job_date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น. | พื้นที่: {job.area_size || 0} ไร่</p>
                  </div>
                ))}
              </div>
              <button onClick={() => { setSelectedDayJobs(null); openAddFormForDate(selectedDayJobs.date); }} className="w-full mt-4 bg-orange-500 text-white py-2 rounded-lg font-bold shadow-md">+ เพิ่มคิวงานวันนี้</button>
            </div>
          </div>
        )}

        {/* ปุ่ม + เพิ่มคิวงาน */}
        {(activeTab === 'active' || (activeTab === 'finance' && financeSubTab === 'history')) && (
          <button 
            onClick={() => { 
              setEditingId(null); 
              setFormData({ customer_name: '', phone: '', address_note: '', crop_type: 'ข้าว', area_size: '', job_date: '', latitude: '', longitude: '', vehicle_id: 0, boundaries: [], price_per_rai: '', total_price: '', payment_status: 'UNPAID' });
              setShowAddForm(true); 
            }} 
            className="fixed bottom-6 right-6 bg-green-600 text-white p-4 rounded-full shadow-xl font-bold text-2xl w-14 h-14 flex items-center justify-center"
          >
            +
          </button>
        )}

        {/* 📝 ฟอร์ม เพิ่ม/แก้ไข คิวงาน */}
        {showAddForm && !showMapPicker && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[100]">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4 text-gray-800">
                {editingId ? '✏️ แก้ไขข้อมูลคิวงาน' : '📝 เพิ่มคิวงานใหม่'}
              </h2>
              <form onSubmit={handleAddJob} className="space-y-3 text-sm">
                
                <div className="relative">
                  <label className="block text-gray-700 mb-1 font-semibold">ชื่อลูกค้า</label>
                  <input 
                    type="text" required className="w-full border p-2 rounded-lg" 
                    placeholder="พิมพ์ชื่อหรือเบอร์เพื่อค้นหา..."
                    value={formData.customer_name} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormData({ ...formData, customer_name: val, phone: val === '' ? '' : formData.phone });
                    }} 
                  />
                  {filteredCustomers.length > 0 && !editingId && (
                    <div className="absolute left-0 right-0 bg-white border border-gray-300 rounded-lg shadow-lg mt-1 z-20 max-h-40 overflow-y-auto">
                      <p className="text-xs text-gray-400 p-2 bg-gray-50 border-b">💡 พบลูกค้าเก่า คลิกเพื่อเลือก:</p>
                      {filteredCustomers.map((cust, idx) => (
                        <div key={idx} onMouseDown={() => setFormData({ ...formData, customer_name: cust.name, phone: cust.phone || '' })} className="p-2 hover:bg-green-50 cursor-pointer border-b flex justify-between">
                          <span className="font-semibold text-gray-800">{cust.name}</span>
                          <span className="text-gray-500 text-xs">📞 {cust.phone || 'ไม่มีเบอร์'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-gray-700 mb-1 font-semibold">เบอร์โทรศัพท์</label>
                  {/* 💡 เอา required ออก อนุญาตให้เว้นว่างได้ */}
                  <input type="tel" className="w-full border p-2 rounded-lg bg-gray-50" placeholder="ยังไม่มีข้อมูล (เว้นว่างได้)" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} />
                </div>

                <div>
                  <label className="block text-gray-700 mb-1 font-semibold">วันเวลานัดหมาย</label>
                  <input type="datetime-local" required className="w-full border p-2 rounded-lg" value={formData.job_date} onChange={(e) => setFormData({...formData, job_date: e.target.value})} />
                </div>

                <div className="bg-orange-50 p-3 rounded-lg border border-orange-200 mt-3">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-orange-800 font-semibold">🚜 จัดรถเกี่ยว</label>
                    <button type="button" onClick={() => setShowVehicleManager(true)} className="bg-orange-200 hover:bg-orange-300 text-orange-800 text-xs px-2 py-1 rounded-md font-bold transition">
                      ⚙️ จัดการรถ
                    </button>
                  </div>
                  <select className="w-full border p-2 rounded-lg bg-white text-gray-800 font-bold" value={formData.vehicle_id || 0} onChange={(e) => setFormData({...formData, vehicle_id: Number(e.target.value)})}>
                    <option value={0}>⏳ ยังไม่จัดรถ</option>
                    {vehicles.map(v => ( <option key={v.id} value={v.id}>🚜 {v.name}</option> ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-700 mb-1 font-semibold">หมายเหตุ / จุดสังเกต (ของงานนี้)</label>
                  <textarea className="w-full border p-2 rounded-lg" rows="2" placeholder="เช่น แปลงติดคลองชลประทาน..." value={formData.address_note} onChange={(e) => setFormData({...formData, address_note: e.target.value})}></textarea>
                </div>

                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-blue-800 text-xs">📍 พิกัดแปลงนา (GPS)</span>
                    <div className="flex gap-1">
                      <button type="button" onClick={handleGetCurrentLocation} className="bg-blue-600 text-white text-xs py-1.5 px-2 rounded-lg font-bold">🎯 พิกัดปัจจุบัน</button>
                      <button type="button" onClick={() => setShowMapPicker(true)} className="bg-orange-500 text-white text-xs py-1.5 px-2 rounded-lg font-bold shadow-md">🗺️ เปิดแผนที่วาดแปลง</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 mb-2">
                    <input type="text" placeholder="Latitude" readOnly value={formData.latitude} className="border p-1.5 rounded bg-gray-100 w-full" />
                    <input type="text" placeholder="Longitude" readOnly value={formData.longitude} className="border p-1.5 rounded bg-gray-100 w-full" />
                  </div>
                  <div className="text-xs text-green-700 font-bold">*{formData.area_size ? `พื้นที่คำนวณได้: ${formData.area_size} ไร่` : 'ยังไม่ได้ระบุแปลงบนแผนที่'}</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 mb-1 font-semibold">ประเภทพืช</label>
                    <select className="w-full border p-2 rounded-lg bg-white" value={formData.crop_type} onChange={(e) => setFormData({...formData, crop_type: e.target.value})}>
                      <option value="ข้าว">ข้าว</option>
                      <option value="ข้าวโพด">ข้าวโพด</option>
                      <option value="ถั่ว">ถั่ว</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1 font-semibold">จำนวนไร่</label>
                    {/* 💡 เอา required ออก อนุญาตให้เว้นว่างได้ */}
                    <input type="number" step="0.01" className="w-full border p-2 rounded-lg bg-green-50 font-bold text-green-800" placeholder="ยังไม่ระบุ"
                      value={formData.area_size}
                      onChange={(e) => {
                        const area = e.target.value;
                        const total = (area && formData.price_per_rai) ? (parseFloat(area) * parseFloat(formData.price_per_rai)).toFixed(2) : '';
                        setFormData({...formData, area_size: area, total_price: total});
                      }} 
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3 mt-3 border-t border-gray-200 pt-3">
                  <div>
                    <label className="block text-gray-700 mb-1 font-semibold">ราคาต่อไร่ (บาท)</label>
                    <input type="number" className="w-full border p-2 rounded-lg bg-white" placeholder="เช่น 600" 
                      value={formData.price_per_rai}
                      onChange={(e) => {
                        const price = e.target.value;
                        const total = (formData.area_size && price) ? (parseFloat(formData.area_size) * parseFloat(price)).toFixed(2) : '';
                        setFormData({...formData, price_per_rai: price, total_price: total});
                      }} 
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1 font-semibold">ยอดรวม (บาท)</label>
                    <input type="number" readOnly className="w-full border p-2 rounded-lg bg-gray-100 text-gray-600 font-bold" placeholder="0.00" value={formData.total_price} />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-gray-700 mb-1 font-semibold">สถานะการจ่ายเงิน</label>
                  <select className="w-full border p-2 rounded-lg bg-white font-bold" value={formData.payment_status} onChange={(e) => setFormData({...formData, payment_status: e.target.value})}>
                    <option value="UNPAID">⏳ รอชำระเงิน</option>
                    <option value="DEPOSIT">💳 มัดจำแล้ว</option>
                    <option value="PAID">✅ ชำระเรียบร้อย</option>
                  </select>
                </div>

                <div className="flex gap-3 mt-4">
                  <button type="button" onClick={() => { setShowAddForm(false); setEditingId(null); }} className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg font-bold shadow-md transition">ยกเลิก</button>
                  <button type="submit" className="flex-1 bg-green-600 text-white py-2 rounded-lg font-bold shadow-md">
                    {editingId ? 'บันทึกการแก้ไข' : 'บันทึกคิวงาน'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 👥 Popup จัดการรายชื่อลูกค้า */}
        {showCustomerManager && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[200]">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-gray-800">👥 จัดการรายชื่อลูกค้า</h2>
                <button onClick={() => { setShowCustomerManager(false); setEditingCustomer(null); setNewCustomer({name:'', phone:'', address_note:''}); }} className="text-gray-500 font-bold text-xl">❌</button>
              </div>

              {/* ฟอร์มเพิ่ม/แก้ไขลูกค้า */}
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-200 mb-4 shrink-0">
                <h3 className="font-bold text-blue-800 mb-2 text-sm">{editingCustomer ? '✏️ แก้ไขข้อมูลลูกค้า' : '➕ เพิ่มลูกค้าใหม่'}</h3>
                <input type="text" placeholder="ชื่อลูกค้า" className="w-full border p-2 rounded-lg mb-2 text-sm" value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} />
                <input type="tel" placeholder="เบอร์โทรศัพท์" className="w-full border p-2 rounded-lg mb-2 text-sm" value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} />
                <textarea placeholder="ข้อมูลที่อยู่ / จุดสังเกตบ้าน (ประจำตัวลูกค้า)" rows="2" className="w-full border p-2 rounded-lg mb-2 text-sm" value={newCustomer.address_note} onChange={e => setNewCustomer({...newCustomer, address_note: e.target.value})}></textarea>
                <div className="flex gap-2">
                  {editingCustomer && <button onClick={() => { setEditingCustomer(null); setNewCustomer({name:'', phone:'', address_note:''}); }} className="w-1/3 bg-gray-400 text-white font-bold py-2 rounded-lg text-sm">ยกเลิก</button>}
                  <button onClick={handleSaveCustomer} className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg text-sm">{editingCustomer ? 'บันทึกการแก้ไข' : 'เพิ่มลูกค้า'}</button>
                </div>
              </div>

              {/* รายชื่อลูกค้า */}
              <div className="overflow-y-auto flex-1 space-y-2 pr-1">
                {customersList.map(c => (
                  <div key={c.id} className="bg-gray-50 p-3 rounded-lg border flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-sm text-gray-800">{c.name}</p>
                        <p className="text-xs text-gray-500">📞 {c.phone || 'ไม่มีเบอร์'}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => { setEditingCustomer(c); setNewCustomer({ name: c.name, phone: c.phone || '', address_note: c.address_note || '' }); }} className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-md text-xs font-bold border border-yellow-200">แก้ไข</button>
                        <button onClick={() => handleDeleteCustomer(c.id)} className="bg-red-100 text-red-600 px-3 py-1 rounded-md text-xs font-bold border border-red-200">ลบ</button>
                      </div>
                    </div>
                    {c.address_note && <p className="text-xs text-blue-600 bg-blue-100/50 p-1.5 rounded">🏠 {c.address_note}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ⚙️ Popup จัดการรายชื่อรถเกี่ยว */}
        {showVehicleManager && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[200]">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-gray-800">🚜 จัดการรายชื่อรถ</h2>
                <button onClick={() => setShowVehicleManager(false)} className="text-gray-500 font-bold text-xl">❌</button>
              </div>
              <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                {vehicles.map(v => (
                  <div key={v.id} className="flex justify-between items-center bg-gray-50 p-2 rounded-lg border">
                    <div>
                      <p className="font-bold text-sm text-gray-800">{v.name}</p>
                      {v.driver_name && <p className="text-xs text-gray-500">👨‍🌾 คนขับ: {v.driver_name}</p>}
                    </div>
                    <button onClick={() => handleDeleteVehicle(v.id)} className="bg-red-100 text-red-600 px-2 py-1 rounded-md text-xs font-bold">ลบ</button>
                  </div>
                ))}
              </div>
              <div className="bg-orange-50 p-3 rounded-lg border border-orange-200">
                <h3 className="font-bold text-orange-800 mb-2 text-sm">➕ เพิ่มรถคันใหม่</h3>
                <input type="text" placeholder="ชื่อรถ (เช่น คันที่ 1)" className="w-full border p-2 rounded-lg mb-2 text-sm" value={newVehicle.name} onChange={e => setNewVehicle({...newVehicle, name: e.target.value})} />
                <input type="text" placeholder="ชื่อคนขับ (ถ้ามี)" className="w-full border p-2 rounded-lg mb-2 text-sm" value={newVehicle.driver_name} onChange={e => setNewVehicle({...newVehicle, driver_name: e.target.value})} />
                {/* 👇 เพิ่มช่องกรอกเลข IMEI ของกล่อง GPS 👇 */}
                <input type="text" placeholder="เลข IMEI กล่อง GPS (เช่น 9210197099)" className="w-full border p-2 rounded-lg mb-2 text-sm font-mono" value={newVehicle.imei || ''} onChange={e => setNewVehicle({...newVehicle, imei: e.target.value})} />
                
                <button onClick={handleAddVehicle} className="w-full bg-orange-500 text-white font-bold py-2 rounded-lg text-sm">เพิ่มข้อมูล</button>
              </div>
            </div>
          </div>
        )}

        {/* 🗺️ หน้าจอแผนที่เต็มจอย */}
        {showMapPicker && (
          <div className="fixed inset-0 bg-black z-[200] flex flex-col">
             <LingStyleMap 
                initialCenter={currentCoords} 
                onConfirm={handleMapConfirm} 
                onCancel={() => setShowMapPicker(false)} 
             />
          </div>
        )}

        {/* 👇 จุดที่ 3.4: Popup ยืนยันปิดงานและจดค่าแรงลูกจ้าง (มีปุ่มกดเลือกชื่อด่วน) 👇 */}
        {finishingJob && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[300]">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
              <h2 className="text-xl font-bold mb-4 text-green-700 flex items-center gap-2">
                <span>✅</span> ปิดคิวงาน & จดค่าแรง
              </h2>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 font-semibold mb-1 text-sm">จำนวนไร่ที่ทำจริง</label>
                    <input 
                      type="number" 
                      className="w-full border border-green-300 p-2 rounded-lg bg-green-50 text-green-900 font-bold" 
                      value={wageData.area} 
                      onChange={(e) => setWageData({...wageData, area: e.target.value})} 
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 font-semibold mb-1 text-sm">เรทเหมา (บาท/ไร่)</label>
                    <input 
                      type="number" 
                      className="w-full border border-gray-300 p-2 rounded-lg bg-gray-50 font-bold" 
                      value={wageData.wagePerRai} 
                      onChange={(e) => setWageData({...wageData, wagePerRai: e.target.value})} 
                    />
                  </div>
                </div>

                {/* 🧑‍🌾 กล่องเลือก/พิมพ์ ชื่อลูกจ้าง */}
                <div className="bg-orange-50 p-4 rounded-xl border border-orange-200">
                  <label className="block text-orange-900 font-bold mb-2">🧑‍🌾 ใครลงแปลงนี้บ้าง? (กดเลือกหรือพิมพ์)</label>
                  
                  {/* 👇 ปุ่มกดเลือกด่วน 👇 */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    {/* 💡 อนาคตถ้ามีคนเพิ่ม ก็มาพิมพ์ชื่อใส่ในวงเล็บ [ ] นี้ได้เลยครับ */}
                    {['พี่ยันต์', 'จักร กฤษณ์'].map(name => {
                      const isSelected = wageData.workers.includes(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => {
                            // ระบบจัดการเพิ่ม/ลดชื่ออัตโนมัติเมื่อกดปุ่ม
                            let currentList = wageData.workers.split(',').map(n => n.trim()).filter(n => n);
                            if (isSelected) {
                              currentList = currentList.filter(n => n !== name); // ถ้ามีอยู่แล้วให้เอาออก
                            } else {
                              currentList.push(name); // ถ้ายังไม่มีให้เพิ่มเข้าไป
                            }
                            setWageData({...wageData, workers: currentList.join(', ')});
                          }}
                          className={`px-3 py-1.5 rounded-lg text-sm font-bold border shadow-sm transition ${
                            isSelected 
                              ? 'bg-orange-500 text-white border-orange-600' 
                              : 'bg-white text-orange-700 border-orange-300 hover:bg-orange-100'
                          }`}
                        >
                          {isSelected ? '✅' : '➕'} {name}
                        </button>
                      )
                    })}
                  </div>
                  {/* 👆 จบปุ่มกดเลือกด่วน 👆 */}

                  <input 
                    type="text" 
                    placeholder="พิมพ์ชื่อคนอื่นๆ เพิ่มเติมได้ที่นี่..."
                    className="w-full border border-orange-300 p-2 rounded-lg text-orange-900 font-semibold placeholder-orange-300 focus:ring-2 focus:ring-orange-400 outline-none bg-white" 
                    value={wageData.workers} 
                    onChange={(e) => setWageData({...wageData, workers: e.target.value})} 
                  />
                  <p className="text-xs text-orange-700 mt-2 font-semibold">
                    * ข้อมูลจะถูกจดเข้าสมุดบัญชี เป็นยอดค้างจ่าย (รอเบิก)
                  </p>
                </div>
                
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 flex justify-between items-center shadow-inner">
                   <span className="font-bold text-blue-900">💰 ยอดเข้ากระเป๋าลูกจ้าง:</span>
                   <span className="font-black text-blue-700 text-2xl">
                     {((Number(wageData.area) * Number(wageData.wagePerRai)) || 0).toLocaleString()} <span className="text-sm">บาท</span>
                   </span>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button onClick={() => setFinishingJob(null)} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-2.5 rounded-xl font-bold transition">ยกเลิก</button>
                <button 
                  onClick={() => {
                    if(!wageData.workers.trim()) return alert("กรุณาพิมพ์ชื่อคนลงแปลงด้วยครับ (จดไว้กันลืม)");
                    updateStatus(finishingJob.id, 'DONE', wageData);
                    setFinishingJob(null);
                  }} 
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl font-bold shadow-lg transition"
                >
                  บันทึก & ปิดงาน
                </button>
              </div>
            </div>
          </div>
        )}
        {/* 👆 จบ Popup ปิดงานและจดค่าแรง 👆 */}

        {/* 💰 Popup สมุดจดค่าแรงลูกจ้าง (อัปเกรดมีแท็บประวัติ) */}
        {showWageSummary && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[200]">
            <div className="bg-white rounded-2xl p-5 w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">
              <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span>💰</span> สมุดจดค่าแรง
                </h2>
                <button onClick={() => setShowWageSummary(false)} className="text-gray-400 hover:text-red-500 bg-gray-100 hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center font-bold text-lg transition">✕</button>
              </div>
              
              {/* 👇 ปุ่มสลับแท็บ รอเบิก / จ่ายแล้ว 👇 */}
              <div className="flex gap-2 mb-3 bg-gray-100 p-1 rounded-lg shrink-0">
                <button onClick={() => setWageTab('UNPAID')} className={`flex-1 py-2 text-sm font-bold rounded-md transition ${wageTab === 'UNPAID' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  รอเบิก
                </button>
                <button onClick={() => setWageTab('PAID')} className={`flex-1 py-2 text-sm font-bold rounded-md transition ${wageTab === 'PAID' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  ประวัติที่จ่ายแล้ว
                </button>
              </div>

              {/* รายการยอดเงิน */}
              <div className="overflow-y-auto flex-1 space-y-3 pr-1">
                {wageTransactions.filter(t => t.status === wageTab).length === 0 && (
                  <div className="text-center text-gray-500 py-10 flex flex-col items-center">
                    <span className="text-4xl mb-2">{wageTab === 'UNPAID' ? '🎉' : '🍃'}</span>
                    <p className="font-bold">{wageTab === 'UNPAID' ? 'เคลียร์ยอดครบแล้ว!' : 'ยังไม่มีประวัติการจ่ายเงิน'}</p>
                    <p className="text-sm">{wageTab === 'UNPAID' ? 'ไม่มีรายการค้างจ่าย' : ''}</p>
                  </div>
                )}
                
                {wageTransactions.filter(t => t.status === wageTab).map(tx => {
                  let workersStr = tx.note || '';
                  let detailsStr = '';
                  
                  if (workersStr.includes('คนทำ:') && workersStr.includes('(')) {
                      const parts = workersStr.split('(');
                      workersStr = parts[0].replace('คนทำ:', '').trim();
                      detailsStr = parts[1].replace(')', '').trim();
                  }
                  
                  const workerArray = workersStr.split(',').map(w => w.trim()).filter(w => w);

                  return (
                    <div key={tx.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm relative">
                       <div className="flex justify-between items-start mb-3">
                         <div className="flex-1 pr-2">
                           <div className="flex flex-wrap gap-1.5 mb-2">
                             {workerArray.length > 0 ? workerArray.map((w, idx) => (
                               <span key={idx} className="bg-orange-100 text-orange-800 text-xs font-bold px-2 py-1 rounded-md border border-orange-200 shadow-sm">
                                 🧑‍🌾 {w}
                               </span>
                             )) : (
                               <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-1 rounded-md border">ไม่ระบุชื่อ</span>
                             )}
                           </div>
                           
                           <p className="text-sm text-gray-700 font-semibold mb-1">
                             {detailsStr ? `📐 ${detailsStr}` : ''}
                           </p>
                           
                           <p className="text-[11px] text-gray-500 mt-1">
                             {wageTab === 'PAID' ? (
                               <span className="text-green-700 font-bold">
                                 ✅ จ่ายเมื่อ: {tx.paid_at ? new Date(tx.paid_at).toLocaleString('th-TH') : new Date(tx.created_at).toLocaleString('th-TH')}
                               </span>
                             ) : (
                               <span>
                                 📅 ลงสมุด: {new Date(tx.created_at).toLocaleString('th-TH')}
                               </span>
                             )}
                           </p>
                         </div>

                         <div className="text-right shrink-0">
                           <span className={`block font-black text-2xl leading-none mb-1 ${wageTab === 'UNPAID' ? 'text-red-600' : 'text-green-600'}`}>
                             {Number(tx.total_amount).toLocaleString()} <span className="text-sm">฿</span>
                           </span>
                           {workerArray.length > 1 && (
                             <span className="inline-block text-[10px] text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full font-bold">
                               หาร {workerArray.length} คน
                             </span>
                           )}
                         </div>
                       </div>

                       {/* ปุ่มกดจ่ายเงิน */}
                       {wageTab === 'UNPAID' ? (
                         <button 
                           onClick={async () => {
                             if(!window.confirm('ยืนยันว่าจ่ายยอดนี้ให้ลูกจ้างแล้วใช่ไหม?')) return;
                             try {
                               // 💡 ดึงเวลาปัจจุบัน (เวลาไทย) ตอนกดปุ่ม
                               const now = new Date();
                               now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                               const paid_at = now.toISOString();

                               await fetch(`https://harvester-api-server.onrender.com/api/transactions/${tx.id}/status`, {
                                 method: 'PATCH',
                                 headers: { 'Content-Type': 'application/json' },
                                 body: JSON.stringify({ status: 'PAID', paid_at }) // 👈 ส่งเวลาแนบไปหลังบ้านด้วย
                               });
                               fetchWages(); 
                             } catch(e) { console.error(e); }
                           }}
                           className="w-full bg-gray-50 hover:bg-green-50 text-gray-600 hover:text-green-700 border border-gray-200 hover:border-green-300 font-bold py-2 rounded-lg text-sm transition flex items-center justify-center gap-2"
                         >
                           ✅ จ่ายเงินยอดนี้แล้ว
                         </button>
                       ) : (
                         <div className="w-full bg-green-50 text-green-700 border border-green-200 font-bold py-2 rounded-lg text-sm flex items-center justify-center gap-2">
                           ✅ โอนจ่ายเรียบร้อยแล้ว
                         </div>
                       )}
                    </div>
                  )
                })}
              </div>
              
              {/* ยอดรวมทั้งหมด (แยกตามสถานะ) */}
              <div className="mt-4 pt-4 border-t border-gray-200 shrink-0">
                <div className={`p-4 rounded-xl flex justify-between items-center shadow-inner ${wageTab === 'UNPAID' ? 'bg-gradient-to-r from-red-50 to-orange-50 border border-red-200' : 'bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200'}`}>
                  <div>
                    <span className={`block font-bold text-sm ${wageTab === 'UNPAID' ? 'text-red-900' : 'text-green-900'}`}>
                      {wageTab === 'UNPAID' ? 'ยอดรวมที่ต้องเตรียมจ่าย:' : 'ยอดรวมที่จ่ายไปแล้ว:'}
                    </span>
                    <span className={`text-xs ${wageTab === 'UNPAID' ? 'text-red-700' : 'text-green-700'}`}>*รวมงานทั้งแบบเดี่ยวและคู่</span>
                  </div>
                  <span className={`font-black text-3xl drop-shadow-sm ${wageTab === 'UNPAID' ? 'text-red-600' : 'text-green-600'}`}>
                    {wageTransactions.filter(t => t.status === wageTab).reduce((sum, tx) => sum + Number(tx.total_amount), 0).toLocaleString()} <span className="text-lg">฿</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 🔍 Popup แสดงรูปภาพแบบเต็มจอ (รองรับการปัด Swipe) */}
        {fullScreenIndex !== null && jobAttachments[fullScreenIndex] && (
          <div 
            className="fixed inset-0 bg-black/95 z-[500] flex items-center justify-center p-2 backdrop-blur-sm select-none" 
            onClick={() => setFullScreenIndex(null)}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* ตัวเลขบอกลำดับรูป (เช่น 1 / 3) */}
            <div className="absolute top-6 left-6 text-white font-bold bg-black/50 px-3 py-1 rounded-lg z-[510]">
              {fullScreenIndex + 1} / {jobAttachments.length}
            </div>

            {/* ปุ่มปิด (X) */}
            <button 
              className="absolute top-6 right-6 text-white text-2xl font-bold bg-white/20 hover:bg-red-500 w-10 h-10 flex items-center justify-center rounded-full transition shadow-lg z-[510]"
              onClick={(e) => { e.stopPropagation(); setFullScreenIndex(null); }}
            >
              ✕
            </button>
            
            {/* ปุ่มย้อนกลับ (โชว์เฉพาะถ้ามีหลายรูป) */}
            {jobAttachments.length > 1 && (
              <button 
                className="absolute left-4 text-white text-3xl font-bold bg-black/40 hover:bg-black/70 w-12 h-12 flex items-center justify-center rounded-full transition shadow-lg z-[510]"
                onClick={(e) => { e.stopPropagation(); setFullScreenIndex((prev) => (prev - 1 + jobAttachments.length) % jobAttachments.length); }}
              >
                ◀
              </button>
            )}

            <img 
              src={jobAttachments[fullScreenIndex].image_url} 
              alt="full-screen" 
              className="max-w-full max-h-[90vh] object-contain rounded-lg drop-shadow-2xl transition-transform duration-300" 
              onClick={(e) => e.stopPropagation()} 
            />

            {/* ปุ่มถัดไป (โชว์เฉพาะถ้ามีหลายรูป) */}
            {jobAttachments.length > 1 && (
              <button 
                className="absolute right-4 text-white text-3xl font-bold bg-black/40 hover:bg-black/70 w-12 h-12 flex items-center justify-center rounded-full transition shadow-lg z-[510]"
                onClick={(e) => { e.stopPropagation(); setFullScreenIndex((prev) => (prev + 1) % jobAttachments.length); }}
              >
                ▶
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

export default App