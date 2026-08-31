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
  const markerLayer = useRef(null); // 💡 ตัวแปรสำหรับจำรูปรถเกี่ยว (กันรูปซ้อนทับ)

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

    // 💡 สั่งให้แผนที่รีเฟรชขนาดตัวเองใหม่ (แก้บั๊กแผนที่โผล่ครึ่งจอ)
    setTimeout(() => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize();
      }
    }, 200);

    // 💡 ล้างเส้นทางเก่า และ "รถคันเก่า" ออกจากแผนที่ก่อนวาดรอบใหม่
    if (polylineLayer.current) mapInstance.current.removeLayer(polylineLayer.current);
    if (markerLayer.current) mapInstance.current.removeLayer(markerLayer.current);
    
    if (pathData.length > 0) {
      // 💡 วาดเส้นทางใหม่ (ลากทุกจุดต่อกันแบบ 100% เพื่อให้เห็นรอยเกี่ยวข้าวทุกซอกมุม)
      const latlngs = pathData.map(p => [p.latitude, p.longitude]);
      polylineLayer.current = L.polyline(latlngs, { 
        color: '#2563EB', // สีน้ำเงิน
        weight: 4, 
        opacity: 0.8 
      }).addTo(mapInstance.current);
      
      // ปักหมุดจุดล่าสุด (รูปรถเกี่ยว 🚜)
      const lastPoint = pathData[pathData.length - 1];
      const carIcon = L.divIcon({
        className: 'bg-transparent border-0',
        html: `<div class="bg-orange-500 hover:bg-orange-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-lg border-2 border-white shadow-lg drop-shadow-md cursor-pointer transition transform hover:scale-110" style="margin-left: -16px; margin-top: -16px;">🚜</div>`,
        iconSize: [0, 0]
      });
      
      // เก็บรูปรถเกี่ยวที่เพิ่งวาดไว้ใน markerLayer เพื่อให้ลบได้ทันในรอบถัดไป
      markerLayer.current = L.marker([lastPoint.latitude, lastPoint.longitude], { icon: carIcon }).addTo(mapInstance.current);
      
      // เพิ่มอีเวนต์ให้กดที่ตัวรถแล้วเด้งไป Google Maps
      markerLayer.current.bindTooltip("คลิกเพื่อเปิด Google Maps นำทางไปหารถ", { direction: 'top', offset: [0, -10] });
      markerLayer.current.on('click', () => {
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
  const [activeTab, setActiveTab] = useState('home')
  const [financeSubTab, setFinanceSubTab] = useState('dashboard'); // 👈 เพิ่ม State สำหรับคุมเมนูย่อยในหน้าบัญชี
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [customersList, setCustomersList] = useState([])
  const [weatherData, setWeatherData] = useState(null);
  const [weatherLocationName, setWeatherLocationName] = useState('กำลังค้นหาพิกัด...');

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
  const [wageFilter, setWageFilter] = useState([]);

  // 📊 State สำหรับ Dashboard
  const [dashboardData, setDashboardData] = useState({ totalIncome: 0, totalUnpaid: 0, totalExpense: 0, netProfit: 0, totalArea: 0 });
  const [dashMonth, setDashMonth] = useState(new Date().getMonth() + 1);
  const [dashYear, setDashYear] = useState(new Date().getFullYear());
  const [isFetchingDash, setIsFetchingDash] = useState(false);
  const [radarOverride, setRadarOverride] = useState(null); 
  
  // 🔐 State สำหรับระบบ 2 ร่าง (ดึงค่าความจำจากเครื่องก่อน ถ้าไม่มีค่อยเป็น DRIVER)
  const [userRole, setUserRole] = useState(() => {
    return localStorage.getItem('harvester_role') || 'DRIVER';
  });
  const [currentDriverName, setCurrentDriverName] = useState(''); // เก็บชื่อคนขับเพื่อให้ดึงค่าแรงถูกคน

  // 👇 เพิ่ม State ดึงพิกัดอัตโนมัติตอนเปิดเว็บ 👇
  const [autoUserLocation, setAutoUserLocation] = useState(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setAutoUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => console.log('ยังไม่ได้อนุญาต GPS อัตโนมัติ')
      );
    }
  }, []);

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

  // 👇 วางต่อท้าย isFetchingGps 👇
  // 💸 State สำหรับจัดการค่าใช้จ่ายจิปาถะ
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  // เปลี่ยน expenseData ให้รองรับ id และรูปเดิม
  const [expenseData, setExpenseData] = useState({
    id: null, // 👈 เพิ่ม id เพื่อให้รู้ว่ากำลังแก้ไข
    category: 'น้ำมัน', total_amount: '', transaction_date: new Date().toISOString().slice(0, 16),
    vehicle_id: '', job_id: '', spender_name: '', note: '', receipt: null,
    existing_receipt_url: null // 👈 เก็บลิงก์รูปเก่า
  });

  const handleExpenseSubmit = async (e) => {
    e.preventDefault();
    
    if (!expenseData.total_amount || Number(expenseData.total_amount) <= 0) {
      return alert("❌ กรุณาระบุจำนวนเงินให้ถูกต้องครับ");
    }

    const formData = new FormData();
    formData.append('category', expenseData.category);
    formData.append('total_amount', expenseData.total_amount);
    
    const d = new Date(expenseData.transaction_date);
    formData.append('transaction_date', d.toISOString());
    
    if(expenseData.vehicle_id) formData.append('vehicle_id', expenseData.vehicle_id);
    if(expenseData.spender_name) formData.append('spender_name', expenseData.spender_name);
    if(expenseData.note) formData.append('note', expenseData.note);
    if(expenseData.receipt) formData.append('receipt', expenseData.receipt);
    // ส่งลิงก์รูปเดิมไปด้วย ถ้าไม่ได้แนบรูปใหม่
    if(expenseData.existing_receipt_url && !expenseData.receipt) formData.append('existing_receipt_url', expenseData.existing_receipt_url);

    // 👇 เช็คว่าเป็นการเพิ่มใหม่ (POST) หรือ แก้ไข (PUT)
    const isEditing = !!expenseData.id;
    const url = isEditing 
      ? `https://harvester-api-server.onrender.com/api/transactions/expenses/${expenseData.id}` 
      : 'https://harvester-api-server.onrender.com/api/transactions/expenses';

    try {
      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        body: formData 
      });
      
      if (res.ok) {
        alert(isEditing ? '✅ แก้ไขค่าใช้จ่ายเรียบร้อย!' : '✅ บันทึกค่าใช้จ่ายเรียบร้อย!');
        setShowExpenseForm(false);
        setExpenseData({
          id: null, category: 'น้ำมัน', total_amount: '', transaction_date: new Date().toISOString().slice(0, 16),
          vehicle_id: '', job_id: '', spender_name: '', note: '', receipt: null, existing_receipt_url: null
        });
        fetchDashboard(); 
        fetchExpenses();  
      } else {
        const errData = await res.json();
        alert(`❌ บันทึกไม่สำเร็จ:\n${errData.error || errData.message}`);
      }
    } catch (err) { 
      console.error(err); 
      alert('❌ เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  // 👇 เพิ่มฟังก์ชันสำหรับกดปุ่ม "แก้ไข"
  const handleEditExpense = (tx) => {
    let dateStr = new Date().toISOString().slice(0, 16);
    if (tx.transaction_date || tx.created_at) {
        const d = new Date(tx.transaction_date || tx.created_at);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        dateStr = d.toISOString().slice(0, 16);
    }

    setExpenseData({
        id: tx.id,
        category: tx.category || 'น้ำมัน',
        total_amount: tx.total_amount,
        transaction_date: dateStr,
        vehicle_id: tx.vehicle_id || '',
        spender_name: tx.spender_name || '',
        note: tx.note || '',
        receipt: null,
        existing_receipt_url: tx.receipt_url || null
    });
    setShowExpenseForm(true);
  };
  
  // 👇 ฟังก์ชันสำหรับลบรายจ่าย/ค่าแรง 👇
  const handleDeleteExpense = async (id) => {
    if (!window.confirm('⚠️ แน่ใจหรือไม่ว่าต้องการ "ลบทิ้ง" ?\n(ยอดเงินจะถูกดึงกลับคืนอัตโนมัติ)')) return;
    try {
      const res = await fetch(`https://harvester-api-server.onrender.com/api/transactions/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert('🗑️ ลบรายการเรียบร้อย');
        fetchExpenses();  // รีเฟรชหน้ารายจ่าย
        fetchDashboard(); // รีเฟรชยอดรวมหน้า Dashboard
      } else {
        alert('❌ ลบไม่สำเร็จ');
      }
    } catch (err) {
      console.error(err);
      alert('❌ เกิดข้อผิดพลาดในการเชื่อมต่อ');
    }
  };

// 🔄 ระบบ Auto-Refresh ดึงพิกัด GPS อัตโนมัติ (ทุกๆ 10 วินาที)
  useEffect(() => {
    let intervalId;

    // ระบบจะทำงานก็ต่อเมื่อ: เปิดหน้า GPS อยู่ + เลือกโหมดทำงานปัจจุบัน + เลือกรถแล้ว
    if (activeTab === 'gps' && trackingMode === 'realtime' && trackingVehicleId) {
      
      intervalId = setInterval(async () => {
        try {
          // คำนวณวันที่ของวันนี้ส่งไปด้วย (แก้บั๊ก Timezone)
          const now = new Date();
          now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
          const dateToSend = now.toISOString().slice(0, 10);
          
          // แอบไปดึงข้อมูลเงียบๆ หลังบ้าน
          const res = await fetch(`https://harvester-api-server.onrender.com/api/gps/${trackingVehicleId}?date=${dateToSend}`);
          const data = await res.json();
          
          // อัปเดตเส้นทางบนแผนที่
          if (data && data.length > 0) {
            setGpsPathData(data);
          }
        } catch (e) {
          console.error("ระบบดึง GPS อัตโนมัติขัดข้อง:", e);
        }
      }, 10000); // 10000 มิลลิวินาที = 10 วินาที
      
    }

    // ล้างความจำ (หยุดนาฬิกาปลุก) เวลาสลับไปแท็บอื่น จะได้ไม่กินแบตมือถือ
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeTab, trackingMode, trackingVehicleId]);


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

  // 👇 เพิ่ม State และฟังก์ชันดึงประวัติรายจ่าย 👇
  const [expenseTransactions, setExpenseTransactions] = useState([]);
  const fetchExpenses = async () => {
    try {
      const res = await fetch('https://harvester-api-server.onrender.com/api/transactions/expenses');
      const data = await res.json();
      setExpenseTransactions(data || []);
    } catch (err) { console.error("ดึงข้อมูลรายจ่ายไม่ได้:", err); }
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
    if (activeTab === 'finance' && financeSubTab === 'dashboard') {
      fetchDashboard();
      fetchExpenses();
      fetchWages();
    }
  }, [activeTab, financeSubTab, dashMonth, dashYear]);

  useEffect(() => { 
    document.documentElement.lang = 'th'; 
    fetchJobs();
    fetchVehicles(); 
    fetchAllCustomers(); // ดึงลูกค้ามาเตรียมไว้
  }, []);

  // ==========================================
  // 👇 วาง "ระบบสภาพอากาศ + สมองคำนวณหน้าแรก" ตรงนี้ 👇
  // ==========================================

  const getThaiWeatherText = (code) => {
    if (code <= 3) return { text: "ปลอดโปร่ง ☀️", desc: "ลุยเกี่ยวได้ยาวๆ ไม่ต้องกังวล", color: "text-gray-700", bg: "bg-gray-100", border: "border-gray-200" };
    if (code >= 51 && code <= 61) return { text: "มีเมฆมาก ☁️", desc: "ฟ้าครึ้ม แดดร่ม ให้ประเมินดินหน้าแปลง", color: "text-emerald-700", bg: "bg-emerald-100", border: "border-emerald-300" };
    if ((code >= 63 && code <= 67) || (code >= 80 && code <= 81)) return { text: "ฝนตกหนัก 🌧️", desc: "ต้องหยุดเกี่ยว", color: "text-orange-700", bg: "bg-orange-100", border: "border-orange-300" };
    if (code >= 82 && code <= 99) return { text: "พายุเข้า ⛈️", desc: "อันตรายพายุเข้า!", color: "text-red-700", bg: "bg-red-100", border: "border-red-300" };
    return { text: "รอข้อมูล ☀️", desc: "กำลังประเมินสภาพอากาศ...", color: "text-gray-700", bg: "bg-gray-100", border: "border-gray-200" };
  };

  useEffect(() => {
    if (activeTab !== 'home') return;
    
    let lat = 15.7012; let lon = 101.1012; 
    if (radarOverride) { 
      lat = Number(radarOverride.lat); lon = Number(radarOverride.lon); 
    } else if (jobs.find(j => j.status === 'IN_PROGRESS')?.latitude) {
      const act = jobs.find(j => j.status === 'IN_PROGRESS');
      lat = Number(act.latitude); lon = Number(act.longitude);
    } else if (gpsPathData.length > 0) {
      lat = Number(gpsPathData[gpsPathData.length - 1].latitude); 
      lon = Number(gpsPathData[gpsPathData.length - 1].longitude);
    } else if (autoUserLocation) {
      lat = Number(autoUserLocation.lat); lon = Number(autoUserLocation.lon); 
    }

    if (isNaN(lat) || isNaN(lon) || lat === 0) {
      lat = 15.7012; lon = 101.1012;
    }

    // 1. ดึงข้อมูลสภาพอากาศ
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code&hourly=weather_code&timezone=Asia/Bangkok&forecast_days=2`)
      .then(res => res.json())
      .then(data => setWeatherData(data))
      .catch(err => console.error(err));
      
    // 2. ดึงข้อมูล ตำบล/อำเภอ/จังหวัด (Reverse Geocoding) 
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`)
      .then(res => res.json())
      .then(data => {
        if (data && data.address) {
          // ดึงข้อมูลแต่ละระดับชั้นมาเตรียมไว้
          const subdistrict = data.address.suburb || data.address.village || data.address.quarter || data.address.hamlet || '';
          const district = data.address.county || data.address.city_district || data.address.city || data.address.town || '';
          const province = data.address.state || data.address.province || '';
          
          let locStr = '';
          
          // 1. จัดการ ตำบล (ลบคำว่า Tambon หรือ ตำบล ออกถ้ามีติดมา)
          if (subdistrict) {
            let sd = subdistrict.replace(/Tambon /ig, '').replace(/ตำบล/g, '').trim();
            locStr += `${sd} `;
          }
          
          // 2. จัดการ อำเภอ (ลบคำว่า Amphoe หรือ อำเภอ ออกถ้ามีติดมา)
          if (district) {
            let d = district.replace(/Amphoe /ig, '').replace(/อำเภอ/g, '').trim();
            locStr += `${d} `;
          }
          
          // 3. จัดการ จังหวัด (ไม่ต้องใส่ จ. เพราะ API มักส่งคำว่า "จังหวัด" มาให้อยู่แล้ว)
          if (province) {
            locStr += `${province.replace(/Province /ig, '').trim()}`; 
          }
          
          setWeatherLocationName(locStr.trim() || 'ไม่พบพิกัดที่อยู่');
        }
      })
      .catch(err => setWeatherLocationName('ดึงข้อมูลที่อยู่ไม่สำเร็จ'));

  }, [activeTab, radarOverride, jobs, gpsPathData, autoUserLocation]);

  const todayStr = new Date().toDateString();
  // 💡 ดึงงานของวันนี้ "หรือ" งานที่กำลังเกี่ยวอยู่ (ค้างจากวันอื่น) มาโชว์ด้วย
  const todayJobs = jobs.filter(j => 
    new Date(j.job_date).toDateString() === todayStr || j.status === 'IN_PROGRESS'
  );
  
  // 👇 แยกคำนวณพื้นที่งานใหม่ของวันนี้ และ งานเก่าที่ค้างมาจากวันอื่น
  const todayOnlyArea = todayJobs.filter(j => new Date(j.job_date).toDateString() === todayStr).reduce((sum, j) => sum + (Number(j.area_size) || 0), 0);
  const oldJobsArea = todayJobs.filter(j => new Date(j.job_date).toDateString() !== todayStr).reduce((sum, j) => sum + (Number(j.area_size) || 0), 0);
  
  const todayArea = todayJobs.reduce((sum, j) => sum + (Number(j.area_size) || 0), 0);
  const todayIncome = todayJobs.reduce((sum, j) => sum + (Number(j.total_price) || 0), 0);
  
  // 👇 คำนวณหางานผิดนัด (ละเว้นงานที่ "กำลังเกี่ยว" และ "เสร็จสิ้น" แล้ว)
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const overdueJobs = jobs.filter(j => 
    j.status !== 'DONE' && 
    j.status !== 'IN_PROGRESS' && 
    new Date(j.job_date) < todayStart
  );
  
  const debtorsList = jobs.filter(j => j.status === 'DONE' && j.payment_status !== 'PAID');
  const totalDebtValue = debtorsList.reduce((sum, j) => sum + (Number(j.total_price) || 0), 0);
  
  // 💡 ค้นหางานที่กำลังเกี่ยวทั้งหมด แล้วเรียงลำดับเวลา เพื่อดึง "งานที่กดเริ่มล่าสุด" มาแสดง
  const activeJobNow = jobs.filter(j => j.status === 'IN_PROGRESS')
                           .sort((a, b) => new Date(b.job_date) - new Date(a.job_date))[0];
  const mainVehicle = vehicles.length > 0 ? vehicles[0] : null;
  
  let radarLocationName = "(รอพิกัด...)";
  if (radarOverride) {
    radarLocationName = "ตำแหน่งที่กดเลือก 🎯";
  } else if (activeJobNow && activeJobNow.latitude) {
    radarLocationName = `แปลง: ${activeJobNow.customers?.name || 'ไม่ระบุชื่อ'}`;
  } else if (gpsPathData.length > 0) {
    radarLocationName = "พิกัดรถล่าสุด";
  } else if (autoUserLocation) {
    radarLocationName = "ตำแหน่งปัจจุบันของคุณ 📍";
  }
  // ==========================================
  // 👆 จบสมองคำนวณทั้งหมด 👆
  // ==========================================

  // (ฟังก์ชัน handle ต่างๆ เช่น handleAddVehicle...)

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
      
      // 💡 อัปเกรด: ปรับเวลาให้เป็นปัจจุบัน (Local Time) ทันทีที่กด "เริ่มเกี่ยว" หรือ "เสร็จสิ้น"
      if (newStatus === 'DONE' || newStatus === 'IN_PROGRESS') {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); 
        payload.job_date = now.toISOString().slice(0, 16); 
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
        {/* 🐘 Header ช้างขาวเจริญทรัพย์ (พร้อมทางลับเถ้าแก่) */}
        <div className="bg-gradient-to-r from-emerald-800 via-green-700 to-teal-900 py-3.5 px-4 rounded-2xl shadow-lg mb-3 text-center relative overflow-hidden">
          
          {/* 👇 ทางลับเถ้าแก่ (ปุ่มกุญแจมุมขวาบน - อัปเกรดจำสถานะ) 👇 */}
          <div 
            className="absolute top-3 right-3 z-50 bg-black/20 hover:bg-black/40 backdrop-blur-sm p-1.5 rounded-full cursor-pointer transition text-xs border border-white/10"
            onClick={() => {
              if (userRole === 'DRIVER') {
                const pin = window.prompt("🧑‍💼 โหมดเถ้าแก่\nกรุณาใส่รหัสผ่าน (PIN):");
                if (pin === '2518') { 
                  setUserRole('BOSS');
                  localStorage.setItem('harvester_role', 'BOSS'); // 💾 สั่งจำลงเครื่อง
                  alert("✅ เข้าสู่โหมดเถ้าแก่เรียบร้อย");
                } else if (pin) {
                  alert("❌ รหัสผ่านไม่ถูกต้อง");
                }
              } else {
                if (window.confirm("ต้องการออกจากโหมดเถ้าแก่ กลับไปเป็นโหมดคนขับ ใช่หรือไม่?")) {
                  setUserRole('DRIVER');
                  localStorage.setItem('harvester_role', 'DRIVER'); // 💾 ล้างความจำกลับเป็นคนขับ
                }
              }
            }}
          >
            {userRole === 'BOSS' ? '🔓' : '🔒'}
          </div>

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

          <button onClick={() => setActiveTab('home')} className={`min-w-[60px] flex-1 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs transition-all duration-200 ${activeTab === 'home' ? 'bg-gradient-to-r from-gray-800 to-black text-white shadow-md scale-[1.02]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>🏠 หน้าแรก</button>

          <button onClick={() => setActiveTab('active')} className={`min-w-[60px] flex-1 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs transition-all duration-200 ${activeTab === 'active' ? 'bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-md shadow-green-200 scale-[1.02]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>🚜 คิวงาน</button>
          
          <button onClick={() => setActiveTab('calendar')} className={`min-w-[60px] flex-1 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs transition-all duration-200 ${activeTab === 'calendar' ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-orange-200 scale-[1.02]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>📅 ปฏิทิน</button>
          
          <button onClick={() => setActiveTab('gps')} className={`min-w-[60px] flex-1 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs transition-all duration-200 ${activeTab === 'gps' ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-200 scale-[1.02]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>🛰️ พิกัด</button>
          
          {/* 👇 ซ่อนปุ่ม บัญชี และ ตั้งค่า ถ้าเป็นคนขับรถ 👇 */}
          {userRole === 'BOSS' && (
            <>
              <button onClick={() => { setActiveTab('finance'); fetchDashboard(); }} className={`min-w-[60px] flex-1 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs transition-all duration-200 ${activeTab === 'finance' ? 'bg-gradient-to-r from-purple-500 to-fuchsia-600 text-white shadow-md shadow-purple-200 scale-[1.02]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>💰 บัญชี</button>
              
              <button onClick={() => { setActiveTab('settings'); fetchAllCustomers(); }} className={`min-w-[60px] flex-1 py-2.5 rounded-xl font-bold text-[11px] sm:text-xs transition-all duration-200 ${activeTab === 'settings' ? 'bg-gradient-to-r from-slate-600 to-slate-700 text-white shadow-md shadow-slate-200 scale-[1.02]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>⚙️ ตั้งค่า</button>
            </>
          )}
        </div>

        {/* 👇 แถบสมุดจดค่าแรง (สำหรับคนขับ - แบบการ์ดกดได้เลย) 👇 */}
        {userRole === 'DRIVER' && (
          <div 
            onClick={() => {
              setWageFilter([]); 
              setShowWageSummary(true);
              fetchWages(); 
            }}
            className="bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white p-4 rounded-2xl mb-5 shadow-md cursor-pointer transition flex items-center justify-between group relative overflow-hidden"
          >
            <div className="absolute -right-2 -bottom-2 text-6xl opacity-10 drop-shadow-md pointer-events-none group-hover:scale-110 transition-transform duration-300">💰</div>
            
            <div className="flex items-center gap-3 relative z-10">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-2xl shadow-inner backdrop-blur-sm">
                💰
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="bg-white text-teal-800 text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm tracking-wide">ทีมงาน</span>
                </div>
                <h3 className="font-black text-base tracking-wide leading-tight">สมุดจดค่าแรง</h3>
                <p className="text-[11px] text-emerald-100 font-semibold mt-0.5">กดเพื่อดูยอดค่าแรงและเงินส่วนแบ่งทั้งหมด</p>
              </div>
            </div>
            
            <div className="text-xl font-bold bg-white/10 w-9 h-9 rounded-full flex items-center justify-center group-hover:translate-x-1 transition relative z-10">
              ▶
            </div>
          </div>
        )}

        {/* 📑 เมนูย่อยสำหรับแท็บบัญชี (ซ่อนจากคนขับ โชว์เฉพาะเถ้าแก่) */}
        {activeTab === 'finance' && userRole === 'BOSS' && (
          <div className="flex bg-gray-200 rounded-xl p-1 mb-5 gap-1 shadow-inner overflow-x-auto">
             <button onClick={() => { setFinanceSubTab('dashboard'); fetchDashboard(); }} className={`min-w-[65px] flex-1 py-2 rounded-lg font-bold text-xs transition ${financeSubTab === 'dashboard' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>📊 สรุปยอด</button>
             <button onClick={() => setFinanceSubTab('debt')} className={`min-w-[65px] flex-1 py-2 rounded-lg font-bold text-xs transition ${financeSubTab === 'debt' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>💸 ลูกหนี้</button>
             <button onClick={() => setFinanceSubTab('income')} className={`min-w-[65px] flex-1 py-2 rounded-lg font-bold text-xs transition ${financeSubTab === 'income' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>💵 รับเงิน</button>
             <button onClick={() => { setFinanceSubTab('expense'); fetchExpenses(); }} className={`min-w-[65px] flex-1 py-2 rounded-lg font-bold text-xs transition ${financeSubTab === 'expense' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>📉 รายจ่าย</button>
             <button onClick={() => setFinanceSubTab('history')} className={`min-w-[65px] flex-1 py-2 rounded-lg font-bold text-xs transition ${financeSubTab === 'history' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>📋 ประวัติ</button>
          </div>
        )}

        {/* 🏠 หน้าจอ Dashboard ใหญ่ (หน้าแรก) */}
        {activeTab === 'home' && (
          <div className="space-y-4">
            
            {/* 1. สรุปภาพรวมวันนี้ */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col items-center justify-center text-center">
                <span className="text-gray-500 text-xs font-bold mb-1">🚜 งานวันนี้</span>
                <span className="text-2xl font-black text-gray-800">{todayJobs.length} <span className="text-sm font-normal">งาน</span></span>
              </div>
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col items-center justify-center text-center">
                <span className="text-gray-500 text-xs font-bold mb-2">🌾 พื้นที่รวมวันนี้</span>
                <div className="flex flex-col items-center">
                  <span className="text-2xl font-black text-emerald-600 leading-none">
                    {todayOnlyArea} <span className="text-sm font-normal">ไร่</span>
                  </span>
                  
                  {/* 👇 ปรับป้ายงานเก่าให้ใหญ่ สีชัดขึ้น และเพิ่มไอคอน 👇 */}
                  {oldJobsArea > 0 && (
                    <span className="mt-2.5 text-[11px] sm:text-xs font-black text-red-700 bg-red-100 px-3 py-1.5 rounded-lg border border-red-300 shadow-sm flex items-center gap-1">
                      ⚠️ + งานค้าง {oldJobsArea} ไร่
                    </span>
                  )}
                </div>
              </div>
              
              {/* 👇 ซ่อนกล่องรายได้ (ให้เถ้าแก่เห็นคนเดียว) 👇 */}
              {userRole === 'BOSS' && (
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col items-center justify-center text-center">
                  <span className="text-gray-500 text-xs font-bold mb-1">💰 คาดการณ์รายได้</span>
                  <span className="text-2xl font-black text-blue-600">{todayIncome.toLocaleString()} <span className="text-sm font-normal">฿</span></span>
                </div>
              )}
              
              {/* 👇 กล่องลูกหนี้ (โชว์ทุกคน แต่ถ้าเป็นคนขับจะขยายเต็มบรรทัดให้สวยงาม) 👇 */}
              <div 
                onClick={() => { setActiveTab('finance'); setFinanceSubTab('debt'); }}
                className={`bg-red-50 p-4 rounded-xl shadow-sm border border-red-200 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-red-100 transition ${userRole === 'BOSS' ? '' : 'col-span-2'}`}
              >
                <span className="text-red-800 text-xs font-bold mb-1">💸 ลูกหนี้ (กดเพื่อดู)</span>
                <span className="text-2xl font-black text-red-600">{totalDebtValue.toLocaleString()} <span className="text-sm font-normal">฿</span></span>
              </div>
            </div>

            {/* 2. สถานะรถเกี่ยว */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gray-800 px-4 py-2.5 flex justify-between items-center">
                <h3 className="font-bold text-white text-sm">🚜 สถานะรถเกี่ยว</h3>
                <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> GPS Online
                </span>
              </div>
              <div className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-black text-lg text-gray-900">{mainVehicle ? mainVehicle.name : 'รถเกี่ยว 1'}</h4>
                    <p className="text-xs text-gray-500 font-semibold mt-0.5">👨‍🌾 คนขับ: พี่ยันต์ & จักร กฤษณ์</p>
                  </div>
                  <button 
                    onClick={() => { 
                      setActiveTab('gps'); 
                      setTrackingMode('realtime'); 
                      if(mainVehicle) setTrackingVehicleId(mainVehicle.id); 
                    }}
                    className="bg-blue-100 text-blue-700 hover:bg-blue-200 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-sm"
                  >
                    📍 ดูพิกัด GPS
                  </button>
                </div>
                
                <div className={`mt-3 p-3 rounded-lg border flex items-center gap-3 ${activeJobNow ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
                  {/* 👇 เปลี่ยนให้แสดงไอคอนตามประเภทพืช */}
                  <div className="text-2xl">
                    {activeJobNow 
                      ? (activeJobNow.crop_type === 'ข้าวโพด' ? '🌽' : activeJobNow.crop_type === 'ถั่ว' ? '🥜' : '🌾') 
                      : '☕'}
                  </div>
                  <div>
                    {/* 👇 เปลี่ยนข้อความให้ดึงชื่อพืชมาแสดงแทนคำว่าข้าว */}
                    <span className={`block text-xs font-bold mb-0.5 ${activeJobNow ? 'text-blue-800' : 'text-gray-500'}`}>
                      {activeJobNow ? `กำลังเก็บเกี่ยว${activeJobNow.crop_type || 'ข้าว'}` : 'สแตนด์บาย (ว่าง)'}
                    </span>
                    <span className="font-semibold text-gray-800 text-sm">
                      {activeJobNow ? `ลูกค้า: ${activeJobNow.customers?.name} (${activeJobNow.area_size} ไร่)` : 'รอรับคำสั่งงานถัดไป'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. คิวงานวันนี้ */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-gray-800 text-sm">📅 คิวงานวันนี้ & งานค้าง</h3>
                <button onClick={() => setActiveTab('active')} className="text-xs text-orange-600 font-bold hover:underline">ดูทั้งหมด ▶</button>
              </div>
              
              {todayJobs.length === 0 ? (
                <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  <p className="text-gray-500 font-bold text-sm">ไม่มีคิวงานในวันนี้ครับ 🍃</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* 👇 จัดเรียงให้งาน "กำลังเกี่ยว" ลอยขึ้นบนสุดเสมอ 👇 */}
                  {todayJobs.sort((a, b) => {
                    if (a.status === 'IN_PROGRESS' && b.status !== 'IN_PROGRESS') return -1;
                    if (b.status === 'IN_PROGRESS' && a.status !== 'IN_PROGRESS') return 1;
                    return new Date(a.job_date) - new Date(b.job_date);
                  }).map((job, idx) => {
                    const jobDate = new Date(job.job_date);
                    const isToday = jobDate.toDateString() === todayStr;
                    const isDone = job.status === 'DONE';
                    
                    // แยกวันที่ และ เวลา ออกจากกัน
                    const dateText = `${jobDate.getDate()}/${jobDate.getMonth() + 1}`;
                    const timeText = jobDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                    
                    return (
                      <div 
                        key={job.id} 
                        id={`job-card-${job.id}`} 
                        onClick={() => {
                          setActiveTab('active');
                          setExpandedId(job.id);  
                          setTimeout(() => {
                            const targetCard = document.getElementById(`job-card-${job.id}`);
                            if (targetCard) {
                              targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              targetCard.classList.add('ring-4', 'ring-orange-500', 'scale-[1.02]');
                              setTimeout(() => {
                                targetCard.classList.remove('ring-4', 'ring-orange-500', 'scale-[1.02]');
                              }, 2000);
                            } else {
                              window.scrollTo({ top: 0, behavior: 'smooth' }); 
                            }
                          }, 100);
                        }} 
                        className={`flex items-center p-3 rounded-xl border cursor-pointer transition ${isDone ? 'bg-green-50 border-green-200' : 'bg-white border-gray-100 hover:bg-gray-50 shadow-sm'}`}
                      >
                        {/* 🕒 ฝั่งซ้าย: วันที่/เวลา และเส้นแบ่งครึ่ง */}
                        <div className="w-16 shrink-0 text-center border-r border-gray-200 pr-3 mr-3 flex flex-col justify-center">
                          {!isToday && <span className={`block text-xs font-black ${isDone ? 'text-green-600' : 'text-gray-800'}`}>{dateText}</span>}
                          <span className={`block text-xs font-black ${isDone ? 'text-green-600' : 'text-gray-800'}`}>{timeText}</span>
                          {!isToday && <span className="text-[9px] text-red-500 font-bold block mt-1">ค้าง!</span>}
                        </div>
                        
                        {/* 👤 ตรงกลาง: ชื่อลูกค้า จัดให้อยู่กึ่งกลาง */}
                        <div className="flex-1 text-center pr-2">
                          <p className={`text-sm font-black ${isDone ? 'text-green-800' : 'text-gray-900'}`}>{job.customers?.name}</p>
                          <p className="text-xs text-gray-500 font-semibold mt-1"> 
                            {job.crop_type === 'ข้าวโพด' ? '🌽' : job.crop_type === 'ถั่ว' ? '🥜' : '🌾'} {job.area_size} ไร่ 
                          </p>
                        </div>
                        
                        {/* 🏷️ ฝั่งขวา: ป้ายสถานะ */}
                        <div className="shrink-0">
                          {isDone ? <span className="text-green-600 font-bold text-[10px] bg-green-100 px-2.5 py-1.5 rounded-lg">✅ เสร็จ</span> : 
                           job.status === 'IN_PROGRESS' ? <span className="bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded-lg text-[10px] font-bold">กำลังเกี่ยว</span> : 
                           <span className="bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg text-[10px] font-bold">รอคิว</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 4. แจ้งเตือน */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <h3 className="font-bold text-gray-800 text-sm mb-3">🔔 แจ้งเตือน</h3>
              <div className="space-y-2">
                
                {/* 🌤️ ระบบผู้ช่วยดูอากาศแบบข้อความ (ไม่ต้องดูเรดาร์เอง) */}
                <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-200 shadow-inner">
                  <div className="flex justify-between items-center mb-3 border-b border-blue-100 pb-2">
                    <p className="text-xs font-bold text-blue-900">
                      🌤️ สภาพอากาศ ({radarLocationName}) <br/>
                      <span className="text-[10px] text-blue-700">📍 {weatherLocationName}</span>
                    </p>
                    
                    {/* ปุ่มดึงพิกัดสลับโหมด */}
                    {radarOverride ? (
                      <button onClick={() => setRadarOverride(null)} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-2 py-1 rounded text-[10px] font-bold transition">
                        ❌ กลับไปดูรถ
                      </button>
                    ) : (
                      <button onClick={() => {
                          if (navigator.geolocation) {
                            navigator.geolocation.getCurrentPosition(
                              (pos) => setRadarOverride({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
                              (err) => alert('❌ ดึงพิกัดไม่ได้: ' + err.message)
                            );
                          }
                        }} className="bg-white hover:bg-blue-100 text-blue-700 border border-blue-200 px-2 py-1 rounded text-[10px] font-bold transition">
                        🎯 ดึงพิกัดฉัน
                      </button>
                    )}
                  </div>

                  {/* 🛡️ ประมวลผลข้อมูลอากาศมาแสดงเป็นข้อความ */}
                  {(weatherData && weatherData.current) ? (() => {
                    const current = getThaiWeatherText(weatherData.current.weather_code);
                    const currentHour = weatherData.current.time;
                    const hrIndex = weatherData.hourly.time.findIndex(t => t >= currentHour);

                    return (
                      <div>
                        {/* 📍 กล่องบอกอากาศตอนนี้ */}
                        <div className={`p-3 rounded-xl border ${current.bg} ${current.border} ${current.color} shadow-sm mb-3`}>
                          <p className="text-sm font-black mb-1">📍 ตอนนี้: {current.text}</p>
                          <p className="text-xs font-semibold">{current.desc}</p>
                        </div>

                        {/* 🕒 กล่องพยากรณ์ 24 ชั่วโมงข้างหน้า (เลื่อนซ้ายขวาได้) */}
                        <p className="text-[11px] font-bold text-gray-500 mb-1.5 flex justify-between items-center">
                          <span>พยากรณ์ล่วงหน้า 24 ชั่วโมง (1 วัน):</span>
                          <span className="text-[9px] bg-white px-2 py-0.5 rounded-full border shadow-sm animate-pulse text-blue-600">เลื่อนดู 👉</span>
                        </p>
                        
                        <div className="flex overflow-x-auto gap-2 pb-3 snap-x snap-mandatory [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 hover:[&::-webkit-scrollbar-thumb]:bg-gray-400 [&::-webkit-scrollbar-thumb]:rounded-full">
                          {/* 👇 เปลี่ยนเป็น Array.from เพื่อสร้าง 24 กล่องอัตโนมัติ ไม่ต้องพิมพ์เลขเอง */}
                          {Array.from({ length: 24 }, (_, i) => i + 1).map(offset => {
                            const idx = hrIndex + offset;
                            if (!weatherData.hourly?.time || !weatherData.hourly.time[idx]) return null;
                            
                            const t = new Date(weatherData.hourly.time[idx]);
                            const w = getThaiWeatherText(weatherData.hourly.weather_code[idx]);
                            
                            // 💡 เช็คว่าเวลาของกล่องนี้ ข้ามไปเป็นของ "วันพรุ่งนี้" หรือยัง
                            const isTomorrow = t.getDate() !== new Date().getDate();

                            return (
                              <div key={offset} className={`snap-center shrink-0 w-[30%] p-2 rounded-lg border text-center flex flex-col justify-center shadow-sm relative overflow-hidden ${w.bg} ${w.border} ${w.color}`}>
                                
                                {/* ถ้าเป็นของวันพรุ่งนี้ ให้มีแถบสีเตือนด้านบนเล็กๆ */}
                                {isTomorrow && (
                                  <div className="absolute top-0 left-0 right-0 bg-blue-500/20 text-blue-800 text-[8px] py-0.5 font-bold">
                                    พรุ่งนี้
                                  </div>
                                )}
                                
                                <p className={`text-[10px] font-bold mb-1 opacity-80 ${isTomorrow ? 'mt-3' : ''}`}>
                                  {t.getHours()}:00 น.
                                </p>
                                <p className="text-xl leading-none mb-1">{w.text.split(' ')[1]}</p>
                                <p className="text-[9px] font-bold leading-tight">{w.text.split(' ')[0]}</p>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })() : weatherData?.error ? (
                    <p className="text-xs text-center text-red-500 font-bold py-5">❌ ข้อมูลพิกัดไม่ถูกต้อง ดึงอากาศไม่ได้</p>
                  ) : (
                    <p className="text-xs text-center text-gray-500 font-bold py-5">⏳ กำลังประมวลผลสภาพอากาศ...</p>
                  )}
                </div>

                {/* 👇 แจ้งเตือนงานผิดนัด/ค้าง (โชว์เฉพาะเวลามีงานค้างเท่านั้น) 👇 */}
                {overdueJobs.length > 0 && (
                  <div 
                    onClick={() => setActiveTab('active')}
                    className="flex items-center gap-3 bg-orange-50 p-2.5 rounded-lg border border-orange-200 cursor-pointer hover:bg-orange-100 transition mt-2 shadow-sm"
                  >
                    <div className="text-xl animate-bounce">⚠️</div>
                    <div>
                      <p className="text-xs font-bold text-orange-900">มีงานค้าง / ผิดนัด {overdueJobs.length} คิว</p>
                      <p className="text-[10px] text-orange-700 font-semibold mt-0.5">กดเพื่อไปยังหน้าคิวงาน จัดการเลื่อนหรือเริ่มเกี่ยว</p>
                    </div>
                  </div>
                )}

                {/* แจ้งเตือนลูกหนี้ (ถ้ามี) */}
                {debtorsList.length > 0 && (
                  <div 
                    onClick={() => { setActiveTab('finance'); setFinanceSubTab('debt'); }}
                    className="flex items-center gap-3 bg-red-50 p-2.5 rounded-lg border border-red-200 cursor-pointer hover:bg-red-100 transition mt-2"
                  >
                    <div className="text-xl">🔴</div>
                    <p className="text-xs font-bold text-red-800">ลูกหนี้ค้างชำระ {debtorsList.length} ราย <span className="font-normal text-red-600">(แตะเพื่อดูรายละเอียด)</span></p>
                  </div>
                )}
                
              </div>
            </div>

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
                <div 
                  key={job.id} 
                  id={`job-card-${job.id}`} 
                  className="bg-white rounded-xl p-5 shadow-md border border-gray-200 transition-all duration-500"
                >
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
                    
                    {/* 💰 กล่องโชว์ยอดเงิน (ซ่อนไม่ให้คนขับเห็น) */}
                    {userRole === 'BOSS' && (Number(job.price_per_rai) > 0 || Number(job.total_price) > 0) ? (
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
                            {/* 👇 ซ่อนตัวเลือกสลิปเงินจากคนขับ 👇 */}
                            {userRole === 'BOSS' && <option value="SLIP">🧾 สลิปโอนเงิน</option>}
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
                                
                                {/* 👇 ซ่อนปุ่มกากบาทสีแดงสำหรับลบรูป (ให้เถ้าแก่ลบได้คนเดียว) 👇 */}
                                {userRole === 'BOSS' && (
                                  <button 
                                    onClick={(e) => handleDeleteImage(e, img.id, img.image_url, job.id)}
                                    className="absolute top-1 right-1 bg-red-500/90 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-md hover:bg-red-600 z-10"
                                  >
                                    ✕
                                  </button>
                                )}

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
                        {job.status !== 'IN_PROGRESS' && (
                          <button 
                            onClick={() => updateStatus(job.id, 'IN_PROGRESS')} 
                            /* 👇 ขยายปุ่มให้ใหญ่ขึ้นถ้าเป็นคนขับ 👇 */
                            className={`flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold shadow-sm transition ${userRole === 'DRIVER' ? 'py-4 text-lg rounded-xl shadow-lg' : 'py-2.5 text-xs rounded-lg'}`}
                          >
                            ▶️ เริ่มเกี่ยว
                          </button>
                        )}
                        
                        {/* 👇 ซ่อนปุ่มปิดจ๊อบให้โชว์เฉพาะเถ้าแก่ 👇 */}
                        {userRole === 'BOSS' && job.status !== 'DONE' && (
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

                        {/* 👇 ซ่อนปุ่มรอคิวให้โชว์เฉพาะเถ้าแก่ 👇 */}
                        {userRole === 'BOSS' && job.status !== 'PENDING' && (
                          <button 
                            onClick={() => updateStatus(job.id, 'PENDING')} 
                            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white text-xs py-2.5 rounded-lg font-bold shadow-sm transition"
                          >
                            ⏳ รอคิว
                          </button>
                        )}
                      </div>

                      {/* 👇 ซ่อนกลุ่มปุ่มแก้ไข/ลบงานจากคนขับ (แถมไปให้เพื่อความสมบูรณ์ครับ) 👇 */}
                      {userRole === 'BOSS' && (
                        <div className="flex gap-2 pt-2 mt-2">
                          <button onClick={(e) => { e.stopPropagation(); openEditForm(job); }} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white text-xs py-2 rounded-lg font-bold transition">✏️ แก้ไขข้อมูล</button>
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteJob(job.id); }} className="flex-1 bg-red-500 hover:bg-red-600 text-white text-xs py-2 rounded-lg font-bold transition">🗑️ ลบงาน</button>
                        </div>
                      )}
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

        {/* 📊 หน้าจอ Dashboard บัญชีหลัก (อัปเกรดดูรายปีได้ + คำนวณสด) */}
        {activeTab === 'finance' && financeSubTab === 'dashboard' && (() => {
          // 🧠 สมองกลคำนวณข้อมูลย่อย (ดึงจาก State โดยตรง รองรับทั้งรายเดือนและรายปี)
          
          // 1. กรองข้อมูลตามเดือนและปี (ถ้า dashMonth === 0 คือให้ดึงมา "ทั้งปี")
          const periodJobs = jobs.filter(j => {
            if (!j.job_date) return false;
            const d = new Date(j.job_date);
            return d.getFullYear() === dashYear && (dashMonth === 0 || (d.getMonth() + 1) === dashMonth);
          });
          
          const periodExpenses = expenseTransactions.filter(tx => {
            const d = new Date(tx.transaction_date || tx.created_at);
            return !Number.isNaN(d.getTime()) && d.getFullYear() === dashYear && (dashMonth === 0 || (d.getMonth() + 1) === dashMonth);
          });
          
          const periodWages = wageTransactions.filter(tx => {
            const d = new Date(tx.created_at || tx.transaction_date || tx.paid_at);
            return !Number.isNaN(d.getTime()) && d.getFullYear() === dashYear && (dashMonth === 0 || (d.getMonth() + 1) === dashMonth);
          });

          // 2. คำนวณตัวเลขทางการเงิน (ไม่ต้องรอ API dashboardData แล้ว คำนวณสดเร็วกว่า)
          let calcTotalIncome = 0;
          let calcTotalUnpaid = 0;
          let areaTotal = 0;

          const completedJobs = periodJobs.filter(j => j.status === 'DONE');
          const activeMonthJobs = periodJobs.filter(j => j.status !== 'DONE');

          completedJobs.forEach(j => {
            areaTotal += (Number(j.area_size) || 0);
            const currentTotal = Number(j.total_price) || 0;
            
            if (j.payment_status === 'PAID') {
              calcTotalIncome += currentTotal;
            } else if (j.payment_status === 'DEPOSIT') {
              // คำนวณยอดที่จ่ายมาแล้ว
              const orig = (Number(j.area_size) || 0) * (Number(j.price_per_rai) || 0);
              const trueTotal = orig > currentTotal ? orig : currentTotal;
              const paidAmt = trueTotal > currentTotal ? (trueTotal - currentTotal) : 0;
              
              calcTotalIncome += paidAmt;
              calcTotalUnpaid += currentTotal; 
            } else {
              calcTotalUnpaid += currentTotal;
            }
          });

          const calcTotalExpense = periodExpenses.reduce((sum, tx) => sum + (Number(tx.total_amount) || 0), 0);
          const calcNetProfit = calcTotalIncome - calcTotalExpense;

          // 👇 1. เพิ่มตัวแปรดึงเฉพาะรายจ่ายหน้างาน (หักรายจ่ายที่มีคำว่า "ค่างวด" ออกทั้งหมด)
          const operationalExpense = periodExpenses
            .filter(tx => !(tx.category || '').includes('ค่างวด'))
            .reduce((sum, tx) => sum + (Number(tx.total_amount) || 0), 0);

          // 3. ข้อมูลวิเคราะห์สำหรับกราฟและสัดส่วน
          // 👇 2. เปลี่ยนจาก calcTotalExpense เป็น operationalExpense
          const costPerRai = areaTotal > 0 ? operationalExpense / areaTotal : 0;
          const profitMargin = calcTotalIncome > 0 ? (calcNetProfit / calcTotalIncome) * 100 : 0;
          
          // ตัวชี้วัดอัตราการเก็บเงิน (Collection Rate)
          const totalPotential = calcTotalIncome + calcTotalUnpaid;
          const collectionRate = totalPotential > 0 ? (calcTotalIncome / totalPotential) * 100 : 0;
          
          const expenseByCategory = periodExpenses.reduce((acc, tx) => {
            const raw = tx.category === 'WAGE' || tx.category === 'ค่าแรง' ? 'ค่าแรง' : (tx.category || 'อื่นๆ');
            acc[raw] = (acc[raw] || 0) + (Number(tx.total_amount) || 0);
            return acc;
          }, {});

          const expenseCategoryEntries = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);
          const expenseMax = expenseCategoryEntries.length > 0 ? expenseCategoryEntries[0][1] : 1;

          const unpaidWage = periodWages.filter(tx => tx.status === 'UNPAID').reduce((sum, tx) => sum + (Number(tx.total_amount) || 0), 0);
          const paidWage = periodWages.filter(tx => tx.status === 'PAID').reduce((sum, tx) => sum + (Number(tx.total_amount) || 0), 0);
          const totalUnpaidWageAllTime = wageTransactions.filter(tx => tx.status === 'UNPAID').reduce((sum, tx) => sum + (Number(tx.total_amount) || 0), 0);
          
          const debtJobs = jobs.filter(j => j.status === 'DONE' && j.payment_status !== 'PAID'); // ลูกหนี้รวมทั้งหมดตลอดกาล
          const debtAmount = debtJobs.reduce((sum, j) => sum + (Number(j.total_price) || 0), 0);
          
          // 👇 สร้างตัวแปรเก็บยอดรวมกลุ่มตามลูกค้า 
          const groupedDebtorsMap = {};

          debtJobs.forEach(j => {
            const name = j.customers?.name || 'ไม่ระบุชื่อ';
            const crop = j.crop_type || 'ข้าว'; // ดึงประเภทพืชของงานนั้นๆ
            
            if (!groupedDebtorsMap[name]) {
              groupedDebtorsMap[name] = {
                name: name,
                total_price: 0,
                total_area: 0,
                job_count: 0,
                crop_areas: {} // 👈 เพิ่มกล่องใหม่เพื่อเก็บยอดแยกตามพืช
              };
            }
            // ทบยอดหนี้ พื้นที่รวม และนับจำนวนคิวงาน
            groupedDebtorsMap[name].total_price += Number(j.total_price) || 0;
            groupedDebtorsMap[name].total_area += Number(j.area_size) || 0;
            groupedDebtorsMap[name].job_count += 1;
            
            // 👇 ทบยอดพื้นที่ "แยกตามประเภทพืช"
            if (!groupedDebtorsMap[name].crop_areas[crop]) {
                groupedDebtorsMap[name].crop_areas[crop] = 0;
            }
            groupedDebtorsMap[name].crop_areas[crop] += Number(j.area_size) || 0;
          });

          // 👇 นำลูกค้าที่รวมยอดแล้ว มาเรียงลำดับคนที่ติดหนี้เยอะสุด 5 อันดับแรก
          const topDebtors = Object.values(groupedDebtorsMap)
            .sort((a, b) => b.total_price - a.total_price)
            .slice(0, 5);
          
          const formatMoney = (value) => Number(value || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
          const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;
          
          // ถ้าเลือก 0 จะแสดงคำว่า "สรุปทั้งปี"
          const monthName = dashMonth === 0 ? "สรุปทั้งปี" : ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"][dashMonth - 1];

          return (
            <div className="space-y-4 pb-3">
              {/* Header */}
              <div className="bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-950 rounded-3xl p-5 text-white shadow-xl relative overflow-hidden">
                <div className="absolute -right-10 -top-10 w-32 h-32 rounded-full bg-purple-400/10 blur-2xl"></div>
                <div className="absolute -left-10 -bottom-10 w-32 h-32 rounded-full bg-indigo-300/10 blur-2xl"></div>
                <div className="relative z-10 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-indigo-200 font-black">ACCOUNT CENTER</p>
                    <h2 className="text-2xl font-black mt-1 text-white drop-shadow-md">📊 บัญชีหลัก</h2>
                    <p className="text-xs text-indigo-100/80 mt-1">ภาพรวมการเงินและผลประกอบการ • {monthName} {dashYear + 543}</p>
                  </div>
                </div>
                
                {/* 💡 ตัวเลือกเดือนและปี ที่เพิ่ม "สรุปทั้งปี" และ ปีย้อนหลัง 5 ปี */}
                <div className="relative z-10 flex flex-wrap gap-2 mt-4">
                  <select value={dashMonth} onChange={(e) => setDashMonth(Number(e.target.value))} className="bg-white/10 border border-white/15 text-white p-2 rounded-xl text-xs font-bold outline-none">
                    <option value={0} className="text-gray-900 font-bold bg-amber-100">🌟 สรุปทั้งปี</option>
                    {['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'].map((m, i) => <option key={i} value={i + 1} className="text-gray-900">{m}</option>)}
                  </select>
                  
                  <select value={dashYear} onChange={(e) => setDashYear(Number(e.target.value))} className="bg-white/10 border border-white/15 text-white p-2 rounded-xl text-xs font-bold outline-none">
                    {/* สร้างตัวเลือกย้อนหลัง 5 ปีแบบอัตโนมัติ */}
                    {Array.from({ length: 5 }, (_, i) => {
                      const y = new Date().getFullYear() - i;
                      return (
                        <option key={y} value={y} className="text-gray-900">
                          {y + 543} {i === 0 ? '(ปีนี้)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Financial snapshot */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 bg-white rounded-3xl p-5 shadow-md border border-emerald-100 relative overflow-hidden">
                  <div className="absolute right-3 top-3 text-5xl opacity-10">📈</div>
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-black text-emerald-700">NET PROFIT</p>
                      <p className={`text-4xl sm:text-5xl font-black tracking-tight mt-1 ${calcNetProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(calcNetProfit)} <span className="text-sm text-gray-400">บาท</span></p>
                      <p className="text-xs text-gray-500 font-semibold mt-2">กำไรสุทธิของช่วงเวลาที่เลือก</p>
                    </div>
                    <div className={`px-3 py-2 rounded-xl text-xs font-black ${profitMargin >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                      Margin {formatPercent(profitMargin)}
                    </div>
                  </div>
                </div>
                
                <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 shadow-sm">
                  <p className="text-[10px] font-black text-emerald-800">💰 รายรับ</p>
                  <p className="text-2xl font-black text-emerald-600 mt-1">{formatMoney(calcTotalIncome)} <span className="text-xs">฿</span></p>
                </div>
                
                <div className="bg-rose-50 rounded-2xl p-4 border border-rose-100 shadow-sm">
                  <p className="text-[10px] font-black text-rose-800">💸 รายจ่าย</p>
                  <p className="text-2xl font-black text-rose-600 mt-1">{formatMoney(calcTotalExpense)} <span className="text-xs">฿</span></p>
                </div>

                {/* 💡 แทนที่ Sky Box เดิม ด้วย "อัตราการเก็บเงินได้" */}
                <div className="bg-sky-50 rounded-2xl p-4 border border-sky-100 shadow-sm col-span-2 sm:col-span-1">
                  <div className="flex justify-between items-start">
                    <p className="text-[10px] font-black text-sky-900">🎯 อัตราการเก็บเงินได้ (Collection Rate)</p>
                  </div>
                  <p className="text-2xl font-black text-sky-600 mt-1">{formatPercent(collectionRate)}</p>
                  <p className="text-[10px] text-sky-700 font-bold mt-1">เก็บเงินสดเข้าจริง เทียบกับยอดบิลรวมทั้งหมด</p>
                </div>

                <button onClick={() => setFinanceSubTab('debt')} className="text-left bg-amber-50 rounded-2xl p-4 border border-amber-200 shadow-sm hover:bg-amber-100 transition col-span-2 sm:col-span-1">
                  <p className="text-[10px] font-black text-amber-900">💳 ลูกหนี้ค้าง </p>
                  <p className="text-2xl font-black text-amber-600 mt-1">{formatMoney(debtAmount)} <span className="text-xs">฿</span></p>
                  <p className="text-[10px] text-amber-700 font-bold mt-1">{debtJobs.length} รายการ • กดเพื่อตามเก็บ</p>
                </button>
              </div>

              {/* Income / expense ratio */}
              <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-md">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-black text-gray-900">💼 ภาพรวมเงินเข้า–เงินออก</h3>
                    <p className="text-[11px] text-gray-500 mt-1">ดูสัดส่วนต้นทุนเทียบกับรายรับในช่วงที่เลือก</p>
                  </div>
                  <div className="text-right text-[10px] font-black">
                    <span className="text-emerald-600">รับ {formatPercent((calcTotalIncome / Math.max(calcTotalIncome + calcTotalExpense, 1)) * 100)}</span>
                    <span className="text-gray-300 mx-1">/</span>
                    <span className="text-rose-500">จ่าย {formatPercent((calcTotalExpense / Math.max(calcTotalIncome + calcTotalExpense, 1)) * 100)}</span>
                  </div>
                </div>
                <div className="h-4 rounded-full bg-gray-100 overflow-hidden flex shadow-inner">
                  <div className="bg-emerald-500 h-full transition-all" style={{ width: `${Math.min(100, (calcTotalIncome / Math.max(calcTotalIncome + calcTotalExpense, 1)) * 100)}%` }}></div>
                  <div className="bg-rose-400 h-full transition-all" style={{ width: `${Math.min(100, (calcTotalExpense / Math.max(calcTotalIncome + calcTotalExpense, 1)) * 100)}%` }}></div>
                </div>
              </div>

              {/* Operations */}
              <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-md">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-black text-gray-900">🌾 ผลงานของช่วงเวลาที่เลือก</h3>
                    <p className="text-[11px] text-gray-500 mt-1">วัดผลจากงานที่อยู่ในช่วง {monthName}</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 text-[10px] font-black">{periodJobs.length} งาน</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-teal-50 rounded-2xl p-3 border border-teal-100"><p className="text-[10px] font-bold text-teal-800">พื้นที่รวม</p><p className="text-xl font-black text-teal-700 mt-1">{formatMoney(areaTotal)} <span className="text-xs">ไร่</span></p></div>
                  <div className="bg-blue-50 rounded-2xl p-3 border border-blue-100"><p className="text-[10px] font-bold text-blue-800">งานเสร็จแล้ว</p><p className="text-xl font-black text-blue-700 mt-1">{completedJobs.length} <span className="text-xs">งาน</span></p></div>
                  <div className="bg-orange-50 rounded-2xl p-3 border border-orange-100"><p className="text-[10px] font-bold text-orange-800">งานค้าง/กำลังทำ</p><p className="text-xl font-black text-orange-700 mt-1">{activeMonthJobs.length} <span className="text-xs">งาน</span></p></div>
                  <div className="bg-indigo-50 rounded-2xl p-3 border border-indigo-100">
                  <p className="text-[10px] font-bold text-indigo-800">กำไรเฉลี่ยต่อไร่</p>
                  <p className="text-xl font-black text-indigo-700 mt-1">
                    {/* 👇 เปลี่ยนจาก calcNetProfit เป็น (รายได้รวมหนี้ - ต้นทุน) */}
                    {formatMoney(areaTotal > 0 ? ((calcTotalIncome + calcTotalUnpaid) - calcTotalExpense) / areaTotal : 0)} <span className="text-xs">฿/ไร่</span>
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3"><span className="text-gray-500 font-bold">ต้นทุนเฉลี่ย/ไร่</span><strong className="block text-gray-900 text-lg mt-1">{formatMoney(costPerRai)} ฿</strong></div>
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3"><span className="text-gray-500 font-bold">รายได้เฉลี่ย/ไร่</span><strong className="block text-gray-900 text-lg mt-1">{formatMoney(areaTotal > 0 ? (calcTotalIncome + calcTotalUnpaid) / areaTotal : 0)} ฿</strong></div>
                </div>
              </div>

              {/* Cost dashboard */}
              <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-md">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-black text-gray-900">💸 โครงสร้างต้นทุน</h3>
                    <p className="text-[11px] text-gray-500 mt-1">ดูว่าเงินออกไปกับอะไรบ้าง</p>
                  </div>
                  <button onClick={() => setFinanceSubTab('expense')} className="text-[10px] font-black px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-100">ดูรายจ่ายทั้งหมด →</button>
                </div>
                {expenseCategoryEntries.length === 0 ? (
                  <div className="py-7 text-center text-gray-400 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                    <div className="text-3xl">📭</div><p className="font-bold text-xs mt-2">ยังไม่มีรายการรายจ่ายในช่วงเวลานี้</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {expenseCategoryEntries.slice(0, 6).map(([name, amount]) => (
                      <div key={name}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-bold text-gray-700">{name}</span>
                          <span className="text-xs font-black text-gray-900">{formatMoney(amount)} ฿</span>
                        </div>
                        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-orange-400 to-rose-500 rounded-full" style={{ width: `${Math.min(100, (amount / expenseMax) * 100)}%` }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Wage snapshot */}
              <div className="bg-gradient-to-r from-orange-50 to-red-50 rounded-3xl p-5 border border-orange-100 shadow-md">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-orange-700 font-black">LABOR COST</p>
                    <h3 className="text-lg font-black text-orange-950 mt-1">👷 ค่าแรงทีมงาน ({monthName})</h3>
                  </div>
                  <button onClick={() => { setWageFilter([]); setShowWageSummary(true); fetchWages(); }} className="px-3 py-2 bg-white rounded-xl border border-orange-200 text-orange-700 text-[10px] font-black shadow-sm">เปิดสมุดค่าแรง →</button>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="bg-white/80 rounded-2xl p-3 border border-orange-100"><p className="text-[10px] font-bold text-orange-700">จ่ายแล้ว</p><p className="text-2xl font-black text-green-600 mt-1">{formatMoney(paidWage)} ฿</p></div>
                  <div className="bg-white/80 rounded-2xl p-3 border border-orange-100"><p className="text-[10px] font-bold text-orange-700">รอจ่าย</p><p className="text-2xl font-black text-red-600 mt-1">{formatMoney(unpaidWage)} ฿</p></div>
                </div>
              </div>

              {/* Alerts + debtors */}
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-md">
                  <div className="flex items-center justify-between mb-3">
                    <div><h3 className="font-black text-gray-900">⚠️ สิ่งที่ต้องจัดการ</h3><p className="text-[11px] text-gray-500 mt-1">รายการสำคัญที่ไม่ควรมองข้าม</p></div>
                    {/* 👇 เปลี่ยนเป็น totalUnpaidWageAllTime */}
                    <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-red-50 text-red-600 border border-red-100">{(debtJobs.length + (totalUnpaidWageAllTime > 0 ? 1 : 0))} เรื่อง</span>
                  </div>
                  <div className="space-y-2">
                    <button onClick={() => setFinanceSubTab('debt')} className="w-full flex items-center justify-between p-3 rounded-2xl bg-red-50 border border-red-100 text-left hover:bg-red-100 transition">
                      <span><span className="block text-xs font-black text-red-800">💳 ลูกหนี้ค้างชำระ (ทั้งหมด)</span><span className="block text-[10px] text-red-600 mt-0.5">{debtJobs.length} รายการ</span></span><strong className="text-red-600">{formatMoney(debtAmount)} ฿</strong>
                    </button>
                    
                    {/* 👇 เปลี่ยนเป็น totalUnpaidWageAllTime และแก้ข้อความเป็น "ยอดสะสมรวม" */}
                    {totalUnpaidWageAllTime > 0 && <button onClick={() => { setWageFilter([]); setShowWageSummary(true); fetchWages(); }} className="w-full flex items-center justify-between p-3 rounded-2xl bg-orange-50 border border-orange-100 text-left hover:bg-orange-100 transition"><span><span className="block text-xs font-black text-orange-800">👷 ค่าแรงรอจ่าย (ยอดสะสมรวม)</span><span className="block text-[10px] text-orange-600 mt-0.5">ควรเคลียร์ตามรอบ</span></span><strong className="text-orange-600">{formatMoney(totalUnpaidWageAllTime)} ฿</strong></button>}
                    
                    {/* 👇 เปลี่ยนเป็น totalUnpaidWageAllTime */}
                    {debtJobs.length === 0 && totalUnpaidWageAllTime <= 0 && <div className="text-center py-5 rounded-2xl bg-emerald-50 border border-emerald-100"><div className="text-3xl">✅</div><p className="text-xs font-black text-emerald-700 mt-1">ไม่มีรายการเร่งด่วน</p></div>}
                  </div>
                </div>

                <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-md">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-black text-gray-900">👥 ลูกหนี้ก้อนใหญ่</h3>
                      <p className="text-[11px] text-gray-500 mt-1">5 ลูกค้าที่มียอดค้างสูงสุด (รวมทุกแปลง)</p>
                    </div>
                    <button onClick={() => setFinanceSubTab('debt')} className="text-[10px] font-black text-red-600">ดูทั้งหมด →</button>
                  </div>
                  {topDebtors.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-5">ไม่มีลูกหนี้ค้างชำระ</p>
                  ) : (
                    <div className="space-y-2">
                      {topDebtors.map((debtor, idx) => (
                        <button key={idx} onClick={() => setFinanceSubTab('debt')} className="w-full flex items-center gap-3 p-3 rounded-2xl bg-gray-50 border border-gray-100 hover:bg-red-50 transition text-left">
                          <div className="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center font-black text-gray-500">{idx + 1}</div>
                          <div className="flex-1 min-w-0">
                            <p className="font-black text-xs text-gray-800 truncate">{debtor.name}</p>
                            
                            {/* 👇 โชว์จำนวนไร่แยกตามพืชอัตโนมัติ */}
                            <p className="text-[10px] text-gray-500 mt-0.5">
                              {Object.entries(debtor.crop_areas)
                                .map(([cropName, area]) => `${cropName} ${area} ไร่`)
                                .join(' + ')} • ({debtor.job_count} คิวงาน)
                            </p>
                            
                          </div>
                          <strong className="text-sm text-red-600">{formatMoney(debtor.total_price)} ฿</strong>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick actions */}
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => setShowExpenseForm(true)} className="bg-red-500 hover:bg-red-600 text-white rounded-2xl p-3 font-black text-[10px] shadow-sm transition">➕<span className="block mt-1">บันทึกรายจ่าย</span></button>
                <button onClick={() => setFinanceSubTab('income')} className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl p-3 font-black text-[10px] shadow-sm transition">💵<span className="block mt-1">ดูเงินเข้า</span></button>
                <button onClick={() => setFinanceSubTab('debt')} className="bg-amber-500 hover:bg-amber-600 text-white rounded-2xl p-3 font-black text-[10px] shadow-sm transition">💳<span className="block mt-1">ตามลูกหนี้</span></button>
              </div>
            </div>
          );
        })()}

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
                .sort((a, b) => new Date(b.job_date) - new Date(a.job_date))
                .map(job => {
                  // 👇 คำนวณยอดที่จ่ายมาแล้ว โดยเอา (จำนวนไร่ x ราคาต่อไร่) มาลบด้วย ยอดคงเหลือ
                  const originalPrice = Number(job.area_size || 0) * Number(job.price_per_rai || 0);
                  const isDeposit = job.payment_status === 'DEPOSIT';
                  const paidAmount = (isDeposit && originalPrice > Number(job.total_price)) 
                                      ? (originalPrice - Number(job.total_price)) 
                                      : 0;

                  return (
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
                          {isDeposit && <span className="block text-[10px] text-gray-500 font-bold mb-0.5">เหลือค้างจ่าย:</span>}
                          <span className="block font-black text-red-600 text-2xl leading-none">
                            {Number(job.total_price).toLocaleString()} <span className="text-sm">฿</span>
                          </span>
                          
                          {/* 👇 เปลี่ยนข้อความในป้าย เป็น "จ่ายบางส่วน (ค้างส่วนต่าง)" 👇 */}
                          <span className={`inline-block px-2 py-1 rounded text-[10px] font-bold mt-1.5 ${isDeposit ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>
                            {isDeposit ? '💳 จ่ายบางส่วน (ค้างส่วนต่าง)' : '⏳ ยังไม่จ่ายเลย'}
                          </span>
                          
                          {/* 👇 โชว์ยอดที่จ่ายมาแล้ว (สีเขียวตัวเล็กๆ) 👇 */}
                          {isDeposit && paidAmount > 0 && (
                            <span className="block text-[10px] text-emerald-600 font-bold mt-1">
                              (จ่ายมาแล้ว {paidAmount.toLocaleString()} ฿)
                            </span>
                          )}
                        </div>
                     </div>
                     
                     <div className="pl-2 mb-4 text-sm text-gray-600 bg-gray-50 p-2 rounded-lg border border-gray-100">
                       <p>📅 <strong>วันที่เกี่ยว:</strong> {new Date(job.job_date).toLocaleDateString('th-TH')}</p>
                       <p>📐 <strong>รายละเอียด:</strong> {job.area_size || 0} ไร่ ({job.crop_type})</p>
                       {job.address_note && <p className="text-xs text-gray-500 mt-1">📍 {job.address_note}</p>}
                     </div>

                     <div className="flex gap-1.5 pl-2">
                        <button 
                          onClick={() => {
                            const text = `แจ้งยอดค้างชำระค่าเกี่ยวครับ 🌾\n\n👤 ชื่อลูกค้า: ${job.customers?.name}\n📅 วันที่เกี่ยว: ${new Date(job.job_date).toLocaleDateString('th-TH')}\n📐 พื้นที่: ${job.area_size || 0} ไร่ (${job.crop_type})\n\n💰 ยอดที่ต้องชำระ: ${Number(job.total_price).toLocaleString()} บาท\n\nรบกวนโอนชำระและส่งสลิปให้ด้วยนะครับ ขอบคุณครับ 🙏`;
                            navigator.clipboard.writeText(text);
                            alert('📋 คัดลอกข้อความทวงหนี้เรียบร้อยแล้ว!\nนำไปกด "วาง" (Paste) ในแชท LINE ลูกค้าได้เลยครับ');
                          }}
                          className="flex-1 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 border border-blue-200 font-bold py-2.5 px-1 rounded-xl text-[11px] sm:text-xs transition flex items-center justify-center shadow-sm"
                        >
                          💬 ก๊อปปี้ทวง
                        </button>
                        
                        {/* 👇 ปุ่มเก็บเงิน (เถ้าแก่เห็นเท่านั้น แบ่งเป็นจ่ายบางส่วน กับ จ่ายเต็ม) 👇 */}
                        {userRole === 'BOSS' && (
                          <>
                            <button 
                              onClick={() => {
                                const amountStr = window.prompt(`ยอดหนี้ปัจจุบัน: ${Number(job.total_price).toLocaleString()} บาท\n\nลูกค้าจ่ายมาก่อนเท่าไหร่? (ระบุเป็นตัวเลข):`);
                                if (!amountStr) return;
                                const paidAmount = Number(amountStr);
                                if (isNaN(paidAmount) || paidAmount <= 0) return alert("❌ กรุณาระบุตัวเลขให้ถูกต้องครับ");
                                
                                if (paidAmount >= Number(job.total_price)) {
                                  if(window.confirm("ยอดเงินที่ระบุครอบคลุมหนี้ทั้งหมด ระบบจะบันทึกว่า 'จ่ายเต็มบิล' ยืนยันหรือไม่?")) {
                                    updatePaymentStatus(job.id, 'PAID');
                                  }
                                } else {
                                  const remaining = (Number(job.total_price) - paidAmount).toFixed(2);
                                  if (window.confirm(`รับเงินมาแล้ว: ${paidAmount.toLocaleString()} บาท\nค้างจ่ายส่วนที่เหลือ: ${Number(remaining).toLocaleString()} บาท\n\nยืนยันการหักลบยอดหนี้ใช่หรือไม่?`)) {
                                    
                                    // ส่งไปอัปเดตแค่ยอดหนี้ที่เหลือ (ไม่แก้ไขชื่อลูกค้า)
                                    const updatePayload = {
                                      customer_name: job.customers?.name || '', 
                                      phone: job.customers?.phone || '',
                                      address_note: job.address_note || '',
                                      crop_type: job.crop_type || 'ข้าว',
                                      area_size: job.area_size,
                                      job_date: job.job_date,
                                      latitude: job.latitude,
                                      longitude: job.longitude,
                                      vehicle_id: job.vehicles?.id || job.vehicle_id || 0,
                                      boundaries: job.boundaries || [],
                                      price_per_rai: job.price_per_rai,
                                      total_price: remaining, // 👈 ยอดหนี้ที่เหลือ
                                      payment_status: 'DEPOSIT' 
                                    };

                                    fetch(`https://harvester-api-server.onrender.com/api/jobs/${job.id}`, {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify(updatePayload)
                                    })
                                    .then(res => {
                                      if(res.ok) {
                                        alert("✅ หักลบยอดหนี้เรียบร้อยแล้ว");
                                        fetchJobs();
                                      } else { alert("❌ บันทึกไม่สำเร็จ"); }
                                    }).catch(() => alert("❌ เกิดข้อผิดพลาดในการเชื่อมต่อ"));
                                  }
                                }
                              }}
                              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 px-1 rounded-xl text-[11px] sm:text-xs shadow-md transition flex items-center justify-center"
                            >
                              💳 จ่ายบางส่วน
                            </button>

                            <button 
                              onClick={() => {
                                if(window.confirm(`ยืนยันว่าลูกค้า [ ${job.customers?.name} ] จ่ายเงินยอดเต็ม ${Number(job.total_price).toLocaleString()} บาท เรียบร้อยแล้วใช่ไหมครับ?\n\n(ถ้ายืนยัน งานนี้จะหายไปจากหน้าลูกหนี้ทันที)`)) {
                                  updatePaymentStatus(job.id, 'PAID');
                                }
                              }}
                              className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-2.5 px-1 rounded-xl text-[11px] sm:text-xs shadow-md transition flex items-center justify-center"
                            >
                              ✅ รับเงินเรียบร้อย
                            </button>
                          </>
                        )}
                     </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 💵 หน้าจอประวัติการรับเงิน (เช็คยอดรายวัน) */}
        {activeTab === 'finance' && financeSubTab === 'income' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-5 rounded-xl border border-green-200 shadow-sm flex justify-between items-center">
               <div>
                 <h2 className="text-lg font-black text-green-800">💵 ประวัติรับเงิน</h2>
                 <p className="text-xs text-green-600 font-semibold mt-1">รายการจ่ายเต็ม และจ่ายมัดจำ</p>
               </div>
               <div className="text-right">
                 <span className="block text-xs text-green-700 font-bold mb-1">ยอดรับรวมทั้งหมด</span>
                 <span className="text-3xl font-black text-green-600">
                   {jobs.filter(j => j.payment_status === 'PAID' || j.payment_status === 'DEPOSIT').reduce((sum, j) => {
                      // 💡 สมองกลคำนวณยอดจริง (ดึงพื้นที่ x ราคา มาเปรียบเทียบ)
                      const orig = Number(j.area_size || 0) * Number(j.price_per_rai || 0);
                      const trueTotal = orig > Number(j.total_price) ? orig : (Number(j.total_price) || 0);

                      if (j.payment_status === 'PAID') return sum + trueTotal;
                      
                      const paidAmount = trueTotal > Number(j.total_price) ? trueTotal - Number(j.total_price) : 0;
                      return sum + paidAmount;
                   }, 0).toLocaleString()} <span className="text-sm">฿</span>
                 </span>
               </div>
            </div>

            {jobs.filter(j => j.payment_status === 'PAID' || (j.payment_status === 'DEPOSIT' && (Number(j.area_size || 0) * Number(j.price_per_rai || 0)) > Number(j.total_price))).length === 0 ? (
               <div className="text-center text-gray-500 py-10 bg-white rounded-xl shadow-sm border border-gray-200">
                 <span className="text-4xl mb-2 block">🍃</span>
                 <p className="font-bold">ยังไม่มีประวัติการรับเงินครับ</p>
              </div>
            ) : (
              jobs.filter(j => j.payment_status === 'PAID' || (j.payment_status === 'DEPOSIT' && (Number(j.area_size || 0) * Number(j.price_per_rai || 0)) > Number(j.total_price)))
                  .sort((a, b) => new Date(b.paid_at || b.job_date) - new Date(a.paid_at || a.job_date))
                  .slice(0, 50)
                  .map(job => {
                    const isDeposit = job.payment_status === 'DEPOSIT';
                    // 💡 ดึงยอดจริงมาแสดง
                    const orig = Number(job.area_size || 0) * Number(job.price_per_rai || 0);
                    const trueTotal = orig > Number(job.total_price) ? orig : (Number(job.total_price) || 0);
                    
                    const displayIncome = isDeposit ? (trueTotal - Number(job.total_price)) : trueTotal;

                    return (
                    <div key={job.id} className={`bg-white p-4 rounded-xl shadow-md relative overflow-hidden flex justify-between items-center ${isDeposit ? 'border border-amber-100' : 'border border-green-100'}`}>
                       <div className={`absolute top-0 left-0 w-1.5 h-full ${isDeposit ? 'bg-amber-400' : 'bg-green-400'}`}></div>
                       <div className="pl-2">
                         <h3 className="font-bold text-gray-900 text-lg">{job.customers?.name || 'ไม่ระบุชื่อ'}</h3>
                         <p className="text-[11px] text-gray-500 mt-0.5">
                           📅 รับเงิน: <span className="font-semibold text-gray-800">
                             {job.paid_at ? (() => {
                               // 💡 แก้ปัญหาเวลาเพี้ยน (บวก 7 ชม. ซ้ำซ้อน) และปรับฟอร์แมตให้เป็นแบบไทยสวยๆ
                               const dateStr = job.paid_at.replace('Z', '').replace('+00:00', '');
                               const d = new Date(dateStr);
                               return `${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })} เวลา ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
                             })() : 'ไม่มีข้อมูลเวลา'}
                           </span>
                         </p>
                       </div>
                       <div className="text-right">
                         <span className="block font-black text-green-600 text-xl leading-none">
                           {displayIncome.toLocaleString()} <span className="text-sm">฿</span>
                         </span>
                         <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold mt-1.5 ${isDeposit ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-green-100 text-green-700 border border-green-200'}`}>
                           {isDeposit ? '💳 จ่ายบางส่วน' : '✅ จ่ายเต็ม'}
                         </span>
                       </div>
                    </div>
                  )})
            )}
          </div>
        )}

        {/* 📉 หน้าจอประวัติรายจ่าย */}
        {activeTab === 'finance' && financeSubTab === 'expense' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-orange-50 to-red-50 p-5 rounded-xl border border-orange-200 shadow-sm flex justify-between items-center">
               <div>
                 <h2 className="text-lg font-black text-orange-800">📉 ประวัติรายจ่าย</h2>
                 <p className="text-xs text-orange-600 font-semibold mt-1">ค่าน้ำมัน, ซ่อมบำรุง, จิปาถะ</p>
               </div>
               <div className="text-right">
                 <span className="block text-xs text-orange-700 font-bold mb-1">ยอดจ่ายรวมทั้งหมด</span>
                 <span className="text-3xl font-black text-red-600">
                   {expenseTransactions.reduce((sum, tx) => sum + (Number(tx.total_amount) || 0), 0).toLocaleString()} <span className="text-sm">฿</span>
                 </span>
               </div>
            </div>

            {expenseTransactions.length === 0 ? (
               <div className="text-center text-gray-500 py-10 bg-white rounded-xl shadow-sm border border-gray-200">
                 <span className="text-4xl mb-2 block">🍃</span>
                 <p className="font-bold">ยังไม่มีประวัติการบันทึกรายจ่าย</p>
              </div>
            ) : (
              expenseTransactions
                  .sort((a, b) => new Date(b.transaction_date || b.created_at) - new Date(a.transaction_date || a.created_at))
                  .map(tx => {
                    // 💡 เช็คว่าเป็นค่าแรงหรือไม่ เพื่อปรับหน้าตาให้เข้ากัน
                    const isWage = tx.category === 'WAGE' || tx.category === 'ค่าแรง';
                    // 💡 ดึงเวลาจ่าย (ถ้าไม่มีให้ใช้เวลาลงระบบแทน)
                    const displayDate = tx.transaction_date || tx.created_at;

                    return (
                    <div key={tx.id} className={`bg-white p-4 rounded-xl shadow-sm relative overflow-hidden flex flex-col gap-2 border ${isWage ? 'border-red-100' : 'border-orange-100'}`}>
                       <div className={`absolute top-0 left-0 w-1.5 h-full ${isWage ? 'bg-red-400' : 'bg-orange-400'}`}></div>

                       <div className="flex justify-between items-start pl-2">
                         <div className="flex-1 pr-4">
                           <div className="flex items-center gap-2 mb-1">
                             <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${isWage ? 'bg-red-50 text-red-700 border-red-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                               {tx.category === 'WAGE' ? 'ค่าแรง' : (tx.category || 'ทั่วไป')}
                             </span>
                             <span className="text-[10px] text-gray-400 font-bold">
                               📅 {displayDate ? new Date(displayDate).toLocaleDateString('th-TH') : ''}
                             </span>
                           </div>
                           
                           <h3 className="font-bold text-gray-800 text-sm mt-1.5">
                             {isWage ? 'จ่ายค่าแรงทีมงาน' : (tx.spender_name ? `ผู้จ่าย: ${tx.spender_name}` : `ค่า${tx.category || 'ใช้จ่ายทั่วไป'}`)}
                           </h3>
                           
                           <p className={`text-[11px] mt-0.5 ${isWage ? 'text-blue-600 font-semibold' : 'text-gray-500'}`}>
                             {isWage ? '👷‍♂️' : '📝'} {tx.note || 'ไม่มีหมายเหตุ'}
                           </p>
                         </div>
                         
                         {/* ฝั่งขวา: ตัวเลขชัดเจน และปุ่มการทำงานเรียงไว้ด้านล่าง */}
                         <div className="text-right shrink-0 flex flex-col items-end">
                           <span className="block font-black text-red-600 text-xl leading-none">
                             -{Number(tx.total_amount).toLocaleString()} <span className="text-xs font-normal">฿</span>
                           </span>

                           <div className="flex items-center gap-2.5 mt-2.5">
                             {/* 👇 1. รูปภาพใบเสร็จขนาดเล็ก 👇 */}
                             {tx.receipt_url && (
                               <a href={tx.receipt_url} target="_blank" rel="noreferrer" className="relative group cursor-pointer" title="คลิกเพื่อดูใบเสร็จขนาดเต็ม">
                                 <img 
                                   src={tx.receipt_url} 
                                   alt="ใบเสร็จ" 
                                   className="w-10 h-10 object-cover rounded-md border border-gray-300 shadow-sm transition group-hover:opacity-80"
                                 />
                                 <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-[8px] font-bold px-1 rounded-full shadow-sm">
                                   🔍
                                 </span>
                               </a>
                             )}
                             
                             {/* 👇 2. ปุ่มแก้ไข (สำหรับแก้ยอด/เพิ่มรูป) 👇 */}
                             <button 
                               onClick={() => handleEditExpense(tx)}
                               className="text-gray-400 hover:text-blue-500 p-1 bg-gray-50 hover:bg-blue-50 rounded-md transition text-sm"
                               title="แก้ไขรายการนี้"
                             >
                               ✏️
                             </button>

                             {/* 👇 3. ปุ่มลบทิ้ง 👇 */}
                             <button 
                               onClick={() => handleDeleteExpense(tx.id)}
                               className="text-gray-400 hover:text-red-500 p-1 bg-gray-50 hover:bg-red-50 rounded-md transition"
                               title="ลบรายการนี้"
                             >
                               🗑️
                             </button>
                           </div>
                         </div>
                       </div>
                    </div>
                  )})
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

        {/* 💰 Popup สมุดจดค่าแรงลูกจ้าง (อัปเกรดมีแท็บประวัติ + ระบบติ๊กเลือกคน) */}
        {showWageSummary && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[200]">
            <div className="bg-white rounded-2xl p-5 w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">
              <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span>💰</span> สมุดจดค่าแรง
                </h2>
                <button onClick={() => { setShowWageSummary(false); setWageFilter([]); }} className="text-gray-400 hover:text-red-500 bg-gray-100 hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center font-bold text-lg transition">✕</button>
              </div>
              
              {/* ปุ่มสลับแท็บ รอเบิก / จ่ายแล้ว */}
              <div className="flex gap-2 mb-3 bg-gray-100 p-1 rounded-lg shrink-0">
                <button onClick={() => setWageTab('UNPAID')} className={`flex-1 py-2 text-sm font-bold rounded-md transition ${wageTab === 'UNPAID' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>รอเบิก</button>
                <button onClick={() => setWageTab('PAID')} className={`flex-1 py-2 text-sm font-bold rounded-md transition ${wageTab === 'PAID' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>ประวัติที่จ่ายแล้ว</button>
              </div>

              {/* 👇 🔍 แถบปุ่มกดติ๊กเลือกชื่อ (Filter อัจฉริยะ) 👇 */}
              <div className="mb-3 shrink-0">
                <p className="text-[11px] font-bold text-gray-500 mb-1.5">🔍 กรองดูยอดตามคน (กดเลือกชื่อ):</p>
                <div className="flex flex-wrap gap-2">
                  {/* อนาคตมีเด็กใหม่ เพิ่มชื่อในวงเล็บนี้ได้เลยครับ */}
                  {['พี่ยันต์', 'จักร กฤษณ์'].map(name => {
                    const isSelected = wageFilter.includes(name);
                    return (
                      <button
                        key={name}
                        onClick={() => {
                          if (isSelected) setWageFilter(wageFilter.filter(n => n !== name)); // เอาออก
                          else setWageFilter([...wageFilter, name]); // เพิ่มเข้าไป
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition shadow-sm ${isSelected ? 'bg-orange-500 text-white border-orange-600' : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-orange-50'}`}
                      >
                        {isSelected ? '✅' : '⬜'} {name}
                      </button>
                    )
                  })}
                  {wageFilter.length > 0 && (
                    <button onClick={() => setWageFilter([])} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-600 border border-red-200">
                      ❌ ล้าง
                    </button>
                  )}
                </div>
              </div>

              {/* รายการยอดเงิน */}
              <div className="overflow-y-auto flex-1 space-y-3 pr-1">
                {wageTransactions
                  .filter(t => t.status === wageTab)
                  .filter(t => {
                    // ถ้าไม่ได้ติ๊กใครเลย ให้โชว์ทั้งหมด
                    if (wageFilter.length === 0) return true;
                    
                    // 🐛 แก้ไข: ทำความสะอาดข้อความ ตัดรายละเอียดพื้นที่ทิ้งก่อนค้นหาชื่อ
                    let wStr = t.note || '';
                    if (wStr.includes('คนทำ:') && wStr.includes('(')) {
                        wStr = wStr.split('(')[0].replace('คนทำ:', '').trim();
                    } else if (wStr.includes('(')) {
                        wStr = wStr.split('(')[0].trim();
                    }
                    const jobWorkers = wStr.split(',').map(w => w.trim());
                    
                    // เช็คว่างานนี้มีคนที่ติ๊กเลือกอยู่ไหม
                    return wageFilter.some(fw => jobWorkers.includes(fw));
                  })
                  .map(tx => {
                  let workersStr = tx.note || '';
                  let detailsStr = '';
                  if (workersStr.includes('คนทำ:') && workersStr.includes('(')) {
                      const parts = workersStr.split('(');
                      workersStr = parts[0].replace('คนทำ:', '').trim();
                      detailsStr = parts[1].replace(')', '').trim();
                  } else if (workersStr.includes('(')) {
                      const parts = workersStr.split('(');
                      workersStr = parts[0].trim();
                      detailsStr = parts[1].replace(')', '').trim();
                  }
                  
                  // 🧮 สมองกลคำนวณการหารเงินอัตโนมัติ
                  const workerArray = workersStr.split(',').map(w => w.trim()).filter(w => w);
                  const divisor = workerArray.length > 0 ? workerArray.length : 1;
                  const totalAmount = Number(tx.total_amount);
                  
                  // คำนวณยอดที่จะแสดงบนจอ
                  let displayAmount = totalAmount;
                  if (wageFilter.length > 0) {
                    // นับว่ามีคนที่ติ๊กเลือกกี่คนในงานนี้ (เช่น ติ๊กพี่ยันต์คนเดียว = 1)
                    const matchingWorkersCount = wageFilter.filter(fw => workerArray.includes(fw)).length;
                    // เอา (ยอดเต็ม / จำนวนคนทั้งหมด) * จำนวนคนที่ติ๊ก
                    displayAmount = (totalAmount / divisor) * matchingWorkersCount;
                  }

                  return (
                    <div key={tx.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm relative">
                       <div className="flex justify-between items-start mb-3">
                         <div className="flex-1 pr-2">
                           <div className="flex flex-wrap gap-1.5 mb-2">
                             {workerArray.length > 0 ? workerArray.map((w, idx) => {
                               const isHighlighted = wageFilter.includes(w);
                               return (
                                 <span key={idx} className={`text-[11px] font-bold px-2 py-1 rounded-md border shadow-sm ${wageFilter.length === 0 ? 'bg-orange-100 text-orange-800 border-orange-200' : isHighlighted ? 'bg-blue-500 text-white border-blue-600' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>
                                   🧑‍🌾 {w}
                                 </span>
                               )
                             }) : (
                               <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-1 rounded-md border">ไม่ระบุชื่อ</span>
                             )}
                           </div>
                           
                           <p className="text-sm text-gray-700 font-semibold mb-1">
                             {detailsStr ? `📐 ${detailsStr}` : ''}
                           </p>
                           
                           <p className="text-[11px] text-gray-500 mt-1">
                             {wageTab === 'PAID' ? (
                               <span className="text-green-700 font-bold">✅ จ่ายเมื่อ: {tx.paid_at ? new Date(tx.paid_at).toLocaleString('th-TH') : new Date(tx.created_at).toLocaleString('th-TH')}</span>
                             ) : (
                               <span>📅 ลงสมุด: {new Date(tx.created_at).toLocaleString('th-TH')}</span>
                             )}
                           </p>
                         </div>

                         <div className="text-right shrink-0">
                           <span className={`block font-black text-2xl leading-none mb-1 ${wageTab === 'UNPAID' ? 'text-red-600' : 'text-green-600'}`}>
                             {displayAmount.toLocaleString()} <span className="text-sm">฿</span>
                           </span>
                           
                           {/* ป้ายกำกับอธิบายว่ายอดนี้คำนวณมายังไง */}
                           <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full font-bold ${wageFilter.length > 0 ? 'bg-blue-50 text-blue-700 border-blue-200 border' : 'bg-gray-100 text-gray-600 border-gray-200 border'}`}>
                             {wageFilter.length > 0 ? `ส่วนแบ่งของคนที่เลือก` : (divisor > 1 ? `งานหาร ${divisor} คน` : `งานเดี่ยว`)}
                           </span>
                         </div>
                       </div>

                       {/* 👇 กดเพื่อจ่ายเงิน (ซ่อนไม่ให้ลูกจ้างเห็น โชว์เฉพาะเถ้าแก่) 👇 */}
                       {userRole === 'BOSS' && wageTab === 'UNPAID' && (
                         wageFilter.length === 0 ? (
                           <button 
                             onClick={async () => {
                               if(!window.confirm('ยืนยันว่าเคลียร์ยอดนี้ให้ลูกจ้าง (ทุกคนในบิล) แล้วใช่ไหม?')) return;
                               try {
                                 const now = new Date();
                                 now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                                 const paid_at = now.toISOString();

                                 await fetch(`https://harvester-api-server.onrender.com/api/transactions/${tx.id}/status`, {
                                   method: 'PATCH',
                                   headers: { 'Content-Type': 'application/json' },
                                   body: JSON.stringify({ status: 'PAID', paid_at })
                                 });
                                 fetchWages(); 
                               } catch(e) { console.error(e); }
                             }}
                             className="w-full bg-gray-50 hover:bg-green-50 text-gray-600 hover:text-green-700 border border-gray-200 hover:border-green-300 font-bold py-2 rounded-lg text-sm transition flex items-center justify-center gap-2"
                           >
                             ✅ จ่ายเงินยอดเต็มบิลนี้แล้ว
                           </button>
                         ) : (
                           <div className="text-[10px] text-center text-red-400 font-bold bg-red-50 py-1.5 rounded-lg border border-red-100">
                             *กดยกเลิกตัวกรองชื่อ เพื่อกดปุ่มทำรายการจ่ายเงิน
                           </div>
                         )
                       )}
                    </div>
                  )
                })}
              </div>
              
              {/* ยอดรวมทั้งหมด (อัปเกรดให้ตรงกับตัวกรอง) */}
              <div className="mt-4 pt-4 border-t border-gray-200 shrink-0">
                <div className={`p-4 rounded-xl flex justify-between items-center shadow-inner ${wageTab === 'UNPAID' ? 'bg-gradient-to-r from-red-50 to-orange-50 border border-red-200' : 'bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200'}`}>
                  <div>
                    <span className={`block font-bold text-sm ${wageTab === 'UNPAID' ? 'text-red-900' : 'text-green-900'}`}>
                      {wageTab === 'UNPAID' ? 'ยอดที่ต้องเตรียมจ่าย:' : 'ยอดที่จ่ายไปแล้ว:'}
                    </span>
                    <span className={`text-[10px] font-bold ${wageTab === 'UNPAID' ? 'text-red-700' : 'text-green-700'}`}>
                      {wageFilter.length > 0 ? `*ยอดรวมเฉพาะคนที่เลือก` : `*ยอดรวมทุกคน (แบบเต็ม)`}
                    </span>
                  </div>
                  <span className={`font-black text-3xl drop-shadow-sm ${wageTab === 'UNPAID' ? 'text-red-600' : 'text-green-600'}`}>
                    {wageTransactions
                      .filter(t => t.status === wageTab)
                      .reduce((sum, tx) => {
                        if (wageFilter.length === 0) return sum + Number(tx.total_amount);
                        
                        // 🐛 แก้ไข: ทำความสะอาดข้อความก่อนนับจำนวนคน
                        let wStr = tx.note || '';
                        if (wStr.includes('คนทำ:') && wStr.includes('(')) {
                            wStr = wStr.split('(')[0].replace('คนทำ:', '').trim();
                        } else if (wStr.includes('(')) {
                            wStr = wStr.split('(')[0].trim();
                        }
                        
                        const jobWorkers = wStr.split(',').map(w => w.trim()).filter(w => w);
                        const divisor = jobWorkers.length > 0 ? jobWorkers.length : 1;
                        
                        // ถ้ารายการนี้ไม่มีคนที่เลือกเลย ให้ข้ามไป
                        const matchingCount = wageFilter.filter(fw => jobWorkers.includes(fw)).length;
                        if (matchingCount === 0) return sum;
                        
                        return sum + ((Number(tx.total_amount) / divisor) * matchingCount);
                      }, 0).toLocaleString()} <span className="text-lg">฿</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 💸 Popup ฟอร์มบันทึกค่าใช้จ่ายทั่วไป */}
        {showExpenseForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[200]">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
              
              {/* 👇 1. เพิ่ม Header ที่มีปุ่ม (X) ปิดหน้าต่าง 👇 */}
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-red-700 flex items-center gap-2">
                  {/* 👇 แก้ไขตรงบรรทัดนี้ครับ 👇 */}
                  <span>💸</span> {expenseData.id ? 'แก้ไขรายจ่าย' : 'บันทึกรายจ่าย'}
                </h2>
                <button 
                  onClick={() => setShowExpenseForm(false)} 
                  className="text-gray-400 hover:text-red-500 bg-gray-100 hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center font-bold text-lg transition"
                >
                  ✕
                </button>
              </div>
              
              <form onSubmit={handleExpenseSubmit} className="space-y-3">
                {/* หมวดหมู่ */}
                <div>
                  <label className="block text-gray-700 font-semibold mb-1 text-sm">หมวดหมู่ค่าใช้จ่าย</label>
                  <select 
                    className="w-full border p-2 rounded-lg bg-gray-50"
                    value={expenseData.category}
                    onChange={(e) => setExpenseData({...expenseData, category: e.target.value})}
                  >
                    <option value="น้ำมัน">⛽ น้ำมัน</option>
                    <option value="อะไหล่">🛞 อะไหล่</option>                    
                    <option value="ซ่อมรถ">🔧 ซ่อมรถ</option>
                    <option value="ค่าอาหาร">🍚 ค่าอาหาร</option>                    
                    <option value="ค่าเดินทาง">🚗 ค่าเดินทาง</option>
                    
                    {/* 👇 เปลี่ยนเป็นแบบแยกประเภท 👇 */}
                    <option value="ค่างวดรถเกี่ยว">🚜 ค่างวดรถเกี่ยว</option>
                    <option value="ค่างวดรถ 10 ล้อ">🚚 ค่างวดรถ 10 ล้อ</option>
                    
                    <option value="อื่นๆ">📦 อื่นๆ</option>
                  </select>
                </div>

                {/* จำนวนเงิน & วันที่ */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 font-semibold mb-1 text-sm">จำนวนเงิน (บาท)</label>
                    <input type="number" required className="w-full border border-red-300 bg-red-50 text-red-900 font-bold p-2 rounded-lg" placeholder="0.00" value={expenseData.total_amount} onChange={e => setExpenseData({...expenseData, total_amount: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-gray-700 font-semibold mb-1 text-sm">วันที่จ่าย</label>
                    <input type="datetime-local" className="w-full border p-2 rounded-lg text-sm" value={expenseData.transaction_date} onChange={e => setExpenseData({...expenseData, transaction_date: e.target.value})} />
                  </div>
                </div>

                {/* ผูกกับรถ */}
                <div>
                  <label className="block text-gray-700 font-semibold mb-1 text-sm">ผูกกับรถ (ถ้ามี)</label>
                  <select className="w-full border p-2 rounded-lg bg-white" value={expenseData.vehicle_id} onChange={e => setExpenseData({...expenseData, vehicle_id: e.target.value})}>
                    <option value="">-- ไม่ระบุ --</option>
                    {vehicles.map(v => <option key={v.id} value={v.id}>🚜 {v.name}</option>)}
                  </select>
                </div>

                {/* ผู้จ่าย & หมายเหตุ */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gray-700 font-semibold mb-1 text-sm">ผู้จ่ายเงิน</label>
                      <input type="text" placeholder="ระบุผู้จ่าย" className="w-full border p-2 rounded-lg text-sm" value={expenseData.spender_name} onChange={e => setExpenseData({...expenseData, spender_name: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-gray-700 font-semibold mb-1 text-sm">หมายเหตุ</label>
                      <input type="text" placeholder="รายละเอียดเพิ่มเติม" className="w-full border p-2 rounded-lg text-sm" value={expenseData.note} onChange={e => setExpenseData({...expenseData, note: e.target.value})} />
                    </div>
                </div>

                {/* แนบรูปใบเสร็จ */}
                <div className="mt-3 bg-gray-50 p-3 rounded-lg border border-dashed border-gray-300">
                   <label className="block text-gray-700 font-semibold mb-2 text-sm">🧾 แนบรูปใบเสร็จ</label>
                   
                   <div className="flex gap-2">
                     <label className="flex-1 bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 py-2 rounded-xl text-xs font-bold text-center cursor-pointer transition shadow-sm flex flex-col items-center justify-center gap-1">
                       <span className="text-xl">📸</span>
                       <span>ถ่ายรูปใบเสร็จ</span>
                       <input 
                         type="file" 
                         accept="image/*" 
                         capture="environment" 
                         onChange={e => setExpenseData({...expenseData, receipt: e.target.files[0]})} 
                         className="hidden" 
                       />
                     </label>

                     <label className="flex-1 bg-white text-gray-700 border border-gray-300 hover:bg-gray-100 py-2 rounded-xl text-xs font-bold text-center cursor-pointer transition shadow-sm flex flex-col items-center justify-center gap-1">
                       <span className="text-xl">🖼️</span>
                       <span>เลือกจากคลัง</span>
                       <input 
                         type="file" 
                         accept="image/*" 
                         onChange={e => setExpenseData({...expenseData, receipt: e.target.files[0]})} 
                         className="hidden" 
                       />
                     </label>
                   </div>

                   {expenseData.receipt && (
                     <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded-lg flex justify-between items-center text-xs text-green-800 font-bold shadow-inner">
                       <span className="truncate max-w-[80%] flex items-center gap-1">
                         ✅ {expenseData.receipt.name || 'แนบรูปภาพเรียบร้อย'}
                       </span>
                       <button 
                         type="button" 
                         onClick={() => setExpenseData({...expenseData, receipt: null})} 
                         className="text-red-500 hover:text-red-700 px-2 py-1 bg-white rounded-md border border-red-100 shadow-sm"
                       >
                         ✕ ลบ
                       </button>
                     </div>
                   )}

                   {/* 👇 วางโค้ดรูปเก่าตรงนี้ครับ (ต่อจากบล็อกด้านบน) 👇 */}
                   {!expenseData.receipt && expenseData.existing_receipt_url && (
                     <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded-lg flex justify-between items-center text-xs text-blue-800 font-bold shadow-inner">
                       <span className="flex items-center gap-2">
                         <img src={expenseData.existing_receipt_url} alt="old-receipt" className="w-8 h-8 object-cover rounded" />
                         มีรูปใบเสร็จเดิมอยู่แล้ว
                       </span>
                     </div>
                   )}
                </div> 

                {/* 👇 2. เพิ่มกลุ่มปุ่ม ยกเลิก / บันทึกรายจ่าย ไว้ด้านล่างสุด 👇 */}
                <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
                  <button 
                    type="button" 
                    onClick={() => setShowExpenseForm(false)} 
                    className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-2.5 rounded-xl font-bold transition"
                  >
                    ยกเลิก
                  </button>
                  <button 
                    type="submit" 
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl font-bold shadow-lg transition"
                  >
                    บันทึกรายจ่าย
                  </button>
                </div>

              </form>
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