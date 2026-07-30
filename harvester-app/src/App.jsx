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

function App() {
  const [jobs, setJobs] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [activeTab, setActiveTab] = useState('active') 
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [customersList, setCustomersList] = useState([])
  
  const [editingId, setEditingId] = useState(null);
  const [currentCoords, setCurrentCoords] = useState([15.7012, 101.1012]); 

  const [formData, setFormData] = useState({
    customer_name: '', phone: '', address_note: '', crop_type: 'ข้าว',
    area_size: '', job_date: '', latitude: '', longitude: '',
    vehicle_id: 0, boundaries: [] 
  })

  // 📅 State สำหรับปฏิทิน
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDayJobs, setSelectedDayJobs] = useState(null); 

  // 🚜 State สำหรับจัดการรถเกี่ยว
  const [vehicles, setVehicles] = useState([]);
  const [showVehicleManager, setShowVehicleManager] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ name: '', driver_name: '' });

// ฟังก์ชันดึงรายชื่อรถจากฐานข้อมูล
  const fetchVehicles = async () => {
    try {
      const res = await fetch('https://harvester-api-server.onrender.com/api/vehicles');
      const data = await res.json();
      setVehicles(data);
    } catch (err) {
      console.error("ดึงข้อมูลรถไม่ได้:", err);
    }
  };

  useEffect(() => { 
    fetchJobs();
    fetchVehicles(); // เรียกใช้ตอนเปิดแอป
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
        fetchVehicles(); // โหลดข้อมูลใหม่มาแสดง
        
        // 💡 จุดที่ 2.3: เปลี่ยนจาก phone เป็น driver_name เพื่อล้างค่าให้ถูกต้อง
        setNewVehicle({ name: '', driver_name: '' }); 
      }
    } catch (err) {
      alert("เพิ่มรถไม่สำเร็จ");
    }
  };

  const handleDeleteVehicle = async (id) => {
    if(!window.confirm('⚠️ ลบรถคันนี้ออกจากระบบหรือไม่?')) return;
    try {
      const res = await fetch(`https://harvester-api-server.onrender.com/api/vehicles/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchVehicles();
        if(formData.vehicle_id === id) setFormData({...formData, vehicle_id: 0});
      }
    } catch (err) {
      alert("ลบรถไม่สำเร็จ");
    }
  };

  const saveVehicles = (updatedVehicles) => {
    setVehicles(updatedVehicles);
    localStorage.setItem('harvester_vehicles', JSON.stringify(updatedVehicles));
  };

  const fetchJobs = () => {
    fetch('https://harvester-api-server.onrender.com/api/jobs')
      .then(res => res.json())
      .then(data => {
        setJobs(data);
        const uniqueCustomers = [];
        const phoneSet = new Set();
        data.forEach(job => {
          if (job.customers && !phoneSet.has(job.customers.phone)) {
            phoneSet.add(job.customers.phone);
            uniqueCustomers.push(job.customers);
          }
        });
        setCustomersList(uniqueCustomers);
      })
      .catch(err => console.error("ดึงข้อมูลไม่ได้:", err))
  }

  useEffect(() => { fetchJobs() }, [])

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => { setCurrentCoords([position.coords.latitude, position.coords.longitude]); },
        (error) => { console.log("รอรับพิกัด GPS..."); }
      );
    }
  }, []);

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
      address_note: job.customers?.address_note || '',
      crop_type: job.crop_type || 'ข้าว',
      area_size: job.area_size || '',
      job_date: formattedDate,
      latitude: job.latitude || '',
      longitude: job.longitude || '',
      vehicle_id: job.vehicles?.id || job.vehicle_id || 0,
      boundaries: job.boundaries || []
    });
    if (job.latitude && job.longitude) setCurrentCoords([job.latitude, job.longitude]);
    setShowAddForm(true);
  };

  const openAddFormForDate = (date) => {
    const d = new Date(date);
    d.setHours(8, 0, 0, 0);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    setEditingId(null);
    setFormData({ customer_name: '', phone: '', address_note: '', crop_type: 'ข้าว', area_size: '', job_date: d.toISOString().slice(0, 16), latitude: '', longitude: '', vehicle_id: 0, boundaries: [] });
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
        setFormData({ customer_name: '', phone: '', address_note: '', crop_type: 'ข้าว', area_size: '', job_date: '', latitude: '', longitude: '', vehicle_id: 0, boundaries: [] });
        fetchJobs();
      } else { alert('❌ บันทึกไม่สำเร็จ'); }
    } catch (err) { console.error(err); alert('❌ เกิดข้อผิดพลาดเซิร์ฟเวอร์'); }
  }

  const updateStatus = async (id, newStatus) => {
    try {
      const response = await fetch(`https://harvester-api-server.onrender.com/api/jobs/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
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

  const activeJobs = jobs.filter(j => j.status !== 'DONE').sort((a, b) => {
    const priority = { 'IN_PROGRESS': 1, 'PAUSED': 2, 'PENDING': 3 };
    if (priority[a.status] !== priority[b.status]) return priority[a.status] - priority[b.status];
    return new Date(a.job_date) - new Date(b.job_date);
  });
  const historyJobs = jobs.filter(j => j.status === 'DONE').sort((a, b) => new Date(b.job_date) - new Date(a.job_date));
  const displayJobs = activeTab === 'active' ? activeJobs : historyJobs;

  const searchKeyword = formData.customer_name.trim().toLowerCase();
  
  // เช็กว่าข้อมูลในช่องพิมพ์ ตรงเป๊ะกับลูกค้าในฐานข้อมูลแล้วหรือยัง (แปลว่าผู้ใช้เพิ่งกดเลือก)
  const isExactMatch = customersList.some(c => c.name === formData.customer_name && c.phone === formData.phone);

  // ถ้าพิมพ์ค้นหาอยู่ และ "ยังไม่ได้เลือกจนตรงเป๊ะ" ถึงจะแสดงกล่อง
  const filteredCustomers = (searchKeyword.length > 0 && !isExactMatch) ? customersList.filter(c => {
    const nameLower = c.name.toLowerCase();
    const phoneStr = c.phone;
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
        <h1 className="text-2xl font-bold text-gray-800 mb-4 text-center shadow-sm bg-white p-4 rounded-xl">🌾 ระบบคิวรถเกี่ยว</h1>
        
        <div className="flex bg-white rounded-xl p-1 mb-5 shadow-sm border border-gray-200">
          <button onClick={() => setActiveTab('active')} className={`flex-1 py-2 rounded-lg font-bold text-xs transition-colors ${activeTab === 'active' ? 'bg-green-100 text-green-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}>🚜 คิวงาน</button>
          <button onClick={() => setActiveTab('calendar')} className={`flex-1 py-2 rounded-lg font-bold text-xs transition-colors ${activeTab === 'calendar' ? 'bg-orange-100 text-orange-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}>📅 ปฏิทิน</button>
          <button onClick={() => setActiveTab('history')} className={`flex-1 py-2 rounded-lg font-bold text-xs transition-colors ${activeTab === 'history' ? 'bg-gray-200 text-gray-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}>📋 ประวัติ</button>
        </div>

        {activeTab === 'calendar' && renderCalendar()}

        {activeTab !== 'calendar' && displayJobs.length === 0 && (
          <div className="text-center text-gray-500 mt-10"><p className="text-4xl mb-2">🍃</p><p>ยังไม่มีข้อมูลในหน้านี้ครับ</p></div>
        )}

        {activeTab !== 'calendar' && (
          <div className="space-y-4">
            {displayJobs.map((job) => {
              const statusObj = getStatusDisplay(job.status);
              const isExpanded = expandedId === job.id;
              const jobDateTime = formatDate(job.job_date);
              const assignedVehicle = vehicles.find(v => v.id === job.vehicle_id);

              return (
                <div key={job.id} className="bg-white rounded-xl p-5 shadow-md border border-gray-200">
                  <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-2 mb-3"><div className="text-indigo-800 font-bold text-sm flex justify-between px-1"><span>📅 {jobDateTime.date}</span><span>⏰ {jobDateTime.time} น.</span></div></div>
                  <div className="cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : job.id)}>
                    <div className="flex justify-between items-start mb-3">
                      <div><h2 className="text-lg font-bold text-gray-900">{job.customers?.name || 'ไม่ระบุชื่อ'}</h2><p className="text-sm text-gray-500">📞 {job.customers?.phone || '-'}</p></div>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${statusObj.color}`}>{statusObj.text}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                      <div className="bg-gray-50 p-2 rounded-lg"><span className="block text-gray-500 text-xs">ประเภทพืช</span><span className="font-semibold text-gray-800">{job.crop_type}</span></div>
                      <div className="bg-gray-50 p-2 rounded-lg"><span className="block text-gray-500 text-xs">พื้นที่</span><span className="font-semibold text-gray-800">{job.area_size} ไร่</span></div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-300">
                      <div className="bg-yellow-50 p-3 rounded-lg text-sm text-gray-800 mb-3 border border-yellow-200"><span className="font-bold text-yellow-700">📍 หมายเหตุ:</span><br/>{job.customers?.address_note || 'ไม่มีข้อมูล'}</div>
                      <div className="flex gap-2 pt-2 border-t">
                        {job.status !== 'IN_PROGRESS' && <button onClick={() => updateStatus(job.id, 'IN_PROGRESS')} className="flex-1 bg-blue-500 text-white text-xs py-2 rounded-lg font-bold">▶️ เริ่มเกี่ยว</button>}
                        {job.status !== 'DONE' && <button onClick={() => updateStatus(job.id, 'DONE')} className="flex-1 bg-green-500 text-white text-xs py-2 rounded-lg font-bold">✅ เสร็จสิ้น</button>}
                        {job.status !== 'PENDING' && <button onClick={() => updateStatus(job.id, 'PENDING')} className="flex-1 bg-yellow-500 text-white text-xs py-2 rounded-lg font-bold">⏳ รอคิว</button>}
                      </div>
                      <div className="flex gap-2 pt-2 border-t mt-3">
                        <button onClick={(e) => { e.stopPropagation(); openEditForm(job); }} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white text-xs py-2 rounded-lg font-bold transition">✏️ แก้ไขข้อมูล</button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteJob(job.id); }} className="flex-1 bg-red-500 hover:bg-red-600 text-white text-xs py-2 rounded-lg font-bold transition">🗑️ ลบงาน</button>
                      </div>
                    </div>
                  )}
                  {/* 👇 ส่วนที่แก้ไข: เพิ่มชื่อคนขับไว้ใต้ชื่อรถ */}
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
                  {/* 👆 สิ้นสุดส่วนที่แก้ไข */}
                </div>
              )
            })}
          </div>
        )}

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
                    <p className="text-xs text-gray-500 mt-1">⏰ {new Date(job.job_date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น. | พื้นที่: {job.area_size} ไร่</p>
                  </div>
                ))}
              </div>
              <button onClick={() => { setSelectedDayJobs(null); openAddFormForDate(selectedDayJobs.date); }} className="w-full mt-4 bg-orange-500 text-white py-2 rounded-lg font-bold shadow-md">+ เพิ่มคิวงานวันนี้</button>
            </div>
          </div>
        )}

        {activeTab !== 'calendar' && (
          <button 
            onClick={() => { 
              setEditingId(null); 
              setFormData({ customer_name: '', phone: '', address_note: '', crop_type: 'ข้าว', area_size: '', job_date: '', latitude: '', longitude: '', vehicle_id: 0, boundaries: [] });
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
                        <div key={idx} onMouseDown={() => setFormData({ ...formData, customer_name: cust.name, phone: cust.phone })} className="p-2 hover:bg-green-50 cursor-pointer border-b flex justify-between">
                          <span className="font-semibold text-gray-800">{cust.name}</span>
                          <span className="text-gray-500 text-xs">📞 {cust.phone}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-gray-700 mb-1 font-semibold">เบอร์โทรศัพท์</label>
                  <input type="tel" required className="w-full border p-2 rounded-lg bg-gray-50" placeholder="08xxxxxxxx" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} />
                </div>

                <div>
                  <label className="block text-gray-700 mb-1 font-semibold">วันเวลานัดหมาย</label>
                  <input type="datetime-local" required className="w-full border p-2 rounded-lg" value={formData.job_date} onChange={(e) => setFormData({...formData, job_date: e.target.value})} />
                </div>

                {/* 🚜 จัดการและเลือกรถเกี่ยว (แบบไดนามิกตัวเดียวจบ) */}
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
                  <label className="block text-gray-700 mb-1 font-semibold">หมายเหตุ / จุดสังเกต</label>
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
                    <input type="number" step="0.01" required className="w-full border p-2 rounded-lg bg-green-50 font-bold text-green-800" placeholder="0.00" value={formData.area_size} onChange={(e) => setFormData({...formData, area_size: e.target.value})} />
                  </div>
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
                      {/* เปลี่ยนตรงนี้ให้โชว์ชื่อคนขับ */}
                      {v.driver_name && <p className="text-xs text-gray-500">👨‍🌾 คนขับ: {v.driver_name}</p>}
                    </div>
                    <button onClick={() => handleDeleteVehicle(v.id)} className="bg-red-100 text-red-600 px-2 py-1 rounded-md text-xs font-bold">ลบ</button>
                  </div>
                ))}
              </div>
              <div className="bg-orange-50 p-3 rounded-lg border border-orange-200">
                <h3 className="font-bold text-orange-800 mb-2 text-sm">➕ เพิ่มรถคันใหม่</h3>
                <input type="text" placeholder="ชื่อรถ (เช่น คันที่ 1)" className="w-full border p-2 rounded-lg mb-2 text-sm" value={newVehicle.name} onChange={e => setNewVehicle({...newVehicle, name: e.target.value})} />
                {/* เปลี่ยนช่องนี้เป็นให้กรอกชื่อคนขับ */}
                <input type="text" placeholder="ชื่อคนขับ (ถ้ามี)" className="w-full border p-2 rounded-lg mb-2 text-sm" value={newVehicle.driver_name} onChange={e => setNewVehicle({...newVehicle, driver_name: e.target.value})} />
                
                <button onClick={handleAddVehicle} className="w-full bg-orange-500 text-white font-bold py-2 rounded-lg text-sm">เพิ่มข้อมูล</button>
              </div>
            </div>
          </div>
        )}

        {/* 🗺️ หน้าจอแผนที่เต็มจอ */}
        {showMapPicker && (
          <div className="fixed inset-0 bg-black z-[200] flex flex-col">
             <LingStyleMap 
                initialCenter={currentCoords} 
                onConfirm={handleMapConfirm} 
                onCancel={() => setShowMapPicker(false)} 
             />
          </div>
        )}
      </div>
    </div>
  )
}

export default App