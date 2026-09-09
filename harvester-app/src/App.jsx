import { useEffect, useState, useRef, useMemo } from 'react'
import L from 'leaflet'
import * as turf from '@turf/turf'
import 'leaflet/dist/leaflet.css'

// 🛰️ GPS V3.6 — plot→queue linking: create queue from GPS plot or link only unfinished jobs.
// 🧽 Route Eraser — tap individual route segments to erase/restore; no start/end range selection.
// Turf 6/7 compatibility: https://turfjs.org/docs/api/difference
const plotClip = (operation, a, b) => {
  if (!a || !b) return operation === 'difference' ? a : null;
  try { return turf[operation](turf.featureCollection([a, b])); }
  catch (_) { return turf[operation](a, b); }
};

const plotThaiArea = (sqMeters) => {
  const value = Math.max(0, Number(sqMeters) || 0);

  // UI แสดงแค่ "ไร่ + งาน" ให้สะอาดและอ่านง่าย
  // เก็บความละเอียดจริงไว้ใน rawRai / sqMeters เหมือนเดิม ไม่กระทบการคำนวณ
  const roundedTotalNgan = Math.round((value / 400) * 10) / 10; // 0.1 งาน ≈ 40 ตร.ม.
  const rai = Math.floor(roundedTotalNgan / 4);
  const nganValue = Math.max(0, roundedTotalNgan - (rai * 4));
  const ngan = Number(nganValue.toFixed(1));
  return { text: `${rai} ไร่ ${ngan} งาน`, rawRai: value / 1600, sqMeters: value };
};

const formatRaiNgan = (raiValue) => plotThaiArea(Math.max(0, Number(raiValue) || 0) * 1600).text;

// ✍️ ช่องกรอกพื้นที่แบบไทย: ไร่ + งาน
// Backend/API ยังเก็บเป็น "ไร่ทศนิยม" เหมือนเดิม เพื่อไม่ต้องแก้ server/database.
// UI รับงานละเอียด 0.1 งาน และ normalize อัตโนมัติ เช่น 4 งาน => +1 ไร่.
const normalizeRaiNganValue = (raiValue) => {
  const n = Math.max(0, Number(raiValue) || 0);
  return Math.round(n * 40) / 40; // 0.1 งาน = 0.025 ไร่
};

const splitRaiNganValue = (raiValue) => {
  if (raiValue === '' || raiValue === null || raiValue === undefined) return { rai: '', ngan: '' };
  const n = normalizeRaiNganValue(raiValue);
  const totalNgan = Math.round(n * 40) / 10;
  let rai = Math.floor(totalNgan / 4);
  let ngan = Number((totalNgan - rai * 4).toFixed(1));
  if (ngan >= 4) { rai += 1; ngan = 0; }
  return { rai: String(rai), ngan: String(ngan) };
};

const formatSignedRaiNgan = (raiValue) => {
  const n = Number(raiValue) || 0;
  if (Math.abs(n) < 0.000001) return '0 ไร่ 0 งาน';
  return `${n > 0 ? '+' : '-'}${formatRaiNgan(Math.abs(n))}`;
};

const cleanPhoneForUi = (phone) => {
  const value = String(phone || '').trim();
  return !value || value.startsWith('ไม่มี-') ? '' : value;
};

// Audit/check รุ่นเก่าอาจเก็บข้อความเป็น "6.37 ไร่"
// แปลงเฉพาะข้อความเก่าให้เป็น "6 ไร่ 1.5 งาน" โดยไม่แตะข้อความที่เป็น ไร่+งาน อยู่แล้ว
const formatAreaText = (value) => String(value || '').replace(
  /(\d+(?:\.\d+)?)\s*ไร่(?!\s*\d+(?:\.\d+)?\s*งาน)/g,
  (_, rai) => formatRaiNgan(Number(rai))
);

const auditActionLabel = (action) => ({
  ROUND_SAVED: '🌾 ปิดรอบวันนี้',
  FINALIZED: '🏁 จบงานทั้งหมด',
  BILLING_AREA_CHANGED: '🤝 ปรับพื้นที่คิดเงิน',
  ESTIMATE_CHANGED: '🗣️ ปรับพื้นที่ประมาณ',
  JOB_CREATED: '📝 สร้างคิวงาน',
  JOB_EDITED: '✏️ แก้ไขคิวงาน',
  STATUS_CHANGED: '🔄 เปลี่ยนสถานะงาน',
  PAYMENT_STATUS_CHANGED: '💰 เปลี่ยนสถานะการเงิน'
}[action] || action || 'รายการแก้ไข');

function RaiNganInput({ value, onChange, disabled = false, autoFocus = false, className = '' }) {
  const parts = splitRaiNganValue(value);

  const commit = (raiText, nganText) => {
    if ((raiText === '' || raiText == null) && (nganText === '' || nganText == null)) {
      onChange('');
      return;
    }
    const rai = Math.max(0, Math.floor(Number(raiText) || 0));
    const ngan = Math.max(0, Number(nganText) || 0);
    const totalRai = normalizeRaiNganValue(rai + (ngan / 4));
    onChange(String(Number(totalRai.toFixed(6))));
  };

  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      <label className="block">
        <span className="block text-[11px] font-black text-gray-600 mb-1">ไร่</span>
        <input
          autoFocus={autoFocus}
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          disabled={disabled}
          className="w-full border-2 border-gray-300 rounded-xl p-3 bg-white text-gray-900 font-black text-lg outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-100"
          value={parts.rai}
          onChange={(e) => commit(e.target.value, parts.ngan)}
          placeholder="0"
        />
      </label>
      <label className="block">
        <span className="block text-[11px] font-black text-gray-600 mb-1">งาน</span>
        <input
          type="number"
          min="0"
          step="0.1"
          inputMode="decimal"
          disabled={disabled}
          className="w-full border-2 border-gray-300 rounded-xl p-3 bg-white text-gray-900 font-black text-lg outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-100"
          value={parts.ngan}
          onChange={(e) => commit(parts.rai, e.target.value)}
          placeholder="0"
        />
      </label>
    </div>
  );
}

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

const hydratePlots = (items) => (Array.isArray(items) ? items : []).map(plot => {
  try { return refreshPlotMetrics(plot); }
  catch (error) { return { ...plot, geometryError: error.message }; }
});

const plotNewId = () => globalThis.crypto?.randomUUID?.() || `hole-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const plotPolygonParts = (feature) => !feature?.geometry ? []
  : feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates]
  : feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [];

// Suggest only closed gaps in the buffered harvesting tracks. Narrow lane gaps,
// small GPS noise and gaps touching the field edge do not become suggestions.
// A closed gap may still be unharvested rice: nothing is deducted until approved.
const detectPlotHoles = (plot, coverage, headWidth) => {
  if (!coverage) return plot.holeSuggestions || [];
  const { outer } = plotGeometry(plot);
  const suggestions = [...(plot.holeSuggestions || [])];
  const known = [...(plot.holes || []), ...suggestions].map(h => plotRingFeature(h.points));
  const width = Math.max(1, Number(headWidth) || 3);
  const minSqM = Math.max(80, width * width * 6);
  for (const poly of plotPolygonParts(coverage)) {
    for (const rawRing of poly.slice(1)) {
      if (suggestions.length >= 60) break;
      try {
        let gap = plotRingFeature(rawRing.slice(0, -1).map(([lng, lat]) => ({ lat, lng })));
        const sqM = turf.area(gap);
        if (sqM < minSqM) continue;
        const core = turf.buffer(gap, -Math.max(2, width), { units: 'meters', steps: 4 });
        if (!core || turf.area(core) < minSqM * 0.1) continue;
        const inside = plotClip('intersect', outer, gap);
        if (!inside || turf.area(inside) < sqM * 0.995 || turf.lineIntersect(gap, outer).features.length) continue;
        const driven = plotClip('intersect', gap, coverage);
        if (driven && turf.area(driven) > sqM * 0.03) continue;
        if (known.some(other => {
          const overlap = plotClip('intersect', other, gap);
          return overlap && turf.area(overlap) > Math.min(turf.area(other), sqM) * 0.5;
        })) continue;
        const simpler = turf.simplify(gap, { tolerance: 0.000005, highQuality: true });
        // Simplification must not expand a proposal into the harvesting tracks.
        const added = plotClip('difference', simpler, gap);
        if ((!added || turf.area(added) < 0.5) && Math.abs(turf.area(simpler) - sqM) < sqM * 0.03) gap = simpler;
        const points = gap.geometry.coordinates[0].slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
        plotRingFeature(points);
        suggestions.push({ id: plotNewId(), points, status: 'pending', source: 'AUTO_GPS_HOLE', min_area_m2: minSqM });
        known.push(gap);
      } catch (_) { /* Skip unreliable candidates, never silently deduct them. */ }
    }
  }
  return suggestions;
};

// 🛰️ GPS V3.4 Auto Multi-Plot + Reviewed Holes + Net Progress
// 🗺️ ระบบแผนที่เป้าเล็ง + ค้นหาสถานที่อัจฉริยะ + แผนที่ดาวเทียมมีป้ายชื่อ
function LingStyleMap({ initialCenter, onConfirm, onCancel }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layerGroup = useRef(null);
  const [points, setPoints] = useState([]);
  const [areaInfo, setAreaInfo] = useState({ text: '0 ไร่ 0 งาน', rawRai: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [foundLocation, setFoundLocation] = useState(''); 

  const calculateThaiArea = (sqMeters) => {
    const area = plotThaiArea(sqMeters);
    return { text: area.text, rawRai: (sqMeters / 1600).toFixed(2) };
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
          if (latlngs.length >= 3) {
            try {
              const coords = latlngs.map(([lat, lng]) => [lng, lat]);
              coords.push(coords[0]);
              setAreaInfo(calculateThaiArea(turf.area(turf.polygon([coords]))));
            } catch (_) {}
          }
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

      <div className="absolute top-28 left-1/2 transform -translate-x-1/2 z-[400] bg-white/95 backdrop-blur px-5 py-2 rounded-full shadow-lg border border-amber-300">
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

// Stable edge identities preserve gaps: excluded edges are never joined again.
const gpsPointKey = p => p?.id != null ? String(p.id) : `${p?.created_at}|${p?.latitude}|${p?.longitude}`;
const gpsEdgeKey = (a, b) => `${gpsPointKey(a)}>${gpsPointKey(b)}`;
const gpsEdgeInBox = (a, b, bounds) => {
  let lo = 0, hi = 1;
  for (const [field, min, max] of [['latitude', bounds.south, bounds.north], ['longitude', bounds.west, bounds.east]]) {
    const start = Number(a[field]), delta = Number(b[field]) - start;
    if (!Number.isFinite(start) || !Number.isFinite(delta)) return false;
    if (delta === 0) { if (start < min || start > max) return false; }
    else { const t1 = (min - start) / delta, t2 = (max - start) / delta;
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); if (lo > hi) return false; }
  }
  return true;
};

// 🗺️ แผนที่ติดตามรถเกี่ยว + วาดแปลง + บันทึกถาวร + Auto Follow แบบควบคุมได้
function TrackingMap({ pathData, vehicleId, workDate, trackingMode, focusRequest, isMapFullScreen, setIsMapFullScreen, isFetchingGps, jobs = [], customers = [], onPlotsSaved, onOpenJob, onQueueCreated, focusPlot }) {
  const [linkReview, setLinkReview] = useState(null);
  const [linkNewQueueDrafts, setLinkNewQueueDrafts] = useState({});
  const [linkCreatingQueue, setLinkCreatingQueue] = useState(false);
  const [plotRevision, setPlotRevision] = useState(null);
  const [plotReload, setPlotReload] = useState(0);

  const activeLinkJobs = useMemo(() => jobs.filter(j => j.status !== 'DONE').sort((a,b) => {
    const priority = { IN_PROGRESS: 1, PAUSED: 2, PENDING: 3 };
    const pa = priority[a.status] || 9, pb = priority[b.status] || 9;
    if (pa !== pb) return pa - pb;
    return new Date(a.job_date || 0) - new Date(b.job_date || 0);
  }), [jobs]);

  const openLinkReview = (all, indices, after = null) => {
    setLinkNewQueueDrafts({}); setAutoFollow(false); setMobileToolsOpen(false);
    setLinkReview({all:all.map(p => ({...p,id:p.id || plotNewId()})),indices,after,scope:plotScopeRef.current});
  };

  const setPlotJob = (index, value) => {
    const job=activeLinkJobs.find(j => String(j.id) === value);
    const plotId = linkReview?.all?.[index]?.id;
    if (plotId) setLinkNewQueueDrafts(d => { const next={...d}; delete next[plotId]; return next; });
    setLinkReview(review => ({...review,all:review.all.map((p,i) => i!==index ? p : {...p,job_id:job ? Number(job.id) : null,name:job ? `${job.customers?.name || 'ลูกค้า'} — แปลงที่ ${index+1}` : `แปลงที่ ${index+1}`})}));
  };

  const setNewQueueDraft = (plotId, patch) => {
    setLinkNewQueueDrafts(d => ({
      ...d,
      [plotId]: {
        ...(d[plotId] || { query:'', customer_name:'', phone:'', create_new:false }),
        ...patch
      }
    }));
  };

  const selectCustomerForNewQueue = (index, customer) => {
    const plot = linkReview?.all?.[index];
    if (!plot) return;
    setNewQueueDraft(plot.id, {
      query: customer.name || customer.phone || '',
      customer_name: customer.name || '',
      phone: customer.phone || '',
      create_new: true
    });
    setLinkReview(review => ({...review,all:review.all.map((p,i)=>i===index?{...p,job_id:null,name:`${customer.name || 'ลูกค้า'} — แปลงที่ ${index+1}`}:p)}));
  };

  const chooseNewCustomerNameForPlot = (index, typedName) => {
    const plot = linkReview?.all?.[index];
    const clean = String(typedName || '').trim();
    if (!plot || !clean) return;
    setNewQueueDraft(plot.id, { query:clean, customer_name:clean, phone:'', create_new:true });
    setLinkReview(review => ({...review,all:review.all.map((p,i)=>i===index?{...p,job_id:null,name:`${clean} — แปลงที่ ${index+1}`}:p)}));
  };

  const queueDateTimeFromMapDate = () => {
    const today = new Date();
    const localY = today.getFullYear();
    const localM = String(today.getMonth()+1).padStart(2,'0');
    const localD = String(today.getDate()).padStart(2,'0');
    const localDate = `${localY}-${localM}-${localD}`;
    if (workDate === localDate) return `${workDate}T${String(today.getHours()).padStart(2,'0')}:${String(today.getMinutes()).padStart(2,'0')}`;
    return `${workDate}T08:00`;
  };

  const createQueueFromPlotGroup = async (group) => {
    const firstPlot = group.plots[0];
    const center = firstPlot.center || centerFromPoints(firstPlot.points);
    const totalArea = group.plots.reduce((sum,p)=>sum + Math.max(0, Number(p.area?.rawRai) || 0), 0);
    const payload = {
      customer_name: group.customer_name.trim(),
      phone: String(group.phone || '').trim(),
      address_note: '',
      crop_type: 'ข้าว',
      // คิวที่เกิดจาก GPS ยังไม่มี "ลูกค้าแจ้งประมาณ" — GPS เป็นคนละข้อมูลกับ area_size
      area_size: null,
      job_date: queueDateTimeFromMapDate(),
      latitude: center?.lat || '',
      longitude: center?.lng || '',
      vehicle_id: Number(vehicleId) || 0,
      boundaries: [],
      price_per_rai: '',
      total_price: '',
      payment_status: 'UNPAID'
    };
    const response = await fetch('https://harvester-api-server.onrender.com/api/jobs', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'สร้างคิวใหม่ไม่สำเร็จ');
    const jobId = Number(data?.data?.[0]?.id || data?.data?.id);
    if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new Error('สร้างคิวแล้ว แต่ไม่ได้รับ Job ID กลับมา');
    return jobId;
  };

  const confirmPlotLinks = async () => {
    const review=linkReview;
    if(!review || review.scope!==plotScopeRef.current || linkCreatingQueue) return;

    // แปลงที่พิมพ์ชื่อลูกค้า = สร้างคิวใหม่จากยอด GPS ของแปลงนั้น
    // ถ้าหลายแปลงพิมพ์ชื่อ+เบอร์เดียวกัน จะสร้างเพียง 1 คิว แล้วผูกหลายแปลงเข้าคิวเดียวกัน
    const groups = new Map();
    for (const index of review.indices) {
      const plot = review.all[index];
      const draft = linkNewQueueDrafts[plot.id];
      const name = String(draft?.customer_name || '').trim();
      if (!draft?.create_new || !name) continue;
      const phone = String(draft?.phone || '').trim();
      const key = `${name.toLocaleLowerCase('th-TH')}|${phone}`;
      if (!groups.has(key)) groups.set(key,{customer_name:name,phone,indices:[],plots:[]});
      groups.get(key).indices.push(index); groups.get(key).plots.push(plot);
    }

    const createdJobIds = [];
    let finalPlots = review.all.map(p=>({...p}));
    try {
      setLinkCreatingQueue(true);
      for (const group of groups.values()) {
        const jobId = await createQueueFromPlotGroup(group);
        createdJobIds.push(jobId);
        for (const index of group.indices) {
          finalPlots[index] = {...finalPlots[index], job_id:jobId, name:`${group.customer_name} — แปลงที่ ${index+1}`};
        }
      }

      const ok = await savePlotsToServer(finalPlots);
      if (!ok) throw new Error('สร้างคิวแล้ว แต่ผูกแปลงยังไม่สำเร็จ');
      setLinkReview(null); setLinkNewQueueDrafts({});
      await onQueueCreated?.();
      review.after?.();
    } catch (e) {
      // ถ้าสร้างคิวใหม่สำเร็จ แต่บันทึกแปลงพลาด ให้ลบเฉพาะคิวใหม่ที่เพิ่งสร้างเพื่อไม่ทิ้งคิวเปล่า
      if (createdJobIds.length) {
        await Promise.allSettled(createdJobIds.map(id => fetch(`https://harvester-api-server.onrender.com/api/jobs/${id}`, {method:'DELETE'})));
      }
      setPlotSyncStatus(`❌ ${e.message || e}`);
    } finally {
      setLinkCreatingQueue(false);
    }
  };
  const [routeEdit, setRouteEdit] = useState(false);
  const [cutMode, setCutMode] = useState('erase');
  const [cutAnchor, setCutAnchor] = useState(null);
  const [cutSelection, setCutSelection] = useState([]);
  const [routeState, setRouteState] = useState({ keys: [], revision: 0 });
  const [routeReady, setRouteReady] = useState(false);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeMessage, setRouteMessage] = useState('');
  const [showExcluded, setShowExcluded] = useState(false);
  const [routeHistory, setRouteHistory] = useState([]);
  const [reloadRoute, setReloadRoute] = useState(0);
  const excludedEdges = useMemo(() => new Set(routeState.keys), [routeState.keys]);
  const selectedEdges = useMemo(() => new Set(cutSelection), [cutSelection]);
  const routeScope = `${vehicleId}/${workDate}`;
  const routeScopeRef = useRef(routeScope);
  routeScopeRef.current = routeScope;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setRouteReady(false); setRouteState({ keys: [], revision: 0 }); setRouteHistory([]);
    setRouteEdit(false); setCutMode('erase'); setCutSelection([]); setCutAnchor(null); setRouteBusy(false);
    setRouteMessage('กำลังโหลดการตัดเส้น…');
    const timer = setTimeout(() => controller.abort(), 15000);
    fetch(`https://harvester-api-server.onrender.com/api/gps-route-edits/${vehicleId}?date=${workDate}`, { signal: controller.signal })
      .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error || 'โหลดไม่สำเร็จ'); return data; })
      .then(data => { if (routeScopeRef.current !== routeScope || controller.signal.aborted) return;
        setRouteState({ keys: data.excluded_edges || [], revision: data.revision || 0 }); setRouteReady(true); setRouteMessage(''); })
      .catch(() => { if (active && routeScopeRef.current === routeScope) setRouteMessage('โหลดการตัดเส้นไม่สำเร็จ • ตรวจเซิร์ฟเวอร์และตาราง GPS'); })
      .finally(() => clearTimeout(timer));
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [routeScope, reloadRoute]);
  const saveRouteEdges = async (keys, undo = false) => {
    if (!routeReady || routeBusy) return;
    const scope = routeScope; const previous = routeState.keys;
    setRouteBusy(true); setRouteMessage('กำลังบันทึก…');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`https://harvester-api-server.onrender.com/api/gps-route-edits/${vehicleId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ work_date: workDate, excluded_edges: keys, revision: routeState.revision })
      });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
      if (routeScopeRef.current !== scope) return;
      setRouteState({ keys: data.excluded_edges, revision: data.revision });
      setRouteHistory(h => undo ? h.slice(0, -1) : [...h.slice(-19), previous]);
      setCutSelection([]); setCutAnchor(null);
      setRouteMessage('บันทึกแล้ว • ถ้ามีแปลงเดิม ให้กดวาดออโต้ใหม่เพื่อปรับขอบแปลง');
    } catch (e) { if (routeScopeRef.current === scope) setRouteMessage(`${e.message} • ลองโหลดใหม่ก่อนบันทึกอีกครั้ง`); }
    finally { clearTimeout(timer); if (routeScopeRef.current === scope) setRouteBusy(false); }
  };
  // 🧽 ยางลบแบบถู: ใช้นิ้วลากผ่านเส้นต่อเนื่อง ไม่ต้องจิ้มทีละช่วง
  // erase = ถูลบเส้นปกติ, restore = ถูคืนเส้นที่ตัดไว้, pan = เลื่อนแผนที่
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const polylineLayer = useRef(null);
  const markerLayer = useRef(null);
  const drawLayer = useRef(null);
  const plotsLayer = useRef(null);
  const plotLoadSeq = useRef(0);
  const plotScopeRef = useRef(null);
  const savingScopes = useRef(new Set());

  const [drawMode, setDrawMode] = useState(false);
  const [points, setPoints] = useState([]);
  const [plots, setPlots] = useState([]);
  const [currentArea, setCurrentArea] = useState({ text: '0 ไร่ 0 งาน', rawRai: 0 });
  const [isSavingPlot, setIsSavingPlot] = useState(false);
  const [plotSyncStatus, setPlotSyncStatus] = useState('');
  const [autoFollow, setAutoFollow] = useState(false);
  const [headWidthMeters, setHeadWidthMeters] = useState(3.0);
  const [editingPlotIndex, setEditingPlotIndex] = useState(null);
  const [draftKind, setDraftKind] = useState('manual'); // manual | auto | edit
  const [isAutoPlotting, setIsAutoPlotting] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false); // 📱 แผงเครื่องมือบนมือถือ
  const [exclusionPanelIndex, setExclusionPanelIndex] = useState(null);
  const [holeEditor, setHoleEditor] = useState(null);
  const [draftHistory, setDraftHistory] = useState([]);
  const [draftError, setDraftError] = useState('');
  const isHoleDraft = draftKind.startsWith('hole-');
  const canAddDraftPoints = draftKind === 'manual' || draftKind === 'hole-new';

  const calculateThaiArea = plotThaiArea;
  const formatThaiRai = (value) => plotThaiArea(Number(value || 0) * 1600).text;
  const areaFromPoints = (plotPoints) => {
    try { return plotThaiArea(turf.area(plotRingFeature(plotPoints))); }
    catch (_) { return plotThaiArea(0); }
  };
  const centerFromPoints = (plotPoints) => {
    try { return plotCenter(plotRingFeature(plotPoints)); }
    catch (_) { return null; }
  };

  const copyPlotCenter = async (center) => {
    if (!center) return;
    const coordText = center.text || `${Number(center.lat).toFixed(6)}, ${Number(center.lng).toFixed(6)}`;

    try {
      await navigator.clipboard.writeText(coordText);
      setPlotSyncStatus(`📍 คัดลอกพิกัดแล้ว ${coordText}`);
    } catch (_) {
      window.prompt('คัดลอกพิกัดกลางแปลง:', coordText);
    }
  };

  const exitPlotEditor = () => {
    setDrawMode(false);
    setPoints([]);
    setEditingPlotIndex(null);
    setDraftKind('manual');
    setHoleEditor(null);
    setDraftHistory([]);
    setDraftError('');
  };

  const openPlotEditor = (plotIndex) => {
    const plot = plots[plotIndex];
    if (!plot?.points || plot.points.length < 3) return;
    setAutoFollow(false);
    setEditingPlotIndex(plotIndex);
    setDraftKind('edit');
    setHoleEditor(null);
    setDraftHistory([]);
    setExclusionPanelIndex(null);
    setMobileToolsOpen(false);
    setPoints(plot.points.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) })));
    setCurrentArea(plot.area || areaFromPoints(plot.points));
    setDrawMode(true);

    setTimeout(() => {
      if (!mapInstance.current) return;
      const bounds = L.latLngBounds(plot.points.map(p => [Number(p.lat), Number(p.lng)]));
      if (bounds.isValid()) mapInstance.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 19, animate: false });
    }, 80);
  };

  // Keep the v2 storage key so existing saved plots migrate without disappearing.
  const plotStorageKey = vehicleId && workDate ? `harvester_plots_v2_${vehicleId}_${workDate}` : null;
  plotScopeRef.current = plotStorageKey;

  const readPlotBackup = () => {
    if (!plotStorageKey) return { plots: [], pending: false };
    try {
      const raw = localStorage.getItem(plotStorageKey);
      if (!raw) return { plots: [], pending: false };
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { plots: parsed, pending: false };
      if (parsed && Array.isArray(parsed.plots)) return parsed;
    } catch (e) {
      console.warn('อ่านข้อมูลแปลงสำรองไม่ได้:', e);
    }
    return { plots: [], pending: false };
  };

  const writePlotBackup = (plotList, pending = false) => {
    if (!plotStorageKey) return false;
    try {
      localStorage.setItem(plotStorageKey, JSON.stringify({
        plots: plotList,
        pending,
        savedAt: new Date().toISOString()
      }));
      return true;
    } catch (e) {
      console.warn('สำรองแปลงในเครื่องไม่ได้:', e);
      return false;
    }
  };

  // Save snapshots for their original vehicle/date. Late GET/POST responses must
  // never replace a newer edit or the data for a newly selected vehicle/date.
  const savePlotsToServer = async (newPlots) => {
    if (!vehicleId || !workDate || plotRevision === null || savingScopes.current.has(plotStorageKey)) return false;
    const scope=plotStorageKey, revision=plotRevision;
    let normalized;
    try { normalized=newPlots.map(p => refreshPlotMetrics({...p,id:p.id || plotNewId()})); }
    catch(e) {setPlotSyncStatus(e.message);return false;}
    savingScopes.current.add(scope);setIsSavingPlot(true);setPlotSyncStatus('กำลังบันทึกแปลงและคิว…');
    writePlotBackup(normalized,true);
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
    try {
      const res=await fetch('https://harvester-api-server.onrender.com/api/plots',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({vehicle_id:Number(vehicleId),work_date:workDate,plots_data:normalized,expected_revision:revision})});
      const data=await res.json();if(!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if(plotScopeRef.current!==scope) return false;
      setPlots(hydratePlots(data.plots_data));setPlotRevision(data.revision);writePlotBackup(data.plots_data,false);
      setPlotSyncStatus('✅ บันทึกแล้ว • ยอดพื้นที่ GPS ในคิวอัปเดตแล้ว');onPlotsSaved?.();return true;
    } catch(e) {if(plotScopeRef.current===scope) setPlotSyncStatus(`ยังไม่เข้าคิว: ${e.message} • ฉบับแก้ไขสำรองในเครื่อง ถ้าบันทึกขัดข้องให้โหลดล่าสุดก่อน`);return false;}
    finally {clearTimeout(timer);savingScopes.current.delete(scope);if(plotScopeRef.current===scope)setIsSavingPlot(false);}
  };
  useEffect(() => {
    let active=true;
    setLinkReview(null);setPlotRevision(null);exitPlotEditor();setExclusionPanelIndex(null);setMobileToolsOpen(false);setPlots([]);
    setIsSavingPlot(false);setPlotSyncStatus('กำลังโหลดแปลงล่าสุด…');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    fetch(`https://harvester-api-server.onrender.com/api/plots-snapshot/${vehicleId}?date=${encodeURIComponent(workDate)}`,{signal:controller.signal})
      .then(async res => {const data=await res.json();if(!res.ok || !Array.isArray(data.plots_data))throw new Error(data.error || 'โหลดแปลงไม่สำเร็จ');return data;})
      .then(data => {if(!active)return;const loaded=hydratePlots(data.plots_data.map((p,i)=>({...p,id:p.id || `legacy-${vehicleId}-${workDate}-${i}`})));
        setPlots(loaded);setPlotRevision(data.revision);setPlotSyncStatus('✅ โหลดแปลงล่าสุดแล้ว');
        if(!readPlotBackup().pending)writePlotBackup(loaded,false);
      })
      .catch(e=>{if(active)setPlotSyncStatus(`โหลดไม่สำเร็จ: ${e.message} • กดโหลดแปลงล่าสุดอีกครั้ง`);})
      .finally(()=>clearTimeout(timer));
    return ()=>{active=false;controller.abort();clearTimeout(timer);};
  },[vehicleId,workDate,plotReload]);

  // 🧠 วิเคราะห์แต่ละช่วงทาง: ใช้ธงจาก server ก่อน และมี fallback คำนวณความเร็วจากระยะ/เวลา
  // ช่วยแยกช่วงเกี่ยวได้แม้ ST-901 บางจุดรายงาน speed=0 หรือข้อมูลเก่า is_harvesting=false
  const getSegmentInfo = (a, b) => {
    const aLat = Number(a?.latitude), aLng = Number(a?.longitude);
    const bLat = Number(b?.latitude), bLng = Number(b?.longitude);

    if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) {
      return { km: 0, harvesting: false, inferredSpeedKmh: null };
    }

    const km = turf.distance(
      turf.point([aLng, aLat]),
      turf.point([bLng, bLat]),
      { units: 'kilometers' }
    );

    if (!Number.isFinite(km) || km >= 5) {
      return { km: 0, harvesting: false, inferredSpeedKmh: null };
    }

    const explicitHarvesting =
      b?.is_harvesting === true || String(b?.is_harvesting).toLowerCase() === 'true';

    let inferredSpeedKmh = null;
    let inferredHarvesting = false;

    const aTime = a?.created_at ? new Date(a.created_at).getTime() : NaN;
    const bTime = b?.created_at ? new Date(b.created_at).getTime() : NaN;
    const dtSec = (bTime - aTime) / 1000;
    if (Number.isFinite(dtSec) && (dtSec <= 0 || dtSec > 180)) {
      return { km, harvesting: false, inferredSpeedKmh: null };
    }

    if (Number.isFinite(dtSec) && dtSec > 0 && dtSec <= 180) {
      inferredSpeedKmh = km / (dtSec / 3600);
      const movedMeters = km * 1000;

      inferredHarvesting =
        movedMeters >= 1.5 &&
        movedMeters <= 250 &&
        inferredSpeedKmh >= 0.4 &&
        inferredSpeedKmh <= 15;
    }

    return {
      km,
      harvesting: explicitHarvesting || inferredHarvesting,
      inferredSpeedKmh
    };
  };

  // สถิติ GPS จากข้อมูลที่มีอยู่ โดยไม่ต้องเพิ่มคอลัมน์ในฐานข้อมูล
  const gpsStats = (() => {
    let totalKm = 0;
    let harvestKm = 0;

    for (let i = 1; i < pathData.length; i++) {
      const a = pathData[i - 1];
      const b = pathData[i];
      if (excludedEdges.has(gpsEdgeKey(a, b))) continue;
      const segment = getSegmentInfo(a, b);
      if (segment.km > 0) {
        totalKm += segment.km;
        if (segment.harvesting) harvestKm += segment.km;
      }
    }

    const firstAt = pathData[0]?.created_at ? new Date(pathData[0].created_at) : null;
    const lastAt = pathData[pathData.length - 1]?.created_at ? new Date(pathData[pathData.length - 1].created_at) : null;
    const durationMin = firstAt && lastAt && !Number.isNaN(firstAt.getTime()) && !Number.isNaN(lastAt.getTime())
      ? Math.max(0, Math.round((lastAt - firstAt) / 60000))
      : 0;
    const lastAgeSec = lastAt && !Number.isNaN(lastAt.getTime()) ? Math.max(0, Math.round((Date.now() - lastAt.getTime()) / 1000)) : null;

    return {
      totalKm,
      harvestKm,
      durationMin,
      lastAgeSec,
      points: pathData.length
    };
  })();

  // 📈 GPS V3.1: คำนวณความคืบหน้าการเกี่ยวจาก "พื้นที่จริง" ไม่ใช่แค่ระยะทาง
  // 1) เอาเฉพาะ segment ที่ระบบมองว่ากำลังเกี่ยว
  // 2) ขยายเส้นออกตามครึ่งหนึ่งของความกว้างหัวเกี่ยว
  // 3) ตัดเฉพาะพื้นที่ที่อยู่ภายในขอบแปลงที่บันทึก
  // ผลที่ได้จึงเป็นค่าประมาณพื้นที่ที่หัวเกี่ยวผ่านแล้วจริง
  const harvestCoverage = useMemo(() => {
    if (!routeReady) return null;
    try {
      const segments = [];
      for (let i = 1; i < pathData.length; i++) {
        const a = pathData[i - 1];
        const b = pathData[i];
      if (excludedEdges.has(gpsEdgeKey(a, b))) continue;
        const info = getSegmentInfo(a, b);
        if (!info.harvesting || info.km <= 0 || info.km > 0.25) continue;

        const aLat = Number(a.latitude), aLng = Number(a.longitude);
        const bLat = Number(b.latitude), bLng = Number(b.longitude);
        if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) continue;
        segments.push([[aLng, aLat], [bLng, bLat]]);
      }

      if (segments.length === 0) return null;
      return turf.buffer(
        turf.multiLineString(segments),
        Math.max(0.5, Number(headWidthMeters) / 2),
        { units: 'meters', steps: 5 }
      );
    } catch (err) {
      console.warn('คำนวณพื้นที่เกี่ยวไม่ได้:', err);
      return null;
    }
  }, [pathData, headWidthMeters, excludedEdges, routeReady]);

  const plotGeometries = useMemo(() => plots.map(plot => {
    try { return plotGeometry(plot); } catch (_) { return null; }
  }), [plots]);

  const plotProgressList = useMemo(() => plotGeometries.map((geometry, index) => {
    const totalSqM = geometry?.netSqM || 0;
    let coveredSqM = 0;
    try {
      const clipped = plotClip('intersect', geometry?.net, harvestCoverage);
      if (clipped) coveredSqM = Math.min(totalSqM, Math.max(0, turf.area(clipped)));
    } catch (_) {}
    const percent = totalSqM > 0 ? Math.min(100, coveredSqM / totalSqM * 100) : 0;
    return {
      index, totalSqM, coveredSqM, percent,
      totalRai: totalSqM / 1600, coveredRai: coveredSqM / 1600,
      remainingRai: Math.max(0, totalSqM - coveredSqM) / 1600, remainingPercent: 100 - percent
    };
  }), [plotGeometries, harvestCoverage]);

  const overallProgress = (() => {
    const totalSqM = plotProgressList.reduce((sum, p) => sum + p.totalSqM, 0);
    const coveredSqM = plotProgressList.reduce((sum, p) => sum + p.coveredSqM, 0);
    const percent = totalSqM > 0 ? Math.min(100, Math.max(0, (coveredSqM / totalSqM) * 100)) : 0;
    return {
      totalRai: totalSqM / 1600,
      coveredRai: coveredSqM / 1600,
      remainingRai: Math.max(0, (totalSqM - coveredSqM) / 1600),
      percent,
      remainingPercent: Math.max(0, 100 - percent)
    };
  })();

  const fitPlotForReview = (plotPoints) => {
    const map = mapInstance.current;
    if (!map || !plotPoints?.length) return;
    const bounds = L.latLngBounds(plotPoints.map(p => [Number(p.lat), Number(p.lng)]));
    if (!bounds.isValid()) return;
    const size = map.getSize();
    const mobile = size.x < 640;
    // Keep the selected field in the visible map above the mobile review sheet.
    map.fitBounds(bounds, {
      paddingTopLeft: mobile ? [20, 65] : [350, 40],
      paddingBottomRight: mobile ? [60, Math.min(size.y * 0.48 + 96, size.y - 165)] : [60, 70],
      maxZoom: 20, animate: false
    });
  };

  const openExclusionPanel = (index) => {
    if (isSavingPlot || isAutoPlotting) return;
    exitPlotEditor();
    setExclusionPanelIndex(index);
    fitPlotForReview(plots[index]?.points);
    setMobileToolsOpen(false);
    setAutoFollow(false);
  };

  const openHoleEditor = (plotIndex, kind = 'new', id = null) => {
    if (isSavingPlot || isAutoPlotting) return;
    const plot = plots[plotIndex];
    if (!plot) return;
    const item = kind === 'new' ? null : (kind === 'suggestion' ? plot.holeSuggestions : plot.holes)?.find(h => h.id === id);
    if (kind !== 'new' && !item) return;
    setAutoFollow(false);
    setEditingPlotIndex(plotIndex);
    setHoleEditor({ kind, id: item?.id || plotNewId() });
    setDraftKind(`hole-${kind}`);
    setPoints(item ? item.points.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) })) : []);
    setDraftHistory([]);
    setDraftError('');
    setCurrentArea(plot.area || plotThaiArea(0));
    setExclusionPanelIndex(null);
    setMobileToolsOpen(false);
    setDrawMode(true);
    const bounds = L.latLngBounds((item?.points || plot.points).map(p => [Number(p.lat), Number(p.lng)]));
    if (bounds.isValid()) mapInstance.current?.fitBounds(bounds, { padding: [70, 70], maxZoom: 20, animate: false });
  };

  const changeDraftPoints = (next) => {
    if (isSavingPlot) return;
    setDraftHistory(history => [...history.slice(-49), points]);
    setPoints(next);
  };
  const undoDraft = () => {
    if (!draftHistory.length) return;
    setPoints(draftHistory[draftHistory.length - 1]);
    setDraftHistory(history => history.slice(0, -1));
  };
  const cancelDraft = () => {
    const backTo = editingPlotIndex;
    exitPlotEditor();
    if (isHoleDraft && backTo !== null) {
      setExclusionPanelIndex(backTo);
      fitPlotForReview(plots[backTo]?.points);
    }
  };

  const buildDraftPlot = (draftPoints) => {
    const ring = plotRingFeature(draftPoints);
    const base = editingPlotIndex === null ? null : plots[editingPlotIndex];
    if (isHoleDraft) {
      if (!base || !holeEditor) throw new Error('กรุณาเลือกแปลงสำหรับหักพื้นที่');
      const inside = plotClip('intersect', plotRingFeature(base.points), ring);
      if (!inside || turf.area(inside) < 1) throw new Error('วงหักต้องทับพื้นที่ภายในแปลงอย่างน้อย 1 ตร.ม.');
      const original = (holeEditor.kind === 'suggestion' ? base.holeSuggestions : base.holes)?.find(h => h.id === holeEditor.id);
      const hole = { ...original, id: holeEditor.id, points: draftPoints, source: original?.source || 'MANUAL_HOLE', status: 'confirmed', updated_at: new Date().toISOString() };
      return {
        ...base,
        holes: [...(base.holes || []).filter(h => h.id !== hole.id), hole],
        holeSuggestions: (base.holeSuggestions || []).filter(h => h.id !== hole.id),
        updated_at: new Date().toISOString()
      };
    }
    return {
      ...(base || { source: 'MANUAL', created_at: new Date().toISOString(), holes: [], holeSuggestions: [] }),
      points: draftPoints, updated_at: new Date().toISOString()
    };
  };

  const saveDraft = async () => {
    try {
      const draft = refreshPlotMetrics(buildDraftPlot(points));
      const backTo = editingPlotIndex;
      const next = backTo === null ? [...plots, draft] : plots.map((p, i) => i === backTo ? draft : p);
      if (!isHoleDraft && backTo === null) {
        openLinkReview(next,[next.length-1],()=>exitPlotEditor());return;
      }
      const ok = await savePlotsToServer(next);
      if (ok) {
        exitPlotEditor();
        if (backTo !== null) {
          setExclusionPanelIndex(backTo);
          fitPlotForReview(draft.points);
        }
      }
    } catch (error) { setDraftError(error.message); }
  };

  const reviewHoles = async (plotIndex, ids, accept) => {
    const plot = plots[plotIndex];
    if (!plot || isSavingPlot) return;
    const selected = (plot.holeSuggestions || []).filter(h => ids.includes(h.id) && h.status === 'pending');
    if (!selected.length) return;
    const updated = {
      ...plot,
      holes: accept ? [...(plot.holes || []), ...selected.map(h => ({ ...h, status: 'confirmed', confirmed_at: new Date().toISOString() }))] : plot.holes,
      holeSuggestions: accept ? plot.holeSuggestions.filter(h => !ids.includes(h.id))
        : plot.holeSuggestions.map(h => ids.includes(h.id) ? { ...h, status: 'dismissed' } : h),
      updated_at: new Date().toISOString()
    };
    await savePlotsToServer(plots.map((p, i) => i === plotIndex ? updated : p));
  };

  const restoreHole = async (plotIndex, id) => {
    const plot = plots[plotIndex];
    if (!plot || isSavingPlot) return;
    await savePlotsToServer(plots.map((p, i) => i === plotIndex
      ? { ...p, holes: (p.holes || []).filter(h => h.id !== id), updated_at: new Date().toISOString() } : p));
  };

  const scanPlotHoles = async (plotIndex) => {
    if (isSavingPlot || isAutoPlotting) return;
    if (!harvestCoverage) { alert('ยังไม่มีแนวเกี่ยวพอสำหรับค้นหาพื้นที่ว่าง ใช้วาดพื้นที่หักเองได้ครับ'); return; }
    const scope = plotStorageKey;
    setIsAutoPlotting(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (plotScopeRef.current !== scope) return;
      const plot = plots[plotIndex];
      const holeSuggestions = detectPlotHoles(plot, harvestCoverage, headWidthMeters);
      await savePlotsToServer(plots.map((p, i) => i === plotIndex ? { ...p, holeSuggestions } : p));
      if (plotScopeRef.current === scope && !holeSuggestions.some(h => h.status === 'pending')) {
        setPlotSyncStatus('ไม่พบวงว่างขนาดชัดเจน • วาดพื้นที่หักเองได้');
      }
    } catch (error) { alert(`ค้นหาพื้นที่ว่างไม่ได้: ${error.message}`); }
    finally { setIsAutoPlotting(false); }
  };

  // ✨ GPS V3.3: Auto Multi-Plot
  // วิเคราะห์รอยเกี่ยวที่หนาแน่น แล้วแยก Polygon ที่ไม่ติดกันเป็นหลายแปลงอัตโนมัติ
  // กรองก้อนเล็ก/สัญญาณรบกวนออก และบันทึกในเครื่องทันที จากนั้นแก้แต่ละแปลงได้ด้วย ✏️
  const generateAutoPlot = async () => {
    if (plotRevision === null) return alert('กรุณาโหลดแปลงล่าสุดให้สำเร็จก่อน');
    if (!routeReady || routeEdit) return alert('กรุณาโหลดการตัดเส้นให้สำเร็จและออกจากโหมดตัดเส้นก่อนครับ');
    if (isSavingPlot || isAutoPlotting) return;
    const autoScope = plotStorageKey;
    if (pathData.length < 8) return alert('ข้อมูล GPS ยังน้อยเกินไปสำหรับวาดแปลงอัตโนมัติครับ');
    if (!vehicleId || !workDate) return alert('กรุณาเลือกรถและวันที่ก่อนครับ');

    setIsAutoPlotting(true);
    setAutoFollow(false);

    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (plotScopeRef.current !== autoScope) return;
      // 1) เก็บเฉพาะ segment ที่ระบบประเมินว่า "กำลังเกี่ยว"
      const candidates = [];
      for (let i = 1; i < pathData.length; i++) {
        const a = pathData[i - 1];
        const b = pathData[i];
      if (excludedEdges.has(gpsEdgeKey(a, b))) continue;
        const info = getSegmentInfo(a, b);
        if (!info.harvesting || info.km <= 0 || info.km > 0.25) continue;

        const aLat = Number(a.latitude), aLng = Number(a.longitude);
        const bLat = Number(b.latitude), bLng = Number(b.longitude);
        if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) continue;

        const mid = turf.midpoint(
          turf.point([aLng, aLat]),
          turf.point([bLng, bLat])
        ).geometry.coordinates;

        candidates.push({
          index: i,
          a: [aLng, aLat],
          b: [bLng, bLat],
          mid
        });
      }

      if (candidates.length < 4) {
        return alert('ยังหาเที่ยววิ่งเกี่ยวได้ไม่พอครับ\nลองเลือกวันที่ที่รถเกี่ยวเต็มแปลงก่อน');
      }

      // 2) ตัดเส้นเดินทางเดี่ยวออก: แปลงจริงจะมีเที่ยววิ่งไป-กลับอยู่ใกล้กันหลายเส้น
      const densityRadiusMeters = Math.max(16, headWidthMeters * 5);
      const denseSegments = candidates.filter((seg, idx) => {
        let nonAdjacentNeighbors = 0;

        for (let j = 0; j < candidates.length; j++) {
          if (j === idx) continue;
          const other = candidates[j];

          // ไม่นับจุดติดกันตามเวลา เพราะถนนเส้นเดียวก็มีจุดต่อกันจำนวนมาก
          if (Math.abs(other.index - seg.index) <= 4) continue;

          const meters = turf.distance(
            turf.point(seg.mid),
            turf.point(other.mid),
            { units: 'kilometers' }
          ) * 1000;

          if (meters <= densityRadiusMeters) {
            nonAdjacentNeighbors++;
            if (nonAdjacentNeighbors >= 2) break;
          }
        }

        return nonAdjacentNeighbors >= 2;
      });

      if (denseSegments.length < 3) {
        return alert('ระบบเห็นรอยเกี่ยว แต่ยังแยกพื้นที่แปลงออกจากทางเดินรถไม่ได้ชัดพอครับ\nลองใช้วาดมือ หรือปรับหัวเกี่ยวให้ตรงก่อน');
      }

      // 3) ขยายรอยวิ่งตามความกว้างหัวเกี่ยว
      const multi = turf.multiLineString(denseSegments.map(s => [s.a, s.b]));
      const buffered = turf.buffer(
        multi,
        Math.max(1, headWidthMeters / 2),
        { units: 'meters', steps: 6 }
      );

      if (!buffered) return alert('สร้างพื้นที่จากรอย GPS ไม่สำเร็จครับ');

      const getOuterRings = (feature) => {
        if (!feature?.geometry) return [];
        if (feature.geometry.type === 'Polygon') return [feature.geometry.coordinates[0]];
        if (feature.geometry.type === 'MultiPolygon') {
          return feature.geometry.coordinates.map(poly => poly[0]);
        }
        return [];
      };

      // 4) ลดจำนวนจุด "แยกทีละก้อน" เพื่อให้แต่ละแปลงลากแก้ได้ง่าย
      const simplifyOneRing = (rawRing) => {
        let coords = rawRing.slice(0, -1);
        if (coords.length < 3) return null;

        const originalFeature = turf.polygon([[...coords, coords[0]]]);
        const originalSqM = turf.area(originalFeature);
        let tolerance = Math.max(0.000006, Math.min(0.00003, headWidthMeters / 150000));
        let bestCoords = coords;

        for (let pass = 0; pass < 6; pass++) {
          try {
            const feature = turf.polygon([[...coords, coords[0]]]);
            const simplified = turf.simplify(feature, {
              tolerance,
              highQuality: true,
              mutate: false
            });

            const ring = simplified?.geometry?.coordinates?.[0];
            if (Array.isArray(ring) && ring.length >= 4) {
              const candidateCoords = ring.slice(0, -1);
              const valid = plotRingFeature(candidateCoords.map(([lng, lat]) => ({ lat, lng })));
              if (Math.abs(turf.area(valid) - originalSqM) <= originalSqM * 0.05) bestCoords = candidateCoords;
            }

            if (bestCoords.length <= 48) break;
            tolerance *= 1.45;
          } catch (_) {
            break;
          }
        }

        if (bestCoords.length < 3) return null;
        try { plotRingFeature(bestCoords.map(([lng, lat]) => ({ lat, lng }))); }
        catch (_) { return null; }
        return { coords: bestCoords, sqM: originalSqM };
      };

      let rings = getOuterRings(buffered)
        .map(simplifyOneRing)
        .filter(Boolean)
        .filter(item => item.coords.length >= 3)
        .sort((a, b) => b.sqM - a.sqM);

      if (rings.length === 0) {
        return alert('ยังสร้างขอบแปลงที่เชื่อถือได้ไม่สำเร็จครับ');
      }

      // 5) กรองเศษรอย GPS เล็ก ๆ ออก
      // เก็บก้อนที่มีอย่างน้อย ~0.08 ไร่ และไม่น้อยกว่า 1.5% ของก้อนใหญ่สุด
      const largestSqM = rings[0].sqM;
      const minPlotSqM = Math.max(
        120,
        headWidthMeters * 35,
        largestSqM * 0.015
      );

      rings = rings
        .filter(item => item.sqM >= minPlotSqM)
        .slice(0, 12); // กันกรณี GPS แตกเป็นเศษจำนวนมากผิดปกติ

      if (rings.length === 0) {
        return alert('พบแต่พื้นที่เล็กเกินไป ระบบจึงยังไม่สร้างเป็นแปลงให้อัตโนมัติครับ');
      }

      // 6) แปลงทุกก้อนที่แยกจากกันเป็น Plot คนละแปลง
      const batchId = `AUTO-${vehicleId}-${workDate}-${Date.now()}`;
      const autoPlots = rings.map((ring, index) => {
        const autoPoints = ring.coords.map(([lng, lat]) => ({ lat, lng }));
        const area = areaFromPoints(autoPoints);
        const center = centerFromPoints(autoPoints);

        const plot = {
          points: autoPoints,
          holes: [],
          area,
          center,
          source: 'AUTO_GPS_MULTI',
          auto_batch_id: batchId,
          auto_group: index + 1,
          head_width_m: headWidthMeters,
          created_at: new Date().toISOString()
        };
        plot.holeSuggestions = detectPlotHoles(plot, harvestCoverage, headWidthMeters);
        return refreshPlotMetrics(plot);
      });

      // ถ้ากด Auto ซ้ำ ให้เลือกแทนเฉพาะแปลง Auto เดิม ไม่แตะแปลงที่วาดมือ
      const oldAutoCount = plots.filter(p => String(p?.source || '').startsWith('AUTO_GPS')).length;
      let basePlots = plots;

      if (oldAutoCount > 0) {
        const replaceOld = window.confirm(
          `มีแปลงออโต้เดิม ${oldAutoCount} แปลง\n\nกด ตกลง = สร้างใหม่แทนแปลงออโต้เดิม\nกด ยกเลิก = ไม่เปลี่ยนแปลงข้อมูลเดิม\n\n(แปลงที่วาดมือจะไม่ถูกลบ แต่พื้นที่หักของแปลงออโต้เดิมจะถูกแทนด้วยข้อเสนอใหม่ที่ต้องตรวจอีกครั้ง)`
        );
        if (!replaceOld) return;
        basePlots = plots.filter(p => !String(p?.source || '').startsWith('AUTO_GPS'));
      }

      const startIndex = basePlots.length;
      const nextPlots = [...basePlots, ...autoPlots];

      openLinkReview(nextPlots, autoPlots.map((_,i)=>startIndex+i), () => {
        exitPlotEditor();setMobileToolsOpen(true);
        fitPlotForReview(autoPlots[0].points);
      });
    } catch (err) {
      console.error('Auto Multi-Plot Error:', err);
      alert(`สร้างแปลงอัตโนมัติไม่สำเร็จครับ\n${err.message || err}`);
    } finally {
      setIsAutoPlotting(false);
    }
  };

  const fitAllRoute = () => {
    setAutoFollow(false); // ผู้ใช้กำลังดูภาพรวม ห้ามรีเฟรชแล้วดึงกล้องกลับไปที่รถ
    if (!mapInstance.current || pathData.length === 0) return;
    const latlngs = pathData
      .filter((p, i) => showExcluded || routeEdit || (i > 0 && !excludedEdges.has(gpsEdgeKey(pathData[i-1], p))) || (i < pathData.length-1 && !excludedEdges.has(gpsEdgeKey(p, pathData[i+1]))))
      .map(p => [Number(p.latitude), Number(p.longitude)])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
    if (latlngs.length === 0) return;
    mapInstance.current.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30], maxZoom: 18 });
  };

  // 1. สร้างแผนที่
  useEffect(() => {
    if (!mapRef.current) return;
    const center = pathData.length > 0
      ? [Number(pathData[pathData.length - 1].latitude), Number(pathData[pathData.length - 1].longitude)]
      : [15.7012, 101.1012];
    const zoom = pathData.length > 0 ? 17 : 6;

    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, { zoomControl: false }).setView(center, zoom);
      L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps', maxZoom: 20
      }).addTo(mapInstance.current);
      L.control.zoom({ position: 'bottomright' }).addTo(mapInstance.current);
      drawLayer.current = L.layerGroup().addTo(mapInstance.current);
      plotsLayer.current = L.layerGroup().addTo(mapInstance.current);
      setTimeout(() => mapInstance.current?.invalidateSize(), 300);
    }

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  // ผู้ใช้ลาก/แตะแผนที่เอง = กำลังสำรวจตำแหน่งอื่น
  // Auto-refresh ยังดึงข้อมูลต่อ แต่กล้องจะไม่เด้งกลับจนกว่าจะกดเปิดตามรถใหม่
  useEffect(() => {
    if (!mapInstance.current) return;

    const map = mapInstance.current;
    const container = map.getContainer();
    const pauseAutoFollow = () => setAutoFollow(false);

    map.on('dragstart', pauseAutoFollow);
    map.on('click', pauseAutoFollow);
    container.addEventListener('wheel', pauseAutoFollow, { passive: true });
    container.addEventListener('touchstart', pauseAutoFollow, { passive: true });

    return () => {
      map.off('dragstart', pauseAutoFollow);
      map.off('click', pauseAutoFollow);
      container.removeEventListener('wheel', pauseAutoFollow);
      container.removeEventListener('touchstart', pauseAutoFollow);
    };
  }, []);

  // 2. วาดเส้นทาง: น้ำเงิน = กำลังเกี่ยว, ม่วงชมพู = วิ่งทั่วไป
  useEffect(() => {
    if (!mapInstance.current) return;
    if (polylineLayer.current) mapInstance.current.removeLayer(polylineLayer.current);
    if (markerLayer.current) mapInstance.current.removeLayer(markerLayer.current);

    if (pathData.length > 0) {
      const routeGroup = L.layerGroup().addTo(mapInstance.current);
      const markerGroup = L.layerGroup().addTo(mapInstance.current);

      for (let i = 1; i < pathData.length; i++) {
        const a = pathData[i - 1];
        const b = pathData[i];
        const edgeKey = gpsEdgeKey(a, b);
        const excluded = excludedEdges.has(edgeKey);
        const selected = selectedEdges.has(edgeKey);
        if (excluded && !routeEdit && !showExcluded) continue;
        const aLat = Number(a.latitude), aLng = Number(a.longitude);
        const bLat = Number(b.latitude), bLng = Number(b.longitude);
        if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) continue;
        const segment = getSegmentInfo(a, b);
        const harvesting = segment.harvesting;
        L.polyline([[aLat, aLng], [bLat, bLng]], {
          // กำลังเกี่ยวให้เด่นชัด ส่วนวิ่งทั่วไปทำบาง/โปร่งเพื่อลดตาลาย
          // โหมดยางลบ: สีส้ม = กำลังจะลบ, สีเขียว = กำลังจะคืน, สีเทา = ตัดไว้แล้ว
          color: selected ? (cutMode === 'restore' ? '#22C55E' : '#F97316') : excluded ? '#94A3B8' : harvesting ? '#2563EB' : '#D946EF',
          weight: selected ? 9 : harvesting ? 4 : 2,
          dashArray: excluded && !selected ? '5 7' : undefined,
          opacity: selected ? 1 : excluded ? 0.45 : 0.8,
          bubblingMouseEvents: false
        }).addTo(routeGroup);

      }

      const firstPoint = pathData[0];
      const lastPoint = pathData[pathData.length - 1];
      const firstLat = Number(firstPoint.latitude), firstLng = Number(firstPoint.longitude);
      const lastLat = Number(lastPoint.latitude), lastLng = Number(lastPoint.longitude);

      if ([firstLat, firstLng].every(Number.isFinite)) {
        L.circleMarker([firstLat, firstLng], {
          radius: 6, color: '#FFFFFF', weight: 2, fillColor: '#0EA5E9', fillOpacity: 1
        }).bindTooltip('จุดเริ่มต้น').addTo(markerGroup);
      }

      if ([lastLat, lastLng].every(Number.isFinite)) {
        const carIcon = L.divIcon({
          className: 'bg-transparent border-0',
          html: `<div class="bg-orange-500 text-white rounded-full w-9 h-9 flex items-center justify-center font-bold text-lg border-2 border-white shadow-lg drop-shadow-md cursor-pointer" style="margin-left:-18px;margin-top:-18px;">🚜</div>`,
          iconSize: [0, 0]
        });
        const marker = L.marker([lastLat, lastLng], { icon: carIcon }).addTo(markerGroup);
        marker.bindTooltip('ตำแหน่งล่าสุด');
        marker.on('click', () => {
          window.open(`https://www.google.com/maps/dir/?api=1&destination=${lastLat},${lastLng}`, '_blank');
        });
      }

      polylineLayer.current = routeGroup;
      markerLayer.current = markerGroup;
    }
  }, [pathData, excludedEdges, selectedEdges, routeEdit, cutMode, cutAnchor, routeBusy, showExcluded]);

  // 🧽 ถูยางลบบนแผนที่
  // - ปิดการลากแผนที่ชั่วคราวในโหมดถู เพื่อให้นิ้วลากเป็น "ยางลบ"
  // - ทุกตำแหน่งนิ้วจะเลือกเฉพาะเส้นที่ใกล้ที่สุดภายในรัศมี จึงไม่กวาดเส้นข้าง ๆ ทั้งแถบ
  // - เก็บเส้นที่โดนถูไว้ตลอดหนึ่ง stroke แล้วค่อยอัปเดต React ตอนยกนิ้ว เพื่อลดอาการกระตุก
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !routeEdit) return;

    const container = map.getContainer();
    const rubbingMode = cutMode === 'erase' || cutMode === 'restore';

    if (!rubbingMode) {
      map.dragging.enable();
      return;
    }

    map.dragging.disable();
    const oldTouchAction = container.style.touchAction;
    container.style.touchAction = 'none';

    const BRUSH_RADIUS_PX = 16;
    const SAMPLE_STEP_PX = 7;

    let rubbing = false;
    let activePointerId = null;
    let lastPoint = null;
    let strokeSegments = [];
    let strokeKeys = new Set();
    let trailLayer = null;

    const distanceSqToSegment = (p, a, b) => {
      const vx = b.x - a.x, vy = b.y - a.y;
      const wx = p.x - a.x, wy = p.y - a.y;
      const lenSq = vx * vx + vy * vy;
      if (lenSq <= 0.0001) {
        const dx = p.x - a.x, dy = p.y - a.y;
        return dx * dx + dy * dy;
      }
      const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
      const x = a.x + t * vx, y = a.y + t * vy;
      const dx = p.x - x, dy = p.y - y;
      return dx * dx + dy * dy;
    };

    const buildScreenSegments = () => {
      const segments = [];
      for (let i = 1; i < pathData.length; i++) {
        const a = pathData[i - 1], b = pathData[i];
        const key = gpsEdgeKey(a, b);
        const excluded = excludedEdges.has(key);
        if (cutMode === 'erase' ? excluded : !excluded) continue;

        const aLat = Number(a.latitude), aLng = Number(a.longitude);
        const bLat = Number(b.latitude), bLng = Number(b.longitude);
        if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) continue;

        const pa = map.latLngToContainerPoint([aLat, aLng]);
        const pb = map.latLngToContainerPoint([bLat, bLng]);
        segments.push({
          key,
          a: pa,
          b: pb,
          minX: Math.min(pa.x, pb.x) - BRUSH_RADIUS_PX,
          maxX: Math.max(pa.x, pb.x) + BRUSH_RADIUS_PX,
          minY: Math.min(pa.y, pb.y) - BRUSH_RADIUS_PX,
          maxY: Math.max(pa.y, pb.y) + BRUSH_RADIUS_PX
        });
      }
      return segments;
    };

    const collectNearest = (point) => {
      let nearestKey = null;
      let nearestDistSq = BRUSH_RADIUS_PX * BRUSH_RADIUS_PX;

      for (const segment of strokeSegments) {
        if (point.x < segment.minX || point.x > segment.maxX || point.y < segment.minY || point.y > segment.maxY) continue;
        const d2 = distanceSqToSegment(point, segment.a, segment.b);
        if (d2 <= nearestDistSq) {
          nearestDistSq = d2;
          nearestKey = segment.key;
        }
      }

      if (nearestKey) strokeKeys.add(nearestKey);
    };

    const rubBetween = (from, to) => {
      const dx = to.x - from.x, dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(distance / SAMPLE_STEP_PX));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        collectNearest(L.point(from.x + dx * t, from.y + dy * t));
      }
    };

    const toContainerPoint = (event) => {
      const rect = container.getBoundingClientRect();
      return L.point(event.clientX - rect.left, event.clientY - rect.top);
    };

    const ignoreTarget = (event) => {
      const el = event.target;
      return !!(el && typeof el.closest === 'function' && el.closest('.leaflet-control'));
    };

    const onPointerDown = (event) => {
      if (routeBusy || ignoreTarget(event)) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      rubbing = true;
      activePointerId = event.pointerId;
      lastPoint = toContainerPoint(event);
      strokeSegments = buildScreenSegments();
      strokeKeys = new Set();

      trailLayer = L.polyline([], {
        color: cutMode === 'restore' ? '#22C55E' : '#F97316',
        weight: 10,
        opacity: 0.42,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false
      }).addTo(map);
      trailLayer.addLatLng(map.containerPointToLatLng(lastPoint));

      try { container.setPointerCapture(event.pointerId); } catch (_) {}
      rubBetween(lastPoint, lastPoint);
      event.preventDefault();
      event.stopPropagation();
    };

    const onPointerMove = (event) => {
      if (!rubbing || event.pointerId !== activePointerId) return;
      const nextPoint = toContainerPoint(event);
      rubBetween(lastPoint, nextPoint);
      lastPoint = nextPoint;
      trailLayer?.addLatLng(map.containerPointToLatLng(nextPoint));
      event.preventDefault();
      event.stopPropagation();
    };

    const finishStroke = (event) => {
      if (!rubbing || (event && event.pointerId !== activePointerId)) return;
      rubbing = false;

      const keys = [...strokeKeys];
      if (keys.length) {
        setCutSelection(prev => {
          const merged = new Set(prev);
          keys.forEach(key => merged.add(key));
          return [...merged];
        });
      }

      if (trailLayer) {
        try { map.removeLayer(trailLayer); } catch (_) {}
        trailLayer = null;
      }

      if (activePointerId !== null) {
        try { container.releasePointerCapture(activePointerId); } catch (_) {}
      }
      activePointerId = null;
      lastPoint = null;
      strokeSegments = [];
      strokeKeys = new Set();

      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    container.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
    container.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    container.addEventListener('pointerup', finishStroke, { capture: true, passive: false });
    container.addEventListener('pointercancel', finishStroke, { capture: true, passive: false });

    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true);
      container.removeEventListener('pointermove', onPointerMove, true);
      container.removeEventListener('pointerup', finishStroke, true);
      container.removeEventListener('pointercancel', finishStroke, true);
      container.style.touchAction = oldTouchAction;
      if (trailLayer) {
        try { map.removeLayer(trailLayer); } catch (_) {}
      }
      map.dragging.enable();
    };
  }, [routeEdit, cutMode, routeBusy, pathData, excludedEdges]);

  // 🎯 เมื่อผู้ใช้กด "ค้นหาเส้นทาง" ให้พาไปหารถล่าสุด 1 ครั้ง
  // Auto-refresh หลังจากนั้นจะอัปเดตข้อมูลอย่างเดียว ไม่แย่งกล้อง
  useEffect(() => {
    if (!focusRequest || pathData.length === 0 || !mapInstance.current) return;

    const lastPoint = pathData[pathData.length - 1];
    const lat = Number(lastPoint.latitude);
    const lng = Number(lastPoint.longitude);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setAutoFollow(false);
      mapInstance.current.flyTo([lat, lng], 17, {
        animate: true,
        duration: 0.9
      });
    }
  }, [focusRequest]);

  // 3. ติดตามรถอัตโนมัติเมื่อข้อมูลใหม่เข้ามา
  useEffect(() => {
    if (!isFetchingGps && autoFollow && trackingMode === 'realtime' && pathData.length > 0 && mapInstance.current) {
      const lastPoint = pathData[pathData.length - 1];
      const lat = Number(lastPoint.latitude), lng = Number(lastPoint.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        mapInstance.current.flyTo([lat, lng], Math.max(mapInstance.current.getZoom(), 17), {
          animate: true,
          duration: 0.8
        });
      }
    }
  }, [isFetchingGps, pathData, autoFollow, trackingMode]);

  // Click/tap adds vertices only in new drawings; edit mode uses vertex handles.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const handleClick = (e) => {
      if (drawMode && canAddDraftPoints && !isSavingPlot) changeDraftPoints([...points, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    };
    map.getContainer().style.cursor = drawMode && canAddDraftPoints ? 'crosshair' : '';
    if (drawMode) map.on('click', handleClick);
    return () => map.off('click', handleClick);
  }, [drawMode, canAddDraftPoints, points, isSavingPlot]);

  // Update net fill and area while dragging without replacing the active marker.
  useEffect(() => {
    if (!drawLayer.current || !mapInstance.current) return;
    drawLayer.current.clearLayers();
    if (!drawMode) return;
    const previewLayer = L.layerGroup().addTo(drawLayer.current);
    let frame = null;
    const drawPreview = (draftPoints) => {
      previewLayer.clearLayers();
      try {
        if (draftPoints.length < 3) {
          const base = isHoleDraft ? plotGeometries[editingPlotIndex] : null;
          if (base?.net) L.geoJSON(base.net, { style: { color: '#F59E0B', fillColor: '#FDE047', fillOpacity: 0.2, interactive: false } }).addTo(previewLayer);
          setCurrentArea({ ...plotThaiArea(base?.netSqM || 0), text: draftPoints.length ? 'วาดอย่างน้อย 3 จุดรอบพื้นที่' : 'แตะรอบพื้นที่ หรือเลื่อนเป้าแล้วกด + จุด' });
          setDraftError('');
        } else {
          const geometry = plotGeometry(buildDraftPlot(draftPoints));
          if (geometry.netSqM < 1) throw new Error('วงหักครอบคลุมทั้งแปลง กรุณาปรับให้เล็กลง');
          L.geoJSON(geometry.net, { style: { color: '#F59E0B', fillColor: '#FDE047', fillOpacity: 0.2, weight: 3, interactive: false } }).addTo(previewLayer);
          setCurrentArea({ ...plotThaiArea(geometry.netSqM), excludedText: plotThaiArea(geometry.excludedSqM).text });
          setDraftError('');
          if (isHoleDraft) {
            const cut = plotClip('intersect', geometry.outer, plotRingFeature(draftPoints));
            if (cut) L.geoJSON(cut, { style: { color: '#EF4444', fillColor: '#EF4444', fillOpacity: 0.13, weight: 2, dashArray: '6 5', interactive: false } }).addTo(previewLayer);
          }
        }
      } catch (error) {
        setDraftError(error.message);
        setCurrentArea({ ...plotThaiArea(0), text: 'ปรับวงให้ถูกต้องก่อนบันทึก' });
      }
      if (draftPoints.length) {
        const line = draftPoints.map(p => [p.lat, p.lng]);
        if (line.length >= 3) line.push(line[0]);
        L.polyline(line, { color: isHoleDraft ? '#DC2626' : '#F97316', weight: 2, dashArray: '5 5', interactive: false }).addTo(previewLayer);
      }
    };
    drawPreview(points);
    points.forEach((p, idx) => {
      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: 'bg-transparent border-0',
          html: `<div style="width:26px;height:26px;border-radius:50%;background:${isHoleDraft ? '#DC2626' : '#EA580C'};color:white;border:2px solid white;box-shadow:0 2px 5px #0006;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;cursor:move">${idx + 1}</div>`,
          iconSize: [26, 26], iconAnchor: [13, 13]
        }), draggable: !isSavingPlot, bubblingMouseEvents: false
      }).addTo(drawLayer.current);
      marker.bindTooltip('ลากเพื่อแก้จุด • คลิกขวาเพื่อลบจุด');
      marker.on('drag', e => {
        const ll = e.target.getLatLng();
        const live = points.map((pt, i) => i === idx ? { lat: ll.lat, lng: ll.lng } : pt);
        if (frame !== null) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => drawPreview(live));
      });
      marker.on('dragend', e => {
        if (frame !== null) cancelAnimationFrame(frame);
        const ll = e.target.getLatLng();
        changeDraftPoints(points.map((pt, i) => i === idx ? { lat: ll.lat, lng: ll.lng } : pt));
      });
      marker.on('contextmenu', e => {
        L.DomEvent.stopPropagation(e);
        if (points.length > 3) changeDraftPoints(points.filter((_, i) => i !== idx));
      });
      if (points.length >= 3) {
        const next = points[(idx + 1) % points.length];
        const mid = { lat: (p.lat + next.lat) / 2, lng: (p.lng + next.lng) / 2 };
        L.marker([mid.lat, mid.lng], {
          icon: L.divIcon({ className: 'bg-transparent border-0', html: '<div style="width:20px;height:20px;border-radius:50%;background:white;border:1px solid #EA580C;color:#C2410C;text-align:center;line-height:18px;font-size:15px;font-weight:bold">+</div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
          bubblingMouseEvents: false
        }).bindTooltip('เพิ่มจุดตรงกลางเส้น').on('click', () => changeDraftPoints([...points.slice(0, idx + 1), mid, ...points.slice(idx + 1)])).addTo(drawLayer.current);
      }
    });
    return () => { if (frame !== null) cancelAnimationFrame(frame); };
  }, [points, drawMode, draftKind, editingPlotIndex, holeEditor, plotGeometries, isSavingPlot]);

  // GeoJSON preserves inner rings and split polygons (Leaflet renders real holes).
  useEffect(() => {
    if (!plotsLayer.current || !mapInstance.current) return;
    plotsLayer.current.clearLayers();
    plots.forEach((plot, index) => {
      if (drawMode && editingPlotIndex === index) return;
      const geometry = plotGeometries[index];
      if (!geometry?.net) return;
      L.geoJSON(geometry.net, { style: { color: '#F59E0B', fillColor: '#FDE047', fillOpacity: 0.20, weight: 3, interactive: false } }).addTo(plotsLayer.current);
      for (const hole of (plot.holes || [])) {
        try {
          const inside = plotClip('intersect', geometry.outer, plotRingFeature(hole.points));
          if (inside) L.geoJSON(inside, { style: { color: '#DC2626', weight: 2, fill: false, dashArray: '6 5', bubblingMouseEvents: false, interactive: !drawMode } })
            .bindTooltip('พื้นที่หักแล้ว • แตะเพื่อลากแก้')
            .on('click', () => openHoleEditor(index, 'existing', hole.id)).addTo(plotsLayer.current);
        } catch (_) {}
      }
      for (const hole of (plot.holeSuggestions || []).filter(h => h.status === 'pending')) {
        try {
          const inside = plotClip('intersect', geometry.outer, plotRingFeature(hole.points));
          if (inside) L.geoJSON(inside, { style: { color: '#EF4444', fillColor: '#FB7185', fillOpacity: 0.27, weight: 2, dashArray: '4 6', bubblingMouseEvents: false, interactive: !drawMode } })
            .bindTooltip('เสนอให้หัก • ยังไม่หักพื้นที่ • แตะเพื่อตรวจแก้')
            .on('click', () => openHoleEditor(index, 'suggestion', hole.id)).addTo(plotsLayer.current);
        } catch (_) {}
      }
      const center = plot.center || plotCenter(geometry.net);
      if (center && !drawMode) {
        L.marker([center.lat, center.lng], {
          icon: L.divIcon({ className: 'bg-transparent border-0', html: `<div class="bg-amber-600/95 text-white px-2 py-1 rounded-lg text-[10px] font-black shadow-lg border border-white whitespace-nowrap" style="width:max-content;transform:translate(-50%,-50%)">📍 ${String(plot.name || `แปลงที่ ${index+1}`).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))} • ${plotThaiArea(geometry.netSqM).text}</div>`, iconSize: [0, 0] }),
          bubblingMouseEvents: false
        }).bindTooltip(plot.job_id ? `คิว #${plot.job_id} • แตะเพื่อเปิดคิว` : `สุทธิ • ${center.text} • แตะเพื่อคัดลอกพิกัด`).on('click', () => plot.job_id ? onOpenJob?.(plot.job_id) : copyPlotCenter(center)).addTo(plotsLayer.current);
      }
    });
  }, [plots, plotGeometries, drawMode, editingPlotIndex, isSavingPlot, isAutoPlotting]);

  const totalPendingHoles = plots.reduce((sum, p) => sum + (p.holeSuggestions || []).filter(h => h.status === 'pending').length, 0);
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !routeEdit || cutMode !== 'box' || routeBusy) return;
    const layer = L.layerGroup().addTo(map);
    let corner = null;
    const click = event => {
      if (!corner) { corner = event.latlng; L.circleMarker(corner, {radius:6,color:'#F97316'}).addTo(layer); return; }
      const bounds = L.latLngBounds(corner, event.latlng);
      layer.clearLayers(); L.rectangle(bounds, {color:'#F97316',weight:2,fillOpacity:0.08,interactive:false}).addTo(layer);
      const box = {south:bounds.getSouth(),north:bounds.getNorth(),west:bounds.getWest(),east:bounds.getEast()};
      const keys = [];
      for(let i=1;i<pathData.length;i++) if(gpsEdgeInBox(pathData[i-1],pathData[i],box)) keys.push(gpsEdgeKey(pathData[i-1],pathData[i]));
      setCutSelection(keys); corner = null;
    };
    map.on('click', click);
    return () => {map.off('click',click);map.removeLayer(layer);};
  }, [routeEdit, cutMode, pathData, routeBusy]);

  useEffect(()=>{
    if(!focusPlot || String(focusPlot.vehicle_id)!==String(vehicleId) || focusPlot.work_date!==workDate) return;
    const plot=plots.find(p=>p.id===focusPlot.id);
    if(plot){fitPlotForReview(plot.points);setMobileToolsOpen(true);}
  },[focusPlot,plots]);
  const panelPlot = exclusionPanelIndex === null ? null : plots[exclusionPanelIndex];
  const panelPendingHoles = (panelPlot?.holeSuggestions || []).filter(h => h.status === 'pending');

  const statusOnline = trackingMode === 'realtime' && gpsStats.lastAgeSec !== null && gpsStats.lastAgeSec <= 30;
  const durationText = gpsStats.durationMin >= 60
    ? `${Math.floor(gpsStats.durationMin / 60)}ชม. ${gpsStats.durationMin % 60}น.`
    : `${gpsStats.durationMin} นาที`;

  return (
    <div className={`gps-workspace relative w-full h-full flex flex-col ${routeEdit ? 'gps-cutting' : ''}`}>

      <style>{`
        .gps-workspace button { min-height:44px; touch-action:manipulation; }
        .gps-workspace button:focus-visible { outline:3px solid #f59e0b; outline-offset:2px; }
        .gps-workspace button:disabled { opacity:.45; }
        .gps-workspace [class*="text-[9px]"], .gps-workspace [class*="text-[10px]"] { font-size:12px; font-weight:600; }
        .gps-workspace .leaflet-control-zoom { margin-bottom:170px; }
        .gps-cutting .leaflet-container { cursor:crosshair; }
      `}</style>
      {!drawMode && !routeEdit && !mobileToolsOpen && exclusionPanelIndex === null && (
        <button onClick={() => { setCutMode('erase'); setCutSelection([]); setCutAnchor(null); setRouteEdit(true); setIsMapFullScreen(true); setTimeout(() => mapInstance.current?.invalidateSize(), 300); setAutoFollow(false); setMobileToolsOpen(false); }}
          className="absolute top-3 left-3 z-[431] rounded-2xl bg-slate-900 text-white shadow-xl px-4 py-3 text-sm font-black">✂ ตัดเส้นเดินรถ</button>
      )}
      {routeEdit && <>
        <div className="absolute top-3 left-3 right-16 sm:right-auto sm:w-80 z-[440] bg-slate-900 text-white rounded-2xl shadow-xl p-3">
          <div className="flex justify-between items-center"><strong>🧽 ยางลบเส้นเดินรถ</strong><button disabled={routeBusy} aria-label="ปิดโหมดยางลบ" onClick={() => {if(cutSelection.length && !window.confirm('ออกโดยไม่บันทึกสิ่งที่จิ้มไว้?')) return;setRouteEdit(false);setCutSelection([]);setCutAnchor(null);}}>✕</button></div>
          <p className="text-xs text-slate-300">รถ {vehicleId} • {workDate} • ตัดไว้แล้ว {routeState.keys.length} ช่วง</p>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <button disabled={routeBusy} onClick={() => {setCutMode('erase');setCutAnchor(null);}} className={`rounded-xl text-xs font-black ${cutMode === 'erase' ? 'bg-orange-600 text-white' : 'bg-slate-700'}`}>🧽 ถูลบ</button>
            <button disabled={routeBusy} onClick={() => {setCutMode('pan');setCutAnchor(null);}} className={`rounded-xl text-xs font-black ${cutMode === 'pan' ? 'bg-blue-600 text-white' : 'bg-slate-700'}`}>🖐 เลื่อน</button>
            <button disabled={routeBusy || !routeState.keys.length} onClick={() => {setCutMode('restore');setCutAnchor(null);}} className={`rounded-xl text-xs font-black ${cutMode === 'restore' ? 'bg-emerald-600 text-white' : 'bg-slate-700'}`}>↩ ถูคืน</button>
          </div>
          <p className="text-xs mt-2">{cutMode === 'erase'
            ? 'เอานิ้วแตะค้างแล้วถูผ่านเส้นที่ไม่ต้องการได้ยาว ๆ • ระบบเก็บทุกช่วงที่ถูผ่าน'
            : cutMode === 'restore'
              ? 'ถูผ่านเส้นสีเทาที่ต้องการเอากลับ'
              : 'โหมดเลื่อนแผนที่ • ลากดูตำแหน่ง แล้วกด ถูลบ เพื่อทำต่อ'}</p>
          <p className={`text-xs mt-1 ${cutMode === 'erase' ? 'text-orange-300' : cutMode === 'restore' ? 'text-emerald-300' : 'text-blue-300'}`}>
            {cutMode === 'erase' ? 'เลือกเฉพาะเส้นที่ใกล้นิ้วที่สุด • สีส้ม = รอลบ'
              : cutMode === 'restore' ? 'สีเขียว = รอคืน • สีเทา = ลบไปแล้ว'
              : 'เลื่อน/ซูมแผนที่ได้ตามปกติ'}
          </p>
        </div>
        <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:w-96 z-[460] rounded-2xl bg-white shadow-2xl border border-slate-200 p-3 max-h-[42%] overflow-y-auto">
          <strong className="text-sm">{cutMode === 'restore' ? '↩ ถูรอคืน' : '🧽 ถูรอลบ'} {cutSelection.length} ช่วง</strong>
          <p className="text-xs text-slate-500">ลากนิ้วถูได้ต่อเนื่อง • พิกัด GPS ต้นฉบับยังอยู่เสมอ</p>
          <p role="status" className="text-xs font-semibold text-blue-800 my-2">{routeMessage}</p>
          <div className="grid grid-cols-3 gap-2">
            <button disabled={routeBusy || !cutSelection.length} onClick={() => {setCutSelection([]);setCutAnchor(null);}} className="bg-slate-100 rounded-xl text-xs font-bold">ล้างที่จิ้ม</button>
            <button
              disabled={routeBusy || !routeReady || !cutSelection.length || cutMode === 'pan'}
              onClick={() => cutMode === 'restore'
                ? saveRouteEdges(routeState.keys.filter(k => !selectedEdges.has(k)))
                : saveRouteEdges([...new Set([...routeState.keys, ...cutSelection])])}
              className={`${cutMode === 'erase' ? 'bg-orange-600' : 'bg-emerald-600'} text-white rounded-xl text-xs font-black col-span-2`}
            >{cutMode === 'restore' ? `✅ คืนเส้น ${cutSelection.length}` : `✅ บันทึกลบ ${cutSelection.length}`}</button>
            <button disabled={routeBusy || !routeHistory.length} onClick={() => saveRouteEdges(routeHistory[routeHistory.length-1], true)} className="bg-slate-100 rounded-xl text-xs">↶ ย้อนครั้งก่อน</button>
            <button disabled={routeBusy || !routeReady || !routeState.keys.length} onClick={() => { if(window.confirm('คืนเส้นทั้งหมดของรถและวันนี้?')) saveRouteEdges([]); }} className="bg-slate-100 rounded-xl text-xs">คืนทั้งวัน</button>
            <button disabled={routeBusy} onClick={() => setReloadRoute(n => n+1)} className="bg-slate-100 rounded-xl text-xs">โหลดใหม่</button>
          </div>
        </div>
      </>}
      {linkReview && <div role="dialog" aria-modal="true" aria-label="เลือกคิวเจ้าของแปลง" className="absolute inset-0 z-[700] bg-slate-950/50 flex items-end sm:items-center justify-center p-2">
        <div className="bg-white rounded-2xl shadow-2xl w-full sm:max-w-xl max-h-[92%] flex flex-col overflow-hidden">
          <div className="p-4 border-b">
            <h3 className="text-lg font-black text-slate-900">🌾 แปลงนี้เป็นของใคร?</h3>
            <p className="text-xs text-slate-500">ค้นหาคิวเดิมที่ยังไม่เสร็จ หรือสร้างคิวใหม่จากแปลงนี้</p>
          </div>
          <div className="p-3 space-y-3 overflow-y-auto">
            {linkReview.indices.map(index=>{
              const plot=linkReview.all[index];
              const draft=linkNewQueueDrafts[plot.id] || {query:'',customer_name:'',phone:'',create_new:false};
              const query=String(draft.query || '').trim();
              const q=query.toLowerCase();
              const currentActiveJob = plot.job_id ? activeLinkJobs.find(j=>String(j.id)===String(plot.job_id)) : null;
              const currentDoneJob = plot.job_id ? jobs.find(j=>String(j.id)===String(plot.job_id) && j.status==='DONE') : null;

              const jobMatches = q ? activeLinkJobs.filter(j=>{
                const hay = [j.customers?.name, j.customers?.phone, j.id, j.vehicles?.name, j.crop_type]
                  .map(v=>String(v || '').toLowerCase()).join(' ');
                return q.split(/\s+/).every(k=>hay.includes(k));
              }).slice(0,6) : activeLinkJobs.slice(0,6);

              const customerMatches = q ? customers.filter(c=>{
                const hay = `${String(c.name || '').toLowerCase()} ${String(c.phone || '').toLowerCase()}`;
                return q.split(/\s+/).every(k=>hay.includes(k));
              }).slice(0,6) : [];

              const canCreateTypedName = !!query && !/^[0-9+\-\s]+$/.test(query);
              const selectedNew = !!draft.create_new && !!draft.customer_name;

              return <div key={plot.id} className="bg-slate-50 border rounded-2xl p-3">
                <div className="flex justify-between gap-2 items-start">
                  <div>
                    <strong>แปลงที่ {index+1}</strong>
                    <p className="text-[10px] text-slate-500">{plot.name || `แปลงที่ ${index+1}`}</p>
                  </div>
                  <span className="text-sm font-black text-emerald-700 text-right">{formatThaiRai(plot.area?.rawRai)}</span>
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-black text-slate-800 mb-1">🔎 พิมพ์ชื่อลูกค้า / เบอร์ / เลขคิว</label>
                  <input
                    aria-label={`ค้นหาคิวหรือสร้างคิวสำหรับแปลงที่ ${index+1}`}
                    disabled={isSavingPlot || linkCreatingQueue}
                    placeholder="เช่น น้าเดต / 081... / 123"
                    value={draft.query || ''}
                    onChange={e=>{
                      const value=e.target.value;
                      setNewQueueDraft(plot.id,{query:value,customer_name:'',phone:'',create_new:false});
                    }}
                    className="w-full border-2 border-slate-300 bg-white rounded-xl p-3 text-sm font-semibold focus:border-blue-500 outline-none"
                  />
                </div>

                {(query || !currentActiveJob) && <div className="mt-2 space-y-2">
                  {jobMatches.length > 0 && <div className="bg-blue-50 border border-blue-200 rounded-xl overflow-hidden">
                    <p className="text-[10px] font-black text-blue-800 px-3 py-2">🚜 คิวงานที่ยังไม่เสร็จ</p>
                    {jobMatches.map(j=>{
                      const measuredArea = (Array.isArray(j.work_rounds) ? j.work_rounds : []).reduce((sum,r)=>sum+(Number(r.measured_area)||0),0);
                      const gpsArea = Number(j.gps_summary?.area_rai || 0);
                      return <button type="button" key={j.id} disabled={linkCreatingQueue}
                        onClick={()=>setPlotJob(index,String(j.id))}
                        className="w-full text-left px-3 py-2.5 border-t border-blue-100 bg-white hover:bg-blue-50">
                        <div className="flex justify-between gap-2">
                          <span className="font-black text-sm text-gray-900">{j.customers?.name || 'ไม่ระบุ'} • คิว #{j.id}</span>
                          <span className="text-[10px] font-bold text-blue-700">{j.status==='IN_PROGRESS'?'กำลังเกี่ยว':j.status==='PAUSED'?'รอเกี่ยวต่อ':'รอคิว'}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-0.5">{j.vehicles?.name || `รถ ${j.vehicle_id || '-'}`} • {gpsArea>0?`GPS ${plotThaiArea(gpsArea*1600).text}`:(j.area_size?`ประมาณ ~${formatRaiNgan(j.area_size)}`:'ยังไม่มีพื้นที่')} • ทำแล้ว {measuredArea.toFixed(2)} ไร่</p>
                      </button>
                    })}
                  </div>}

                  {customerMatches.length > 0 && <div className="bg-emerald-50 border border-emerald-200 rounded-xl overflow-hidden">
                    <p className="text-[10px] font-black text-emerald-800 px-3 py-2">👤 ลูกค้าเก่า — สร้างคิวใหม่จากแปลงนี้</p>
                    {customerMatches.map(c=><button type="button" key={c.id || `${c.name}/${c.phone}`}
                      onClick={()=>selectCustomerForNewQueue(index,c)}
                      className="w-full text-left px-3 py-2.5 border-t border-emerald-100 bg-white hover:bg-emerald-50">
                      <span className="font-bold text-sm text-gray-800">{c.name}</span>
                      <span className="float-right text-xs text-gray-500">📞 {c.phone || 'ไม่มีเบอร์'}</span>
                    </button>)}
                  </div>}

                  {canCreateTypedName && !selectedNew && <button type="button"
                    onClick={()=>chooseNewCustomerNameForPlot(index,query)}
                    className="w-full text-left bg-emerald-600 text-white rounded-xl px-3 py-3 font-black text-sm">
                    ＋ สร้างคิวใหม่ “{query}” จากแปลงนี้
                    <span className="block text-[10px] font-semibold opacity-90 mt-1">ไม่เอา GPS ไปปลอมเป็นยอดลูกค้าแจ้ง • GPS จะผูกเข้าคิวอัตโนมัติ</span>
                  </button>}

                  {query && !canCreateTypedName && jobMatches.length===0 && customerMatches.length===0 && <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">ไม่พบจากเบอร์นี้ • ถ้าจะสร้างลูกค้าใหม่ ให้พิมพ์ชื่อก่อน</p>}
                </div>}

                {selectedNew && <div className="mt-2 bg-emerald-100 border border-emerald-300 rounded-xl p-2.5">
                  <p className="text-xs font-black text-emerald-900">🆕 จะสร้างคิวใหม่: {draft.customer_name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <input aria-label="เบอร์ลูกค้าคิวใหม่" disabled={isSavingPlot || linkCreatingQueue} placeholder="เบอร์โทร (เว้นว่างได้)" value={draft.phone || ''} onChange={e=>setNewQueueDraft(plot.id,{phone:e.target.value})} className="flex-1 border bg-white rounded-lg p-2 text-xs"/>
                    <button type="button" onClick={()=>setNewQueueDraft(plot.id,{customer_name:'',phone:'',create_new:false})} className="text-[10px] font-black text-red-600 px-2">ยกเลิก</button>
                  </div>
                  <p className="text-[10px] text-emerald-800 mt-1">🛰️ แปลงนี้ {formatThaiRai(plot.area?.rawRai)} จะไปอยู่ใน GPS ของคิวใหม่</p>
                </div>}

                {currentActiveJob && !selectedNew && <div className="mt-2 bg-blue-100 border border-blue-300 rounded-xl p-2.5 flex justify-between items-center gap-2">
                  <div>
                    <p className="text-xs font-black text-blue-900">🔗 ผูกกับ {currentActiveJob.customers?.name || 'ไม่ระบุ'} • คิว #{currentActiveJob.id}</p>
                    <p className="text-[10px] text-blue-700">บันทึกแล้ว แปลงนี้จะเด้งไปอยู่ในคิวงานและกดดูจากคิวได้</p>
                  </div>
                  <button type="button" onClick={()=>setPlotJob(index,'')} className="text-[10px] font-black text-red-600">เอาออก</button>
                </div>}

                {currentDoneJob && !currentActiveJob && !selectedNew && <p className="mt-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">คิวเดิม #{currentDoneJob.id} ปิดงานแล้ว • เลือกคิวที่ยังไม่เสร็จหรือสร้างคิวใหม่</p>}
              </div>
            })}
          </div>
          <div className="border-t p-3">
            <p role="status" className="text-xs text-blue-800 mb-2">{plotSyncStatus}</p>
            <div className="flex gap-2">
              <button disabled={isSavingPlot || linkCreatingQueue} onClick={()=>{setLinkReview(null);setLinkNewQueueDrafts({});}} className="flex-1 bg-slate-100 rounded-xl font-bold">ยกเลิก</button>
              <button disabled={isSavingPlot || linkCreatingQueue || plotRevision===null} onClick={confirmPlotLinks} className="flex-1 bg-emerald-600 text-white rounded-xl font-black">{linkCreatingQueue?'กำลังสร้างคิว…':isSavingPlot?'กำลังบันทึก…':'บันทึกแปลงและคิว'}</button>
            </div>
          </div>
        </div>
      </div>}
      <div ref={mapRef} className="flex-1 w-full z-0" />
      {!drawMode && !routeEdit && panelPlot && (
        <div className="absolute left-3 right-3 sm:right-auto sm:w-80 bottom-20 sm:bottom-auto sm:top-4 z-[450] bg-white/95 backdrop-blur rounded-2xl border border-red-200 shadow-xl flex flex-col overflow-hidden max-h-[48%] sm:max-h-[82%]">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-red-100 shrink-0">
            <label className="text-xs font-black text-red-800 flex items-center gap-1">🕳️ พื้นที่หัก
              <select aria-label="เลือกแปลงสำหรับหักพื้นที่" value={exclusionPanelIndex} disabled={isSavingPlot || isAutoPlotting} onChange={e => openExclusionPanel(Number(e.target.value))} className="bg-red-50 rounded-lg px-2 py-1 max-w-36 text-gray-800">
                {plots.map((p, i) => <option key={i} value={i}>แปลง {i + 1} {(p.holeSuggestions || []).filter(h => h.status === 'pending').length ? '• มีข้อเสนอ' : ''}</option>)}
              </select>
            </label>
            <button aria-label="ปิดพื้นที่หัก" onClick={() => setExclusionPanelIndex(null)} className="w-8 h-8 rounded-full bg-gray-100 text-gray-600">✕</button>
          </div>
          <div className="overflow-y-auto p-3 space-y-2 min-h-0">
            <div className="grid grid-cols-3 gap-1 text-[10px]">
              <div className="bg-amber-50 rounded-lg p-1.5"><p className="text-gray-500">ขอบแปลง</p><p className="font-bold text-amber-800">{panelPlot.grossArea?.text}</p></div>
              <div className="bg-red-50 rounded-lg p-1.5"><p className="text-gray-500">หักแล้ว</p><p className="font-bold text-red-700">{panelPlot.excludedArea?.text}</p></div>
              <div className="bg-green-50 rounded-lg p-1.5"><p className="text-gray-500">พื้นที่สุทธิ</p><p className="font-black text-green-800">{panelPlot.area?.text}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-2">

              <button disabled={isSavingPlot || isAutoPlotting} onClick={() => openHoleEditor(exclusionPanelIndex)} className="col-span-2 py-2 rounded-lg bg-red-600 text-white text-xs font-black disabled:opacity-40">✂️ วาดพื้นที่หักเอง</button>
              <button disabled={isSavingPlot || isAutoPlotting} onClick={() => scanPlotHoles(exclusionPanelIndex)} className="py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold disabled:opacity-40">{isAutoPlotting ? '⏳ กำลังค้นหา...' : '🔎 ค้นหาพื้นที่ว่าง'}</button>
              <button disabled={isSavingPlot || isAutoPlotting} onClick={() => openPlotEditor(exclusionPanelIndex)} className="py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 text-[10px] font-bold disabled:opacity-40">✏️ แก้ขอบแปลง</button>
            </div>
            {panelPendingHoles.length > 0 ? (
              <>
                <p className="font-black text-xs text-red-800">🕳️ พบพื้นที่ว่าง {panelPendingHoles.length} จุดในแปลงนี้</p>
                <p className="text-[10px] text-gray-600">สีชมพูยังไม่หักออก อาจเป็นข้าวที่ยังไม่ได้เกี่ยว กรุณาตรวจภาพก่อนยืนยัน</p>
                <button disabled={isSavingPlot || isAutoPlotting} onClick={() => reviewHoles(exclusionPanelIndex, panelPendingHoles.map(h => h.id), true)} className="w-full py-2 rounded-lg bg-green-600 text-white text-xs font-black disabled:opacity-40">✅ หักออกทั้งหมด</button>
                {panelPendingHoles.map((hole, i) => (
                  <div key={hole.id} className="bg-red-50 border border-red-100 rounded-lg p-2">
                    <p className="text-[10px] text-red-800 font-bold">เสนอจุด {i + 1} • {areaFromPoints(hole.points).text}</p>
                    <div className="flex gap-1 mt-1">
                      <button disabled={isSavingPlot || isAutoPlotting} onClick={() => openHoleEditor(exclusionPanelIndex, 'suggestion', hole.id)} className="flex-1 py-2 rounded bg-white border border-red-200 text-[10px] font-bold text-red-800 disabled:opacity-40">✏️ ตรวจแก้</button>
                      <button disabled={isSavingPlot || isAutoPlotting} onClick={() => reviewHoles(exclusionPanelIndex, [hole.id], true)} className="px-2 py-2 rounded bg-green-100 text-green-800 text-[10px] font-bold disabled:opacity-40">✅ หัก</button>
                      <button disabled={isSavingPlot || isAutoPlotting} onClick={() => reviewHoles(exclusionPanelIndex, [hole.id], false)} className="px-2 py-2 rounded bg-white text-gray-500 text-[10px] font-bold disabled:opacity-40">ไม่หัก</button>
                    </div>
                  </div>
                ))}
              </>
            ) : <p className="text-[10px] text-gray-500">ไม่มีพื้นที่รอยืนยัน • วาดวงหักเองได้ แม้ไม่มีข้อมูล GPS</p>}
            {(panelPlot.holes || []).length > 0 && <p className="text-xs font-black text-gray-700">หักแล้ว {panelPlot.holes.length} วง • เส้นประแดง</p>}
            {(panelPlot.holes || []).map((hole, i) => (
              <div key={hole.id} className="flex items-center gap-1 rounded-lg border border-gray-200 p-2 text-[10px]">
                <span className="font-bold text-gray-700 mr-auto">วงหัก {i + 1}</span>
                <button disabled={isSavingPlot || isAutoPlotting} onClick={() => openHoleEditor(exclusionPanelIndex, 'existing', hole.id)} className="px-2 py-2 bg-blue-50 rounded text-blue-700 font-bold disabled:opacity-40">✏️ แก้วง</button>
                <button disabled={isSavingPlot || isAutoPlotting} onClick={() => restoreHole(exclusionPanelIndex, hole.id)} className="px-2 py-2 bg-gray-100 rounded text-gray-600 font-bold disabled:opacity-40">↩ คืนพื้นที่</button>
              </div>
            ))}
            {plotSyncStatus && <p role="status" className="text-[10px] text-gray-500">{plotSyncStatus}</p>}
          </div>
        </div>
      )}


      {/* ปุ่มควบคุมด้านขวา */}
      <div className="absolute top-4 right-4 z-[400] hidden sm:flex flex-col gap-2 items-end">
        <button
          onClick={() => {
            setIsMapFullScreen(!isMapFullScreen);
            setTimeout(() => mapInstance.current?.invalidateSize(), 300);
          }}
          className="bg-white text-gray-800 px-3 py-2 rounded-lg shadow-lg border border-gray-300 font-bold text-xs hover:bg-gray-100 transition"
        >
          {isMapFullScreen ? '↙️ ย่อหน้าจอ' : '🔲 ขยายเต็มจอ'}
        </button>

        {pathData.length > 0 && (
          <>
            <button onClick={fitAllRoute} className="bg-white text-blue-700 px-3 py-2 rounded-lg shadow-lg border border-blue-200 font-bold text-xs hover:bg-blue-50 transition">
              🗺️ ดูเส้นทางทั้งหมด
            </button>
            {trackingMode === 'realtime' && (
              <button onClick={() => setAutoFollow(v => !v)} className={`px-3 py-2 rounded-lg shadow-lg border font-bold text-xs transition ${autoFollow ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-700 border-gray-300'}`}>
                {autoFollow ? '🎯 ตามรถ: เปิด' : '🖐️ ดูแผนที่อิสระ'}
              </button>
            )}
          </>
        )}
      </div>

      {/* 📱 ปุ่มลอยบนมือถือ: เหลือเฉพาะสิ่งที่ใช้บ่อย เพื่อไม่บังแผนที่ */}
      <div className="sm:hidden absolute top-3 right-3 z-[430] flex flex-col gap-2 items-end">
        <button
          onClick={() => {
            setIsMapFullScreen(!isMapFullScreen);
            setTimeout(() => mapInstance.current?.invalidateSize(), 300);
          }}
          className="w-11 h-11 rounded-full bg-white/95 backdrop-blur shadow-lg border border-gray-200 text-lg flex items-center justify-center active:scale-95"
          title={isMapFullScreen ? 'ย่อแผนที่' : 'ขยายแผนที่'}
        >
          {isMapFullScreen ? '↙️' : '⛶'}
        </button>

        {pathData.length > 0 && (
          <button
            onClick={fitAllRoute}
            className="w-11 h-11 rounded-full bg-white/95 backdrop-blur shadow-lg border border-blue-200 text-lg flex items-center justify-center active:scale-95"
            title="ดูเส้นทางทั้งหมด"
          >
            🗺️
          </button>
        )}

        {pathData.length > 0 && trackingMode === 'realtime' && (
          <button
            onClick={() => setAutoFollow(v => !v)}
            className={`w-11 h-11 rounded-full shadow-lg border text-lg flex items-center justify-center active:scale-95 ${autoFollow ? 'bg-blue-600 text-white border-blue-700' : 'bg-white/95 text-gray-800 border-gray-200'}`}
            title={autoFollow ? 'กำลังตามรถ' : 'ตามรถ'}
          >
            🎯
          </button>
        )}
      </div>

      {/* 📱 แถบเครื่องมือย่อด้านล่างบนมือถือ */}
      {!drawMode && !routeEdit && (
        <div
          className="absolute left-3 right-3 sm:right-auto z-[430] flex items-center gap-2 pointer-events-none"
          style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <button
            onClick={() => { setExclusionPanelIndex(null); setMobileToolsOpen(v => !v); }}
            className={`pointer-events-auto h-11 px-4 rounded-full shadow-xl border font-black text-xs flex items-center gap-1.5 active:scale-95 ${mobileToolsOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white/95 text-gray-800 border-gray-200'}`}
          >
            ☰ เครื่องมือ
          </button>

          {pathData.length > 0 && (
            <button
              onClick={() => {
                setMobileToolsOpen(false);
                generateAutoPlot();
              }}
              disabled={isAutoPlotting || isSavingPlot}
              className={`pointer-events-auto h-11 px-4 rounded-full shadow-xl border font-black text-xs active:scale-95 ${isAutoPlotting ? 'bg-gray-200 text-gray-400 border-gray-300' : 'bg-indigo-600 text-white border-indigo-700'}`}
            >
              {isAutoPlotting ? '⏳...' : '✨ Auto'}
            </button>
          )}

          {plots.length > 0 && (
            <div className="min-w-0 overflow-hidden text-ellipsis pointer-events-none ml-auto bg-white/95 backdrop-blur border border-amber-200 rounded-full shadow-lg px-3 h-11 flex items-center text-[10px] font-black text-amber-800 whitespace-nowrap">
              🌾 {plots.length} แปลง • {formatThaiRai(overallProgress.totalRai)}
            </div>
          )}
        </div>
      )}

      {/* 📱 Bottom sheet เครื่องมือ — เปิดเฉพาะเมื่อผู้ใช้ต้องการ */}
      {mobileToolsOpen && !drawMode && !routeEdit && (
        <>
          <button
            aria-label="ปิดเครื่องมือ"
            onClick={() => setMobileToolsOpen(false)}
            className="absolute inset-0 z-[435] bg-black/10"
          />
          <div
            className="absolute left-2 right-2 sm:right-auto sm:w-96 z-[450] bg-white backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
            style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom))', maxHeight: '58%' }}
          >
            <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <p className="font-black text-sm text-gray-800">🛠️ เครื่องมือแผนที่</p>
                <p className="text-[9px] text-gray-500">เปิดเฉพาะตอนใช้งาน แผนที่จะได้ไม่โดนบัง</p>
              </div>
              <button onClick={() => setMobileToolsOpen(false)} className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 font-black">✕</button>
            </div>

            <div className="p-3 overflow-y-auto" style={{ maxHeight: 'calc(48dvh - 3.25rem)' }}>
              <div className="flex gap-2 mb-2">
                <button disabled={isSavingPlot} onClick={()=>setPlotReload(n=>n+1)} className="bg-blue-50 text-blue-800 rounded-xl px-3 text-xs font-bold">โหลดแปลงล่าสุด</button>
                <button disabled={isSavingPlot || plotRevision===null} onClick={()=>{const backup=readPlotBackup();if(!backup.pending)return alert('ไม่มีฉบับแก้ไขรอบันทึก');if(window.confirm('เปิดฉบับสำรองเพื่อตรวจคิวก่อนบันทึกแทนแปลงของรถและวันนี้?'))openLinkReview(hydratePlots(backup.plots),backup.plots.map((_,i)=>i));}} className="bg-slate-100 rounded-xl px-3 text-xs">กู้ฉบับในเครื่อง</button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => {setMobileToolsOpen(false);setCutMode('erase');setCutSelection([]);setCutAnchor(null);setRouteEdit(true); setIsMapFullScreen(true); setTimeout(() => mapInstance.current?.invalidateSize(), 300);setAutoFollow(false);}} className="bg-slate-900 text-white rounded-xl font-black text-sm">✂ ตัดเส้นเดินรถ</button>
                <button onClick={() => setShowExcluded(v => !v)} className="bg-slate-100 rounded-xl font-bold text-xs">{showExcluded ? 'ซ่อนเส้นที่ตัด' : 'ดูเส้นที่ตัด'}</button>
                <button
                  onClick={() => {
                    setAutoFollow(false);
                    setEditingPlotIndex(null);
                    setDraftKind('manual');
                    setHoleEditor(null);
                    setDraftHistory([]);
                    setExclusionPanelIndex(null);
                    setPoints([]);
                    setDrawMode(true);
                    setMobileToolsOpen(false);
                  }}
                  className="bg-white border border-gray-300 rounded-xl py-2.5 px-2 font-black text-xs text-gray-800 shadow-sm"
                >
                  📏 วาดแปลงมือ
                </button>

                <button
                  onClick={() => {
                    const value = window.prompt('ความกว้างหัวเกี่ยว (เมตร)', String(headWidthMeters));
                    if (value === null) return;
                    const n = Number(value);
                    if (!Number.isFinite(n) || n < 1 || n > 15) return alert('กรุณาใส่ความกว้าง 1 - 15 เมตรครับ');
                    setHeadWidthMeters(n);
                  }}
                  className="bg-amber-50 border border-amber-300 rounded-xl py-2.5 px-2 font-black text-xs text-amber-800 shadow-sm"
                >
                  ⚙️ หัวเกี่ยว {headWidthMeters.toFixed(1)} ม.
                </button>

                {pathData.length > 0 && (
                  <button
                    onClick={() => {
                      setMobileToolsOpen(false);
                      generateAutoPlot();
                    }}
                    disabled={isAutoPlotting || isSavingPlot}
                    className={`col-span-2 rounded-xl py-2.5 px-3 font-black text-xs shadow-sm border ${isAutoPlotting ? 'bg-gray-200 text-gray-400 border-gray-300' : 'bg-indigo-600 text-white border-indigo-700'}`}
                  >
                    {isAutoPlotting ? '⏳ กำลังแยกหลายแปลง...' : '✨ วาดแปลงออโต้'}
                  </button>
                )}
              </div>

              {plotSyncStatus && (
                <div className="mt-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[10px] font-bold text-gray-600">
                  {plotSyncStatus}
                </div>
              )}

              {plots.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-black text-xs text-amber-800">🌾 แปลงที่บันทึก ({plots.length})</p>
                    <p className="font-black text-xs text-gray-700">รวม {formatThaiRai(overallProgress.totalRai)}</p>
                  </div>

                  <div className="space-y-2">
                    {plots.map((plot, i) => {
                      const progress = plotProgressList[i] || { percent: 0, coveredRai: 0, totalRai: Number(plot.area?.rawRai || 0) };
                      const center = plot.center || centerFromPoints(plot.points);
                      const centerText = center ? (center.text || `${Number(center.lat).toFixed(6)}, ${Number(center.lng).toFixed(6)}`) : '';
                      return (
                        <div key={`mobile-plot-${i}`} className="bg-amber-50 border border-amber-100 rounded-xl p-2.5">
                          <p className="font-black text-sm text-slate-900">{plot.name || `แปลงที่ ${i+1}`}</p>
                          <div className="flex gap-2 my-2">
                            <button disabled={isSavingPlot || plotRevision===null} onClick={()=>openLinkReview(plots,[i])} className="bg-white border rounded-xl px-2 text-xs font-bold">{plot.job_id ? `เปลี่ยนคิว #${plot.job_id}` : 'เลือกคิวเจ้าของแปลง'}</button>
                            {plot.job_id && <button onClick={()=>onOpenJob?.(plot.job_id)} className="bg-blue-100 text-blue-800 rounded-xl px-2 text-xs font-bold">เปิดคิวงาน ↗</button>}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="font-black text-xs text-amber-800">แปลง {i + 1} <span className="text-blue-700">• {progress.percent.toFixed(0)}%</span></p>
                              <p className="text-[9px] font-bold text-gray-500">{plot.area?.text || formatThaiRai(progress.totalRai || 0)} • เกี่ยว ~{formatThaiRai(progress.coveredRai)}</p>
                            </div>
                            <div className="flex gap-1">
                              <button
                                disabled={isSavingPlot}
                                onClick={() => {
                                  openPlotEditor(i);
                                  setMobileToolsOpen(false);
                                }}
                                className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 font-black disabled:opacity-40"
                                title="แก้ไขขอบแปลง"
                              >✏️</button>
                              <button
                                disabled={isSavingPlot}
                                onClick={() => savePlotsToServer(plots.filter((_, idx) => idx !== i))}
                                className="w-9 h-9 rounded-lg bg-red-100 text-red-600 font-black disabled:opacity-40"
                                title="ลบแปลง"
                              >✕</button>
                            </div>
                          </div>
                    <button disabled={isSavingPlot || isAutoPlotting} onClick={() => openExclusionPanel(i)} className="mt-1 w-full py-1.5 rounded border border-red-200 bg-white text-red-700 text-[10px] font-bold disabled:opacity-40">🕳️ พื้นที่หัก {(plot.holes || []).length} วง{(plot.holeSuggestions || []).some(h => h.status === 'pending') ? ' • รอยืนยัน' : ''}</button>
                          <div className="mt-2 h-1.5 bg-white rounded-full overflow-hidden border border-blue-100">
                            <div className="h-full bg-blue-600 rounded-full" style={{ width: `${progress.percent}%` }} />
                          </div>
                          {center && (
                            <button
                              onClick={() => copyPlotCenter({ ...center, text: centerText })}
                              className="mt-2 w-full text-left bg-white border border-sky-100 rounded-lg px-2 py-1.5 text-[9px] font-black text-sky-700"
                            >
                              📍 {centerText} <span className="float-right">📋</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 bg-blue-50 border border-blue-100 rounded-xl p-2.5">
                    <div className="flex items-center justify-between text-xs font-black">
                      <span className="text-blue-900">📈 ความคืบหน้ารวม</span>
                      <span className="text-blue-700">{overallProgress.percent.toFixed(0)}%</span>
                    </div>
                    <div className="mt-1.5 h-2 bg-white rounded-full overflow-hidden border border-blue-100">
                      <div className="h-full bg-blue-600 rounded-full" style={{ width: `${overallProgress.percent}%` }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {!routeReady && !routeEdit && !drawMode && <div role="status" className="absolute top-16 left-3 right-16 sm:right-auto sm:max-w-xs z-[420] bg-amber-50 text-amber-900 rounded-xl shadow p-2 text-xs font-bold">{routeMessage}<button onClick={() => setReloadRoute(n => n+1)} className="ml-2 underline">ลองใหม่</button></div>}
      {/* GPS mini dashboard */}
      {pathData.length > 0 && !drawMode && !routeEdit && !mobileToolsOpen && (
        <div className="hidden sm:block absolute bottom-20 left-4 z-[390] bg-white/95 backdrop-blur rounded-xl shadow-xl border border-gray-200 p-2.5 max-w-[calc(100%-90px)]">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold text-gray-700">
            <span className={trackingMode === 'realtime' ? (statusOnline ? 'text-green-600' : 'text-orange-600') : 'text-purple-600'}>
              {trackingMode === 'realtime' ? (statusOnline ? '● ออนไลน์' : '● สัญญาณเงียบ') : '🕒 ประวัติ'}
            </span>
            <span>🛣️ {gpsStats.totalKm.toFixed(2)} กม.</span>
            <span className="text-blue-700">🌾 เกี่ยว {gpsStats.harvestKm.toFixed(2)} กม.</span>
            {plots.length > 0 && <span className="text-blue-700">📈 {overallProgress.percent.toFixed(0)}%</span>}
            <span>⏱️ {durationText}</span>
            <span>📡 {gpsStats.points.toLocaleString()} จุด</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[9px] text-gray-500">
            <span className="flex items-center gap-1"><i className="inline-block w-3 h-1 rounded bg-blue-600"></i> กำลังเกี่ยว/ประเมิน</span>
            <span className="flex items-center gap-1"><i className="inline-block w-3 h-1 rounded bg-fuchsia-500 opacity-60"></i> วิ่งทั่วไป</span>
          </div>
        </div>
      )}

      {/* 📱 สถานะย่อบนมือถือ ไม่บังแผนที่ */}
      {pathData.length > 0 && !drawMode && !routeEdit && !mobileToolsOpen && exclusionPanelIndex === null && (
        <div
          className="sm:hidden absolute left-3 z-[410] bg-white/90 backdrop-blur rounded-full shadow-lg border border-gray-200 px-3 py-1.5 max-w-[calc(100%-5.5rem)]"
          style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-2 text-[9px] font-black text-gray-700 whitespace-nowrap overflow-hidden">
            <span className={trackingMode === 'realtime' ? (statusOnline ? 'text-green-600' : 'text-orange-600') : 'text-purple-600'}>
              {trackingMode === 'realtime' ? (statusOnline ? '● Online' : '● เงียบ') : '🕒 ประวัติ'}
            </span>
            <span>🛣️ {gpsStats.totalKm.toFixed(2)}กม.</span>
            <span className="text-blue-700">🌾 {gpsStats.harvestKm.toFixed(2)}กม.</span>
            {plots.length > 0 && <span className="text-blue-700">📈 {overallProgress.percent.toFixed(0)}%</span>}
          </div>
        </div>
      )}

      {/* Compact editor: real-time net area, movable vertices, undo and cancel. */}
      {drawMode && (
        <>
          <div className="absolute top-3 left-3 right-16 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[430] bg-white/95 backdrop-blur px-3 py-2 rounded-xl shadow-lg border border-orange-300 pointer-events-none sm:min-w-72 sm:max-w-[75%]">
            <p className="font-black text-xs text-orange-800">{isHoleDraft ? '✂️ พื้นที่หัก' : '📏 ขอบแปลง'}{editingPlotIndex !== null ? ` • แปลง ${editingPlotIndex + 1}` : ''}</p>
            <p aria-live="polite" className="text-xs font-bold text-green-800">สุทธิ: {currentArea.text}</p>
            {currentArea.excludedText && <p className="text-[10px] text-red-700">หักรวม: {currentArea.excludedText}</p>}
            <p className="text-[10px] text-gray-500">{canAddDraftPoints ? 'แตะรอบพื้นที่ • ลากจุดเพื่อปรับวง' : 'ลากจุดเพื่อปรับวง • แตะ + บนเส้นเพื่อเพิ่มมุม'}</p>
            {draftError && <p role="alert" className="text-[10px] font-bold text-red-700">{draftError}</p>}
          </div>
          {canAddDraftPoints && <div className="sm:hidden absolute inset-0 flex items-center justify-center pointer-events-none z-[410]"><span className="text-3xl text-red-600 font-light drop-shadow">＋</span></div>}
          <div className="absolute left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[460] flex flex-wrap sm:flex-nowrap justify-center items-center bg-white/95 backdrop-blur p-2 rounded-2xl shadow-xl border border-gray-200 gap-1.5" style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
            <button onClick={cancelDraft} disabled={isSavingPlot} className="px-3 py-2.5 rounded-xl bg-red-50 text-red-700 font-bold text-xs disabled:opacity-40">ยกเลิก</button>
            <button onClick={undoDraft} disabled={!draftHistory.length || isSavingPlot} className="px-3 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-bold text-xs disabled:opacity-40">↩ ย้อน</button>
            {canAddDraftPoints && <button onClick={() => {
              const center = mapInstance.current?.getCenter();
              if (center) changeDraftPoints([...points, { lat: center.lat, lng: center.lng }]);
            }} disabled={isSavingPlot} className="sm:hidden px-3 py-2.5 rounded-xl bg-blue-100 text-blue-800 font-bold text-xs disabled:opacity-40">+ จุด</button>}
            <button onClick={saveDraft} disabled={points.length < 3 || !!draftError || isSavingPlot || plotRevision===null || !vehicleId || !workDate} className="px-3 sm:px-5 py-2.5 rounded-xl bg-green-600 text-white font-black text-xs whitespace-nowrap disabled:bg-gray-200 disabled:text-gray-400">
              {isSavingPlot ? '⏳ บันทึก...' : isHoleDraft ? '✅ บันทึกหักพื้นที่' : '💾 บันทึกแปลง'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function App() {
  const [gpsFocusPlot, setGpsFocusPlot] = useState(null);
  const [gpsJobDetail, setGpsJobDetail] = useState(null);
  const [jobs, setJobs] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [activeTab, setActiveTab] = useState('home')
  const [financeSubTab, setFinanceSubTab] = useState('dashboard'); // 👈 เพิ่ม State สำหรับคุมเมนูย่อยในหน้าบัญชี
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [customersList, setCustomersList] = useState([])
  const [weatherData, setWeatherData] = useState(null);
  const [weatherLocationName, setWeatherLocationName] = useState('กำลังค้นหาพิกัด...');
  const [isMapFullScreen, setIsMapFullScreen] = useState(false);


  // 📸 State สำหรับระบบแกลเลอรี่รูปภาพ
  const [jobAttachments, setJobAttachments] = useState([]); // เก็บรูปของงานที่กำลังกดดู
  const [isUploadingImage, setIsUploadingImage] = useState(false); // สถานะตอนกำลังโหลดรูป
  const [uploadCategory, setUploadCategory] = useState('BEFORE'); // หมวดหมู่เริ่มต้น
  const [fullScreenIndex, setFullScreenIndex] = useState(null); // เปลี่ยนมาเก็บลำดับรูปแทน
  const [touchStartX, setTouchStartX] = useState(null); // เก็บพิกัดตอนเริ่มเอานิ้วแตะจอ
  const [touchEndX, setTouchEndX] = useState(null); // เก็บพิกัดตอนลากนิ้ว

  // 🌾 State ระบบ "รอบทำงาน" — งานข้าว 1 ลูกค้าอาจเกี่ยวหลายวัน/หลายแปลงย่อย
  const [workRoundModal, setWorkRoundModal] = useState(null); // { job, mode: 'PARTIAL' | 'FINAL' }
  const [workRoundData, setWorkRoundData] = useState({
    measuredArea: '',
    measuredMode: 'MANUAL', // GPS = ใช้ยอดที่ยังไม่ลงรอบ, MANUAL = ปรับเอง
    billingArea: '',
    wagePerRai: 60,
    workers: '',
    nextWorkDate: '',
    note: ''
  });
  const [isSavingWorkRound, setIsSavingWorkRound] = useState(false);

  // 🔍 ตรวจความสัมพันธ์ของ Job ID เดียวกัน: GPS / รอบงาน / ค่าแรง / ลูกหนี้ / audit
  const [jobIntegrityModal, setJobIntegrityModal] = useState(null);
  const [jobIntegrityLoading, setJobIntegrityLoading] = useState(false);

  // 📐 แก้ไร่ที่ลูกค้ายืนยันหลังปิดงาน — กระทบยอดลูกค้า + ค่าแรง แต่ไม่แตะวัดจริง
  const [billingAdjustModal, setBillingAdjustModal] = useState(null);
  const [billingAdjustArea, setBillingAdjustArea] = useState('');
  const [isSavingBillingAdjust, setIsSavingBillingAdjust] = useState(false);

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

  // 🔍 State สำหรับระบบค้นหาประวัติ
  const [historySearch, setHistorySearch] = useState('');

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
  const [gpsDataScope, setGpsDataScope] = useState('');
  const gpsRequestSeq = useRef(0);
  const [isFetchingGps, setIsFetchingGps] = useState(false);
  const [gpsFocusRequest, setGpsFocusRequest] = useState(0); // เพิ่มเมื่อกดค้นหา เพื่อพาแผนที่ไปหารถ 1 ครั้ง
  const [showGpsMobilePanel, setShowGpsMobilePanel] = useState(false); // 📱 ตั้งค่าค้นหา GPS แบบ bottom sheet

  // วันที่อ้างอิงของ GPS/แปลง ใช้ค่าเดียวกันทั้งค้นหาเส้นทางและบันทึกแปลง
  const getLocalDateString = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 10);
  };
  const effectiveTrackingDate = trackingMode === 'realtime' ? getLocalDateString() : trackingDate;

  const gpsViewScope = `${trackingVehicleId}/${effectiveTrackingDate}`;
  const gpsViewScopeRef = useRef(gpsViewScope);
  gpsViewScopeRef.current = gpsViewScope;
  const visibleGpsPath = gpsDataScope === gpsViewScope ? gpsPathData : [];
  // 🔍 ใช้ฟังก์ชันเดียวกันทั้งคอมและมือถือ
  const searchGpsRoute = async () => {
    if (!trackingVehicleId) {
      alert('กรุณาเลือกรถเกี่ยวครับ');
      return false;
    }

    const requestScope = gpsViewScope;
    const requestSeq = ++gpsRequestSeq.current;
    setIsFetchingGps(true);
    try {
      const dateToSend = effectiveTrackingDate;
      const res = await fetch(`https://harvester-api-server.onrender.com/api/gps/${trackingVehicleId}?date=${dateToSend}`);
      const data = await res.json();

      if (gpsViewScopeRef.current !== requestScope || gpsRequestSeq.current !== requestSeq) return false;
      if (!res.ok) throw new Error(data.error || 'โหลด GPS ไม่สำเร็จ');
      setGpsDataScope(requestScope);
      setGpsPathData(Array.isArray(data) ? data : []);
      if (!Array.isArray(data) || data.length === 0) {
        alert('ไม่มีข้อมูลการวิ่งในวันที่เลือกครับ (รถอาจจะยังไม่สตาร์ท)');
        return false;
      }

      setGpsPathData(data);
      setGpsFocusRequest(prev => prev + 1);
      return true;
    } catch (e) {
      console.error(e);
      alert('ดึงข้อมูล GPS ไม่สำเร็จครับ');
      return false;
    } finally {
      if (gpsRequestSeq.current === requestSeq) setIsFetchingGps(false);
    }
  };
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
          const dateToSend = getLocalDateString();
          
          // แอบไปดึงข้อมูลเงียบๆ หลังบ้าน
          const res = await fetch(`https://harvester-api-server.onrender.com/api/gps/${trackingVehicleId}?date=${dateToSend}`);
          const data = await res.json();
          
          // อัปเดตเส้นทางบนแผนที่
          if (res.ok && Array.isArray(data) && gpsViewScopeRef.current === `${trackingVehicleId}/${dateToSend}`) {
            setGpsDataScope(`${trackingVehicleId}/${dateToSend}`);
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
      const res = await fetch(`https://harvester-api-server.onrender.com/api/transactions/wages?t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      setWageTransactions(data);
    } catch (err) { console.error("ดึงข้อมูลค่าแรงไม่ได้:", err); }
  };

  // 👇 เพิ่ม State และฟังก์ชันดึงประวัติรายจ่าย 👇
  const [expenseTransactions, setExpenseTransactions] = useState([]);
  const fetchExpenses = async () => {
    try {
      const res = await fetch(`https://harvester-api-server.onrender.com/api/transactions/expenses?t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      setExpenseTransactions(data || []);
    } catch (err) { console.error("ดึงข้อมูลรายจ่ายไม่ได้:", err); }
  };

  // ✅ สมุดค่าแรงใช้ข้อมูล 2 ชุดร่วมกันเสมอ: ค่าแรงที่ทำได้ + ประวัติการเบิก
  const refreshWageLedger = async () => {
    await Promise.all([fetchWages(), fetchExpenses()]);
  };

  // ✅ เปิดสมุดค่าแรงเมื่อไร ให้รีเฟรชข้อมูลทั้ง 2 ฝั่งทุกครั้ง
  useEffect(() => {
    if (showWageSummary) {
      refreshWageLedger();
    }
  }, [showWageSummary]);

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
      refreshWageLedger();
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

  const queueAreaRai = (job) => {
    if (job?.status === 'DONE') return Math.max(0, Number(job?.billing_area ?? job?.area_size) || 0);
    const gps = Math.max(0, Number(job?.gps_summary?.area_rai) || 0);
    return gps > 0 ? gps : Math.max(0, Number(job?.area_size) || 0);
  };

  const todayStr = new Date().toDateString();
  // 💡 ดึงงานของวันนี้ "หรือ" งานที่กำลังเกี่ยวอยู่ และงานที่ "รอเกี่ยวต่อ" มาโชว์ด้วย
  const todayJobs = jobs.filter(j => 
    new Date(j.job_date).toDateString() === todayStr || j.status === 'IN_PROGRESS' || j.status === 'PAUSED'
  );
  
  // 👇 แยกคำนวณพื้นที่งานใหม่ของวันนี้ และ งานเก่าที่ค้างมาจากวันอื่น
  const todayOnlyArea = todayJobs.filter(j => new Date(j.job_date).toDateString() === todayStr).reduce((sum, j) => sum + queueAreaRai(j), 0);
  const oldJobsArea = todayJobs.filter(j => new Date(j.job_date).toDateString() !== todayStr).reduce((sum, j) => sum + queueAreaRai(j), 0);
  
  const todayArea = todayJobs.reduce((sum, j) => sum + queueAreaRai(j), 0);
  const todayIncome = todayJobs.reduce((sum, j) => sum + (queueAreaRai(j) * Math.max(0, Number(j.price_per_rai) || 0)), 0);
  
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
      .then(data => { if(Array.isArray(data))setJobs(data); })
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

    // ระบบคิวใหม่: แผนที่ในฟอร์มมีหน้าที่เป็น "จุดนัดหมาย" เท่านั้น
    // ห้ามเอาพื้นที่จาก Polygon มาเขียนทับ area_size (ลูกค้าแจ้งประมาณ)
    setFormData(prev => ({
      ...prev,
      latitude: center[1].toFixed(6),
      longitude: center[0].toFixed(6)
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
      phone: cleanPhoneForUi(job.customers?.phone),
      address_note: job.address_note || job.customers?.address_note || '', // 💡 ดึงหมายเหตุงานก่อน
      crop_type: job.crop_type || 'ข้าว',
      area_size: (job.billing_area ?? job.area_size) || '',
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
        alert(editingId ? '✅ อัปเดตการ์ดงานและซิงก์ข้อมูลตาม Job ID สำเร็จ!' : '✅ บันทึกคิวงานสำเร็จ!');
        setShowAddForm(false);
        setEditingId(null);
        setSelectedDayJobs(null);
        setFormData({ customer_name: '', phone: '', address_note: '', crop_type: 'ข้าว', area_size: '', job_date: '', latitude: '', longitude: '', vehicle_id: 0, boundaries: [], price_per_rai: '', total_price: '', payment_status: 'UNPAID' });
        await fetchJobs();
        await refreshWageLedger();
        await fetchDashboard();
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
      if (response.ok) {
        await fetchJobs();
        // ✅ ปิดงานแล้วมีค่าแรงใหม่ ต้องรีเฟรชทั้งยอดทำได้และยอดเบิก
        if (newStatus === 'DONE' && extraWageData) {
          await refreshWageLedger();
        }
      }
    } catch (err) { console.error(err); }
  }

  // 🌾 4 ตัวเลขหลักของคิว: ประมาณ / GPS / ทำจริง / คิดเงิน
  const getJobGpsArea = (job) => Math.max(0, Number(job?.gps_summary?.area_rai) || 0);
  const getJobBillingArea = (job) => Math.max(0, Number(job?.billing_area ?? 0) || 0);
  const getJobOperationalArea = (job) => {
    if (job?.status === 'DONE') return getJobBillingArea(job) || Math.max(0, Number(job?.area_size) || 0);
    const gps = getJobGpsArea(job);
    return gps > 0 ? gps : Math.max(0, Number(job?.area_size) || 0);
  };

  // measuredArea = ทำจริงที่บันทึกรอบแล้ว, wageArea = ไร่ค่าแรงที่จัดสรรแล้ว
  // postedWageArea นับเฉพาะรอบที่มี transaction แล้ว เพื่อไม่ให้คำว่า "ลงสมุด" หลอกตา
  const getJobWorkSummary = (job) => {
    const rounds = Array.isArray(job?.work_rounds) ? job.work_rounds : [];
    const measuredArea = rounds.reduce((sum, r) => sum + (Number(r.measured_area) || 0), 0);
    const wageArea = rounds.reduce((sum, r) => sum + (Number(r.wage_area) || 0), 0);
    const postedWageArea = rounds.reduce((sum, r) => sum + (r.wage_transaction_id ? (Number(r.wage_area) || 0) : 0), 0);
    const pendingRoundCount = rounds.filter(r => !r.wage_transaction_id).length;
    return { rounds, roundCount: rounds.length, measuredArea, wageArea, postedWageArea, pendingRoundCount };
  };

  const openWorkRoundModal = (job, mode = 'PARTIAL') => {
    const summary = getJobWorkSummary(job);
    const gpsTotal = getJobGpsArea(job);
    const pendingGps = Math.max(0, gpsTotal - summary.measuredArea);
    const useGps = Number(job?.gps_summary?.plot_count || 0) > 0 && !job?.gps_summary_error && pendingGps > 0.000001;
    setWorkRoundData({
      measuredArea: useGps ? String(Number(pendingGps.toFixed(6))) : '',
      measuredMode: useGps ? 'GPS' : (mode === 'FINAL' ? 'NONE' : 'MANUAL'),
      // ช่องคิดเงินเก็บเป็น "ไร่" ตาม API เดิม แต่ UI ไม่โชว์เลข GPS ยาว ๆ
      billingArea: mode === 'FINAL' && gpsTotal > 0 ? String(normalizeRaiNganValue(gpsTotal)) : '',
      wagePerRai: 60,
      workers: '',
      nextWorkDate: '',
      note: ''
    });
    setWorkRoundModal({ job, mode, summary, gpsTotal, pendingGps });
  };

  const inspectJobIntegrity = async (job) => {
    setJobIntegrityLoading(true);
    setJobIntegrityModal({ job, loading:true });
    try {
      const res = await fetch(`https://harvester-api-server.onrender.com/api/jobs/${job.id}/integrity`, { cache:'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ตรวจยอดไม่สำเร็จ');
      setJobIntegrityModal({ job, loading:false, data });
    } catch (e) {
      setJobIntegrityModal({ job, loading:false, error:e.message || String(e) });
    } finally { setJobIntegrityLoading(false); }
  };

  const toggleRoundWorker = (name) => {
    setWorkRoundData(prev => {
      const current = String(prev.workers || '').split(',').map(v => v.trim()).filter(Boolean);
      const next = current.includes(name) ? current.filter(v => v !== name) : [...current, name];
      return { ...prev, workers: next.join(', ') };
    });
  };

  const submitWorkRound = async () => {
    if (!workRoundModal || isSavingWorkRound) return;
    const { job, mode } = workRoundModal;
    const currentSummary = getJobWorkSummary(job);
    const measuredToday = Math.max(0, Number(workRoundData.measuredArea) || 0);
    const billingRaw = String(workRoundData.billingArea ?? '').trim();
    const billingArea = billingRaw === '' ? NaN : Number(billingRaw);
    const workers = String(workRoundData.workers || '').trim();
    const wagePerRai = Math.max(0, Number(workRoundData.wagePerRai) || 60);

    if (mode === 'PARTIAL') {
      if (measuredToday <= 0) return alert('กรุณาระบุพื้นที่ที่ทำจริงวันนี้ครับ');
      if (!workers) return alert('กรุณาระบุคนที่ลงแปลงวันนี้ครับ');
    } else {
      if (!Number.isFinite(billingArea) || billingArea < 0) return alert('กรุณาระบุพื้นที่ที่ตกลงคิดเงินกับลูกค้าครับ');
      if (measuredToday > 0 && !workers) return alert('วันนี้มีพื้นที่เกี่ยวเพิ่ม กรุณาระบุคนที่รับค่าแรงรอบสุดท้ายครับ');
      if (currentSummary.roundCount === 0 && measuredToday <= 0 && billingArea > 0 && !workers) {
        return alert('ยังไม่มีรอบงานเดิม กรุณาระบุคนที่จะรับค่าแรงก่อนปิดงานครับ');
      }
    }

    setIsSavingWorkRound(true);
    try {
      const isPartial = mode === 'PARTIAL';
      const url = isPartial
        ? `https://harvester-api-server.onrender.com/api/jobs/${job.id}/rounds`
        : `https://harvester-api-server.onrender.com/api/jobs/${job.id}/finalize`;

      const payload = isPartial
        ? {
            measured_area: measuredToday,
            measured_source: workRoundData.measuredMode,
            workers,
            wage_per_rai: wagePerRai,
            next_work_date: workRoundData.nextWorkDate ? new Date(workRoundData.nextWorkDate).toISOString() : null,
            note: workRoundData.note
          }
        : {
            measured_area: measuredToday,
            measured_source: workRoundData.measuredMode,
            billing_area: billingArea,
            workers,
            wage_per_rai: wagePerRai,
            note: workRoundData.note
          };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      let result = {};
      try { result = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error(`${result.error || `HTTP ${res.status}`}${result.code ? ` [${result.code}]` : ''}`);

      if (isPartial) {
        const totalMeasured = currentSummary.measuredArea + measuredToday;
        alert(
          `✅ ปิดรอบวันนี้แล้ว\n\n` +
          `📐 ทำจริงรอบนี้: ${formatRaiNgan(measuredToday)}\n` +
          `📐 วัดจริงสะสม: ${formatRaiNgan(totalMeasured)}\n` +
          `👷 คนทำรอบนี้: ${workers}\n` +
          `💵 เรทค่าแรง: ${wagePerRai.toLocaleString()} บาท/ไร่\n\n` +
          `📝 ยังไม่ลงสมุดค่าแรง — จะลงพร้อมกันตอน 🏁 จบงานทั้งหมด\n` +
          `${workRoundData.nextWorkDate ? '📅 บันทึกวันนัดเกี่ยวต่อแล้ว' : '⏸ รอลูกค้านัดวันเกี่ยวต่อ'}`
        );
      } else {
        const s = result.summary || {};
        alert(
          `🏁 ปิดงานทั้งหมดเรียบร้อย\n\n` +
          `📐 วัดจริงทั้งหมด: ${formatRaiNgan(s.measured_area_total || 0)}\n` +
          `🤝 ลูกค้ารับคิดเงิน: ${formatRaiNgan(s.billing_area ?? billingArea)}\n` +
          `👷 แบ่งเข้าค่าแรงรวม: ${formatRaiNgan(s.wage_area_total || 0)}\n` +
          `💰 ลงสมุดค่าแรง: ${Number(s.wage_amount_total || 0).toLocaleString()} บาท\n` +
          `📚 จำนวนรอบค่าแรง: ${Number(s.wage_rounds_posted || 0)} รอบ\n` +
          `💵 ยอดลูกค้า: ${Number(s.total_price || 0).toLocaleString()} บาท`
        );
      }

      setWorkRoundModal(null);
      await fetchJobs();
      if (!isPartial) await refreshWageLedger();
      await fetchDashboard();
    } catch (err) {
      console.error(err);
      alert(`❌ บันทึกรอบงานไม่สำเร็จ\n${err.message}`);
    } finally {
      setIsSavingWorkRound(false);
    }
  };

  const openBillingAreaAdjust = (job) => {
    if (!job) return;
    const currentArea = Number((job.billing_area ?? job.area_size) || 0);
    setBillingAdjustArea(String(normalizeRaiNganValue(currentArea)));
    setBillingAdjustModal(job);
  };

  const submitBillingAreaAdjust = async () => {
    if (!billingAdjustModal || isSavingBillingAdjust) return;
    const newArea = Number(billingAdjustArea);
    if (!Number.isFinite(newArea) || newArea < 0) return alert('กรุณาระบุพื้นที่ที่ลูกค้ายืนยันให้ถูกต้องครับ');

    const oldArea = Number((billingAdjustModal.billing_area ?? billingAdjustModal.area_size) || 0);
    if (Math.abs(newArea - oldArea) < 0.000001) return alert('พื้นที่ยังเท่าเดิมครับ');

    const direction = newArea < oldArea ? 'ลด' : 'เพิ่ม';
    const confirmText =
      `📐 ยืนยัน${direction}ไร่ตามที่ลูกค้าบอก?\n\n` +
      `เดิมคิดเงิน: ${formatRaiNgan(oldArea)}\n` +
      `ลูกค้ายืนยันใหม่: ${formatRaiNgan(newArea)}\n` +
      `ต่างกัน: ${formatSignedRaiNgan(newArea - oldArea)}\n\n` +
      `✅ ยอดเงินลูกค้าจะคำนวณใหม่\n` +
      `✅ ค่าแรงของแปลง/บิลนี้จะปรับตรงตามไร่ใหม่ (ไม่แตะแปลงอื่น)\n` +
      `🔒 พื้นที่ที่วัดจริงจะไม่ถูกแก้ทับ\n` +
      `💸 ส่วนลดเป็นจำนวนเงินยังแยกเหมือนเดิม`;
    if (!window.confirm(confirmText)) return;

    setIsSavingBillingAdjust(true);
    try {
      const res = await fetch(`https://harvester-api-server.onrender.com/api/jobs/${billingAdjustModal.id}/billing-area`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_area: newArea })
      });
      let result = {};
      try { result = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error(`${result.error || `HTTP ${res.status}`}${result.code ? ` [${result.code}]` : ''}`);

      const s = result.summary || {};
      alert(
        `✅ ปรับไร่ลูกค้าเรียบร้อย\n\n` +
        `📐 วัด/ข้อมูลเดิม: ${formatRaiNgan(s.measured_or_original_area || 0)} (ไม่แก้)\n` +
        `🤝 พื้นที่คิดเงิน: ${formatRaiNgan(s.old_billing_area || oldArea)} → ${formatRaiNgan(s.new_billing_area || newArea)}\n` +
        `👷 พื้นที่ค่าแรง: ${formatRaiNgan(s.wage_area_before || 0)} → ${formatRaiNgan(s.wage_area_after || 0)}\n` +
        `💰 ค่าแรงเปลี่ยน: ${Number(s.wage_amount_delta || 0) >= 0 ? '+' : ''}${Number(s.wage_amount_delta || 0).toLocaleString()} บาท\n` +
        `💵 ยอดค้างใหม่: ${Number(s.new_debt || 0).toLocaleString()} บาท` +
        (s.wage_warning ? `\n\n⚠️ ${s.wage_warning}` : '')
      );

      setBillingAdjustModal(null);
      await fetchJobs();
      await refreshWageLedger();
      await fetchDashboard();
    } catch (err) {
      console.error(err);
      alert(`❌ ปรับไร่ลูกค้าไม่สำเร็จ\n${err.message}`);
    } finally {
      setIsSavingBillingAdjust(false);
    }
  };

  const getStatusDisplay = (status) => {
    switch (status) {
      case 'PENDING': return { text: 'รอคิว', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' }
      case 'IN_PROGRESS': return { text: 'กำลังเกี่ยว', color: 'bg-blue-100 text-blue-800 border-blue-300' }
      case 'DONE': return { text: 'เสร็จสิ้น', color: 'bg-green-100 text-green-800 border-green-300' }
      case 'PAUSED': return { text: 'รอเกี่ยวต่อ', color: 'bg-rose-100 text-rose-800 border-rose-300' }
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
      if (newStatus === 'PAID' || newStatus === 'DEPOSIT') {
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

  // 🔍 1. กรองประวัติตามคำค้นหา (ชื่อ, เบอร์, ชนิดพืช, หมายเหตุ)
  const filteredHistoryJobs = historyJobs.filter(j => {
     if (!historySearch.trim()) return true;
     const keyword = historySearch.toLowerCase();
     const name = (j.customers?.name || '').toLowerCase();
     const phone = (j.customers?.phone || '').toLowerCase();
     const crop = (j.crop_type || '').toLowerCase();
     const note = (j.address_note || j.customers?.address_note || '').toLowerCase();
     return name.includes(keyword) || phone.includes(keyword) || crop.includes(keyword) || note.includes(keyword);
  });

  // 🔍 2. เอาผลลัพธ์ที่กรองแล้วมาแบ่งหน้า
  const totalPages = Math.ceil(filteredHistoryJobs.length / itemsPerPage);
  const currentHistoryJobs = filteredHistoryJobs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
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
                    {formatRaiNgan(todayOnlyArea)}
                  </span>
                  
                  {/* 👇 ปรับป้ายงานเก่าให้ใหญ่ สีชัดขึ้น และเพิ่มไอคอน 👇 */}
                  {oldJobsArea > 0 && (
                    <span className="mt-2.5 text-[11px] sm:text-xs font-black text-red-700 bg-red-100 px-3 py-1.5 rounded-lg border border-red-300 shadow-sm flex items-center gap-1">
                      ⚠️ + งานค้าง {formatRaiNgan(oldJobsArea)}
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
                      {activeJobNow ? `ลูกค้า: ${activeJobNow.customers?.name} (${formatRaiNgan(queueAreaRai(activeJobNow))}${Number(activeJobNow.gps_summary?.area_rai || 0)>0?' GPS':' ประมาณ'})` : 'รอรับคำสั่งงานถัดไป'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. คิวงานวันนี้ */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-gray-800 text-sm">🚜 คิวงาน</h3>
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
                          {!isToday && (
                            <span className={`text-[9px] font-bold block mt-1 ${job.status === 'PAUSED' ? 'text-rose-600' : 'text-red-500'}`}>
                              {job.status === 'PAUSED' ? (jobDate > new Date() ? 'นัดต่อ' : 'รอนัด') : 'ค้าง!'}
                            </span>
                          )}
                        </div>
                        
                        {/* 👤 ตรงกลาง: ชื่อลูกค้า จัดให้อยู่กึ่งกลาง */}
                        <div className="flex-1 text-center pr-2">
                          <p className={`text-sm font-black ${isDone ? 'text-green-800' : 'text-gray-900'}`}>{job.customers?.name}</p>
                          {(() => {
                            const ws = getJobWorkSummary(job);
                            return (
                              <>
                                <p className="text-xs text-gray-500 font-semibold mt-1">
                                  {job.crop_type === 'ข้าวโพด' ? '🌽' : job.crop_type === 'ถั่ว' ? '🥜' : '🌾'} {Number(job.gps_summary?.area_rai || 0) > 0
                                    ? `🛰️ ${Number(job.gps_summary?.plot_count || 0)} แปลง • ${plotThaiArea(Number(job.gps_summary.area_rai)*1600).text}`
                                    : job.area_size ? `🗣️ ประมาณ ~${formatRaiNgan(job.area_size)}` : 'ยังไม่มีพื้นที่'}
                                </p>
                                {ws.roundCount > 0 && (
                                  <p className="text-[10px] text-emerald-700 font-black mt-0.5">✅ ทำจริง {formatRaiNgan(ws.measuredArea)} • {ws.roundCount} รอบ</p>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        
                        {/* 🏷️ ฝั่งขวา: ป้ายสถานะ */}
                        <div className="shrink-0">
                          {isDone ? <span className="text-green-600 font-bold text-[10px] bg-green-100 px-2.5 py-1.5 rounded-lg">✅ เสร็จ</span> : 
                           job.status === 'IN_PROGRESS' ? <span className="bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded-lg text-[10px] font-bold">กำลังเกี่ยว</span> : 
                           job.status === 'PAUSED' ? <span className="bg-rose-100 text-rose-800 border border-rose-200 px-2.5 py-1.5 rounded-lg text-[10px] font-bold">{new Date(job.job_date) > new Date() ? '📅 นัดเกี่ยวต่อ' : '⏸ รอลูกค้านัด'}</span> :
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
          <div data-gps-shell className={isMapFullScreen ? "fixed inset-0 z-[500] bg-white flex flex-col pb-[env(safe-area-inset-bottom)]" : "bg-white sm:rounded-xl shadow-md border border-gray-200 overflow-hidden flex flex-col h-[calc(100dvh-5.5rem)] sm:h-[75vh] min-h-[500px]"}>
            
            {/* 📱 Mobile GPS header — สูงนิดเดียว ไม่กินพื้นที่แผนที่ */}
            <div className="sm:hidden h-12 shrink-0 px-2.5 bg-white border-b border-gray-200 z-[470] flex items-center gap-2 shadow-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-blue-600">🛰️</span>
                  <p className="font-black text-xs text-gray-800 truncate">
                    {vehicles.find(v => String(v.id) === String(trackingVehicleId))?.name || 'GPS รถเกี่ยว'}
                  </p>
                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${trackingMode === 'realtime' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                    {trackingMode === 'realtime' ? 'LIVE' : 'ย้อนหลัง'}
                  </span>
                </div>
                <p className="text-[8px] text-gray-400 truncate">
                  {trackingVehicleId ? `${effectiveTrackingDate}${gpsPathData.length ? ` • ${gpsPathData.length.toLocaleString()} จุด` : ''}` : 'แตะค้นหาเพื่อเลือกรถ'}
                </p>
              </div>
              <button
                onClick={() => setShowGpsMobilePanel(true)}
                className="h-9 px-3 rounded-full bg-blue-600 text-white font-black text-[11px] shadow-sm active:scale-95"
              >
                🔍 ค้นหา
              </button>
            </div>

            {/* 📱 Mobile search/settings bottom sheet */}
            {showGpsMobilePanel && (
              <div className="sm:hidden fixed inset-0 z-[1000] flex items-end">
                <button aria-label="ปิด" onClick={() => setShowGpsMobilePanel(false)} className="absolute inset-0 bg-black/35" />
                <div className="relative w-full bg-white rounded-t-3xl shadow-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                  <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-black text-base text-gray-800">🛰️ ค้นหาเส้นทาง</h3>
                      <p className="text-[10px] text-gray-500">ปิดแผงนี้แล้วแผนที่จะกลับมาเต็มพื้นที่</p>
                    </div>
                    <button onClick={() => setShowGpsMobilePanel(false)} className="w-9 h-9 rounded-full bg-gray-100 text-gray-600 font-black">✕</button>
                  </div>

                  <div className="flex gap-2 mb-3 bg-gray-100 p-1 rounded-xl">
                    <button
                      onClick={() => setTrackingMode('realtime')}
                      className={`flex-1 py-2 text-xs font-black rounded-lg ${trackingMode === 'realtime' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
                    >🟢 ปัจจุบัน</button>
                    <button
                      onClick={() => setTrackingMode('history')}
                      className={`flex-1 py-2 text-xs font-black rounded-lg ${trackingMode === 'history' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}
                    >🕒 ย้อนหลัง</button>
                  </div>

                  <label className="block text-[10px] font-black text-gray-600 mb-1">รถเกี่ยว</label>
                  <select
                    className="w-full border border-gray-300 p-3 rounded-xl bg-white text-sm font-bold text-gray-700 mb-3"
                    value={trackingVehicleId}
                    onChange={(e) => setTrackingVehicleId(e.target.value)}
                  >
                    <option value="">-- เลือกรถเกี่ยว --</option>
                    {vehicles.map(v => (<option key={`mobile-${v.id}`} value={v.id}>🚜 {v.name}</option>))}
                  </select>

                  {trackingMode === 'history' && (
                    <>
                      <label className="block text-[10px] font-black text-gray-600 mb-1">วันที่</label>
                      <input
                        type="date"
                        className="w-full border border-gray-300 p-3 rounded-xl bg-white text-sm mb-3"
                        value={trackingDate}
                        onChange={(e) => setTrackingDate(e.target.value)}
                      />
                    </>
                  )}

                  {gpsPathData.length > 0 && (
                    <div className="mb-3 bg-sky-50 border border-sky-100 rounded-xl p-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[9px] font-black text-sky-700">📍 พิกัดล่าสุด</p>
                        <p className="font-mono text-[9px] text-gray-600 truncate">{gpsPathData[gpsPathData.length - 1].latitude}, {gpsPathData[gpsPathData.length - 1].longitude}</p>
                      </div>
                      <button
                        onClick={() => navigator.clipboard.writeText(`${gpsPathData[gpsPathData.length - 1].latitude}, ${gpsPathData[gpsPathData.length - 1].longitude}`)}
                        className="w-9 h-9 shrink-0 bg-white rounded-lg border border-sky-200"
                      >📋</button>
                    </div>
                  )}

                  <button
                    onClick={async () => {
                      const ok = await searchGpsRoute();
                      if (ok) setShowGpsMobilePanel(false);
                    }}
                    disabled={isFetchingGps}
                    className="w-full bg-blue-600 text-white font-black py-3 rounded-xl text-sm shadow-md disabled:opacity-50"
                  >
                    {isFetchingGps ? '⏳ กำลังดึงข้อมูล...' : '🔍 ค้นหาแล้วไปที่รถ'}
                  </button>
                </div>
              </div>
            )}

            {/* แผงควบคุมด้านบน */}
            <div className="hidden sm:block p-4 bg-gray-50 border-b border-gray-200 z-10 relative shadow-sm shrink-0">
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
                onClick={searchGpsRoute}
                className="w-full mt-3 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg text-sm shadow-md transition flex justify-center items-center gap-2"
              >
                {isFetchingGps ? '⏳ กำลังดึงข้อมูล...' : '🔍 ค้นหาเส้นทาง'}
              </button>
            </div>

            {/* แผงบอกสถานะย่อส่วน (ซ่อนป้ายพื้นที่อัตโนมัติเก่าทิ้งไป) */}
            {gpsPathData.length > 0 && !isMapFullScreen && (
              <div className="hidden sm:flex bg-white border-b border-gray-200 p-3 z-10 shadow-sm shrink-0 justify-between items-center">
                 <div>
                   <p className="text-[10px] text-gray-500 mb-0.5">พิกัดล่าสุด: <span className="font-mono">{gpsPathData[gpsPathData.length-1].latitude}, {gpsPathData[gpsPathData.length-1].longitude}</span></p>
                   <p className="font-bold text-blue-800 text-xs">
                     {new Date(gpsPathData[gpsPathData.length-1].created_at).toLocaleString('th-TH')}
                   </p>
                 </div>
                 <div className="flex gap-1">
                   <button onClick={() => navigator.clipboard.writeText(`${gpsPathData[gpsPathData.length-1].latitude}, ${gpsPathData[gpsPathData.length-1].longitude}`)} className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-2 py-1.5 rounded-lg text-xs font-bold transition shadow-sm">📋</button>
                   <button onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${gpsPathData[gpsPathData.length-1].latitude},${gpsPathData[gpsPathData.length-1].longitude}`, '_blank')} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg shadow-sm text-xs font-bold transition">📍 นำทาง</button>
                 </div>
              </div>
            )}

            {/* ส่วนแสดงแผนที่อัจฉริยะแบบใหม่ */}
            <div className="flex-1 relative bg-gray-200 min-h-0 sm:min-h-[300px]">
              <TrackingMap
                jobs={jobs}
                customers={customersList}
                onPlotsSaved={fetchJobs}
                onQueueCreated={async()=>{await fetchJobs();fetchAllCustomers();}}
                focusPlot={gpsFocusPlot}
                onOpenJob={id=>{setIsMapFullScreen(false);setActiveTab('active');setGpsJobDetail(id);fetchJobs();}}
                pathData={visibleGpsPath}
                vehicleId={trackingVehicleId}
                workDate={effectiveTrackingDate}
                trackingMode={trackingMode}
                focusRequest={gpsFocusRequest}
                isMapFullScreen={isMapFullScreen} 
                setIsMapFullScreen={setIsMapFullScreen} 
                isFetchingGps={isFetchingGps} 
              />
              
              {/* ข้อความแจ้งเตือนตอนยังไม่มีข้อมูล */}
              {visibleGpsPath.length === 0 && !(gpsFocusPlot && String(gpsFocusPlot.vehicle_id)===String(trackingVehicleId) && gpsFocusPlot.work_date===effectiveTrackingDate) && (
                <div className="absolute inset-0 flex items-center justify-center z-[400] pointer-events-none">
                  <button onClick={() => setShowGpsMobilePanel(true)} className="bg-white/90 backdrop-blur border border-gray-300 px-4 py-3 rounded-xl shadow-sm text-center text-gray-500 text-xs sm:text-sm font-bold pointer-events-auto">
                    🔍 กรุณากดค้นหาเพื่อดูเส้นทาง
                  </button>
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
                  onClick={() => { setShowWageSummary(true); }} 
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
            
            {/* 🔍 กล่องค้นหาอัจฉริยะ (โชว์เฉพาะแท็บประวัติ) */}
            {activeTab === 'finance' && financeSubTab === 'history' && (
               <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-200 mb-4 sticky top-2 z-10">
                 <div className="relative">
                   <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                     <span className="text-gray-400">🔍</span>
                   </div>
                   <input
                     type="text"
                     placeholder="ค้นหา ชื่อ, เบอร์, พืช, หรือหมายเหตุ..."
                     className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg bg-gray-50 text-sm font-bold text-gray-800 focus:ring-2 focus:ring-blue-400 outline-none transition"
                     value={historySearch}
                     onChange={(e) => {
                       setHistorySearch(e.target.value);
                       setCurrentPage(1); // ค้นหาปุ๊บ กลับไปหน้า 1 ทันที
                     }}
                   />
                   {historySearch && (
                     <button 
                       onClick={() => { setHistorySearch(''); setCurrentPage(1); }}
                       className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-red-500 font-bold"
                     >
                       ✕
                     </button>
                   )}
                 </div>
                 
                 {/* โชว์สรุปผลลัพธ์ด้านล่างกล่องค้นหา */}
                 {historySearch && (
                   <div className="mt-2 px-1 flex justify-between items-center text-[11px] font-bold text-gray-500">
                     <span>พบ {filteredHistoryJobs.length} รายการ</span>
                     <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                       ยอดรวม: {filteredHistoryJobs.reduce((sum, j) => sum + (Number(j.total_price) || 0), 0).toLocaleString()} ฿
                     </span>
                   </div>
                 )}
               </div>
            )}

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

                    {(() => {
                      const ws = getJobWorkSummary(job);
                      const gpsArea = getJobGpsArea(job);
                      const gpsCount = Number(job.gps_summary?.plot_count || 0);
                      const estimate = Math.max(0, Number(job.area_size) || 0);
                      const billing = Math.max(0, Number(job.billing_area ?? 0) || 0);
                      const cropIcon = job.crop_type === 'ข้าวโพด' ? '🌽' : job.crop_type === 'ถั่ว' ? '🥜' : '🌾';

                      if (job.status === 'DONE') {
                        return <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                          <div className="flex justify-between items-center gap-2">
                            <span className="font-black text-emerald-950">{cropIcon} {job.crop_type || 'งานเกี่ยว'} • ✅ จบงาน</span>
                            {gpsCount>0 && <button onClick={(e)=>{e.stopPropagation();setGpsJobDetail(job.id);}} className="text-[10px] font-black text-blue-700 bg-white border border-blue-200 rounded-lg px-2 py-1">ดู {gpsCount} แปลง</button>}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-white rounded-xl border border-emerald-100 p-2"><span className="block text-gray-500">📐 ทำจริง</span><b>{formatRaiNgan(ws.measuredArea)}</b></div>
                            <div className="bg-white rounded-xl border border-emerald-100 p-2"><span className="block text-gray-500">🤝 คิดเงิน</span><b className="text-emerald-800">{formatRaiNgan(billing)}</b></div>
                          </div>
                          {userRole==='BOSS' && <p className="text-xs font-black text-emerald-900">💰 ยอดบิล {Number(job.total_price || 0).toLocaleString()} บาท</p>}
                          {gpsArea>0 && <p className="text-[10px] text-sky-700">🛰️ GPS เก็บไว้เป็นข้อเท็จจริง {plotThaiArea(gpsArea*1600).text}</p>}
                        </div>;
                      }

                      return <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                        <div className="flex justify-between items-center gap-2">
                          <span className="font-black text-gray-900">{cropIcon} {job.crop_type || 'งานเกี่ยว'}</span>
                          {gpsCount>0 ? <button onClick={(e)=>{e.stopPropagation();setGpsJobDetail(job.id);}} className="text-[10px] font-black text-blue-700 bg-sky-100 border border-sky-200 rounded-lg px-2 py-1">🛰️ {gpsCount} แปลง • ดูแปลง</button> : null}
                        </div>

                        {job.gps_summary_error ? <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">🛰️ โหลด GPS ไม่สำเร็จ</p>
                          : gpsArea>0 ? <p className="text-sm font-black text-sky-900">🛰️ GPS {plotThaiArea(gpsArea*1600).text}</p>
                          : estimate>0 ? <p className="text-sm font-black text-amber-900">🗣️ ลูกค้าแจ้งประมาณ ~{formatRaiNgan(estimate)}</p>
                          : <p className="text-xs font-bold text-gray-500">ยังไม่มีพื้นที่ • ผูกแปลง GPS หรือใส่ยอดประมาณได้ภายหลัง</p>}

                        {gpsArea>0 && estimate>0 && <p className="text-[10px] text-amber-700">🗣️ ลูกค้าแจ้งประมาณ ~{formatRaiNgan(estimate)} • เก็บแยกจาก GPS</p>}

                        {ws.roundCount>0 ? <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-gray-700">
                          <span>✅ ทำแล้ว {formatRaiNgan(ws.measuredArea)}</span>
                          <span>🗂️ {ws.roundCount} รอบ</span>
                          <span className="text-orange-700">⏳ รอปิดค่าแรง {ws.pendingRoundCount} รอบ</span>
                        </div> : <p className="text-[10px] text-gray-500">ยังไม่มีรอบทำงาน</p>}

                        {ws.postedWageArea>0 && <p className="text-[10px] font-bold text-purple-700">💰 ค่าแรงเก่าที่เคยลงสมุดแล้ว {formatRaiNgan(ws.postedWageArea)} • ระบบจะปรับตอนจบงาน</p>}
                      </div>;
                    })()}
                    {/* 💰 กล่องโชว์ยอดเงิน (ซ่อนไม่ให้คนขับเห็น) */}
                    {userRole === 'BOSS' && (Number(job.price_per_rai) > 0 || Number(job.total_price) > 0) ? (
                      <div className="bg-green-50 p-2 rounded-lg mb-3 flex justify-between items-center border border-green-200">
                        <div>
                          <span className="block text-green-700 text-xs">
                            {job.status === 'DONE' ? 'ยอดตกลง' : 'ยอดประเมิน'} ({job.price_per_rai || 0} บ./ไร่)
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

                      {(() => {
                        const ws = getJobWorkSummary(job);
                        if (ws.roundCount === 0) return null;
                        return (
                          <div className="mb-4 bg-emerald-50/70 border border-emerald-200 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-2">
                              <h3 className="font-black text-emerald-900 text-sm">🌾 ประวัติรอบทำงาน</h3>
                              <span className="text-[10px] font-bold text-emerald-700">{ws.roundCount} รอบ • วัดจริง {formatRaiNgan(ws.measuredArea)}</span>
                            </div>
                            <div className="space-y-2">
                              {ws.rounds.map((round, rIdx) => {
                                const source = /\[พื้นที่:GPS\]/.test(String(round.note || '')) ? 'GPS' : 'MANUAL';
                                const cleanNote = String(round.note || '').replace(/\s*\[พื้นที่:(?:GPS|MANUAL)\]\s*/g, ' ').trim();
                                return (
                                  <div key={round.id || rIdx} className="bg-white rounded-lg border border-emerald-100 p-2 text-xs">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-black text-gray-800">
                                        {round.round_type === 'FINAL' ? '🏁 รอบปิดงาน' : `รอบ ${rIdx + 1}`}
                                      </span>
                                      <span className="text-gray-500">
                                        {round.work_date ? new Date(round.work_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '-'}
                                      </span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                                      <span className="text-blue-700 font-bold">📐 ทำจริง {formatRaiNgan(round.measured_area)} {source==='GPS'?'• 🛰️ GPS':'• ✏️ ปรับเอง'}</span>
                                      {round.wage_transaction_id
                                        ? <span className="text-orange-700 font-bold">💰 ลงสมุดแล้ว {formatRaiNgan(round.wage_area)}</span>
                                        : <span className="text-orange-700 font-bold">⏳ รอแบ่งค่าแรงตอนจบ</span>}
                                      <span className="text-gray-600">คนทำ: {round.workers || '-'}</span>
                                    </div>
                                    {cleanNote && <p className="mt-1 text-[10px] text-gray-500">📝 {cleanNote}</p>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

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
                            className={`flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold shadow-sm transition ${userRole === 'DRIVER' ? 'py-4 text-lg rounded-xl shadow-lg' : 'py-2.5 text-xs rounded-lg'}`}
                          >
                            ▶️ เริ่มเกี่ยว
                          </button>
                        )}

                        {/* 🌾 จบเฉพาะรอบวันนี้: จำพื้นที่จริง + คนรับค่าแรงไว้ก่อน ยังไม่ลงสมุด */}
                        {job.status === 'IN_PROGRESS' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openWorkRoundModal(job, 'PARTIAL');
                            }}
                            className={`flex-1 bg-rose-500 hover:bg-rose-600 text-white font-bold shadow-sm transition ${userRole === 'DRIVER' ? 'py-4 text-lg rounded-xl shadow-lg' : 'py-2.5 text-xs rounded-lg'}`}
                          >
                            🌾 จบวันนี้
                          </button>
                        )}

                        {/* 🏁 ปิดงานทั้งหมด: เถ้าแก่กำหนดพื้นที่คิดเงินจริง แล้วระบบหาค่าแรงที่เหลือให้อัตโนมัติ */}
                        {userRole === 'BOSS' && job.status !== 'DONE' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openWorkRoundModal(job, 'FINAL');
                            }}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs py-2.5 rounded-lg font-bold shadow-sm transition"
                          >
                            🏁 จบงานทั้งหมด
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
                        <div className="grid grid-cols-3 gap-2 pt-2 mt-2">
                          <button onClick={(e) => { e.stopPropagation(); inspectJobIntegrity(job); }} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs py-2 rounded-lg font-bold transition">🔍 ตรวจยอดงาน</button>
                          <button onClick={(e) => { e.stopPropagation(); openEditForm(job); }} className="bg-gray-600 hover:bg-gray-700 text-white text-xs py-2 rounded-lg font-bold transition">✏️ แก้ไขข้อมูล</button>
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteJob(job.id); }} className="bg-red-500 hover:bg-red-600 text-white text-xs py-2 rounded-lg font-bold transition">🗑️ ลบงาน</button>
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

          // ✅ 'ค่าแรง' คือการรับรู้ต้นทุนตอนปิดงานแล้ว
          // ส่วน 'เบิกค่าแรง' คือการจ่ายหนี้ค่าแรง จึงห้ามนับเป็นต้นทุนซ้ำ
          const accountingExpenses = periodExpenses.filter(tx => tx.category !== 'เบิกค่าแรง');

          const calcTotalExpense = accountingExpenses.reduce((sum, tx) => sum + (Number(tx.total_amount) || 0), 0);
          const calcNetProfit = calcTotalIncome - calcTotalExpense;

          // 👇 1. เพิ่มตัวแปรดึงเฉพาะรายจ่ายหน้างาน (หักรายจ่ายที่มีคำว่า "ค่างวด" ออกทั้งหมด)
          const operationalExpense = accountingExpenses
            .filter(tx => !(tx.category || '').includes('ค่างวด'))
            .reduce((sum, tx) => sum + (Number(tx.total_amount) || 0), 0);

          // 3. ข้อมูลวิเคราะห์สำหรับกราฟและสัดส่วน
          // 👇 2. เปลี่ยนจาก calcTotalExpense เป็น operationalExpense
          const costPerRai = areaTotal > 0 ? operationalExpense / areaTotal : 0;
          const profitMargin = calcTotalIncome > 0 ? (calcNetProfit / calcTotalIncome) * 100 : 0;
          
          // ตัวชี้วัดอัตราการเก็บเงิน (Collection Rate)
          const totalPotential = calcTotalIncome + calcTotalUnpaid;
          const collectionRate = totalPotential > 0 ? (calcTotalIncome / totalPotential) * 100 : 0;
          
          const expenseByCategory = accountingExpenses.reduce((acc, tx) => {
            const raw = tx.category === 'WAGE' || tx.category === 'ค่าแรง' ? 'ค่าแรง' : (tx.category || 'อื่นๆ');
            acc[raw] = (acc[raw] || 0) + (Number(tx.total_amount) || 0);
            return acc;
          }, {});

          const expenseCategoryEntries = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);
          const expenseMax = expenseCategoryEntries.length > 0 ? expenseCategoryEntries[0][1] : 1;

          // ✅ ค่าแรง Dashboard ใช้สูตรเดียวกับ "กระเป๋าเงิน" ของคนงาน
          // สำคัญ: ห้ามเอายอดเบิกของทุกคนมาหักรวมก้อนเดียว เพราะจะทำให้ยอดค้างเพี้ยนข้ามคน
          let totalUnpaidWageAllTime = 0;

          const parseDashboardWageNote = (rawNote) => {
            const noteStr = rawNote || '';
            const paidMatches = noteStr.match(/\[จ่ายแล้ว:([^\]]+)\]/g) || [];
            const paidWorkers = paidMatches.map(m => m.replace('[จ่ายแล้ว:', '').replace(']', '').trim());

            let wStr = noteStr.replace(/\[จ่ายแล้ว:[^\]]+\]/g, '').trim();
            if (wStr.includes('คนทำ:') && wStr.includes('(')) {
              wStr = wStr.split('(')[0].replace('คนทำ:', '').trim();
            } else if (wStr.includes('(')) {
              wStr = wStr.split('(')[0].trim();
            }

            const jobWorkers = wStr.split(',').map(w => w.trim()).filter(Boolean);
            return { jobWorkers, paidWorkers };
          };

          // ✅ ยอดค่าแรงรอจ่ายด้านล่าง = "ยอดค้างจริง ณ ปัจจุบัน" เสมอ
          // ไม่ผูกกับ dashMonth / dashYear เพราะการ์ดนี้คือสิ่งที่ต้องจัดการตอนนี้
          // สูตรเดียวกับกระเป๋าเงินรายคน:
          // ยอดทำได้ทั้งหมด - จ่ายระบบเก่า - เบิกค่าแรงทั้งหมด
          const dashboardWorkerWallets = new Map();
          const getDashboardWallet = (workerName) => {
            if (!dashboardWorkerWallets.has(workerName)) {
              dashboardWorkerWallets.set(workerName, { earned: 0, oldPaid: 0, withdrawn: 0 });
            }
            return dashboardWorkerWallets.get(workerName);
          };

          // 1) รวมค่าแรงทั้งหมดของแต่ละคน โดยไม่ตัดตามเดือนที่กำลังเปิดดู
          wageTransactions.forEach(tx => {
            const { jobWorkers, paidWorkers } = parseDashboardWageNote(tx.note);
            if (jobWorkers.length === 0) return;

            const share = (Number(tx.total_amount) || 0) / jobWorkers.length;
            jobWorkers.forEach(workerName => {
              const wallet = getDashboardWallet(workerName);
              wallet.earned += share;

              // รองรับระบบเก่าที่เคยกด PAID / [จ่ายแล้ว:ชื่อ]
              if (tx.status === 'PAID' || paidWorkers.includes(workerName)) {
                wallet.oldPaid += share;
              }
            });
          });

          // 2) รวมยอดเบิกค่าแรงจริงทั้งหมดของแต่ละคนจนถึงปัจจุบัน
          expenseTransactions
            .filter(tx => tx.category === 'เบิกค่าแรง' && tx.spender_name)
            .forEach(tx => {
              const workerName = String(tx.spender_name).trim();
              if (!workerName) return;

              const wallet = getDashboardWallet(workerName);
              wallet.withdrawn += Number(tx.total_amount) || 0;
            });

          // 3) รวมยอดคงเหลือปัจจุบันของทุกคน
          // ตัวเลขนี้ต้องตรงกับ "ภาพรวมทีมงาน (ทุกคน)" ในสมุดค่าแรง
          dashboardWorkerWallets.forEach(wallet => {
            const balance = wallet.earned - wallet.oldPaid - wallet.withdrawn;
            totalUnpaidWageAllTime += balance;
          });

          // ป้องกันเศษทศนิยม/ข้อมูลเก่าทำให้ติดลบเล็กน้อย
          totalUnpaidWageAllTime = Math.max(0, totalUnpaidWageAllTime);

          // 4) การ์ดด้านบน: แสดง "กระแสเงินของช่วงที่เลือก" ตามเงินจริง
          //    - ค่าแรงเกิดขึ้น = ค่าแรงจากงานที่เกิดในเดือน/ปีนั้น
          //    - เบิกจ่ายจริง = เงินที่จ่ายออกจริงในเดือน/ปีนั้น
          // สำคัญ: เงินเบิกสามารถนำไปเคลียร์ยอดค้างจากเดือนก่อน จึงห้ามจำกัดยอดจ่าย
          // ไว้แค่ค่าแรงที่เกิดในเดือนปัจจุบัน (สาเหตุเดิมที่ทำให้ 10,200 กลายเป็น 4,530)
          let periodWageEarned = periodWages.reduce(
            (sum, tx) => sum + (Number(tx.total_amount) || 0),
            0
          );

          const isDateInSelectedPeriod = (dateValue) => {
            if (!dateValue) return false;
            const d = new Date(dateValue);
            return !Number.isNaN(d.getTime()) &&
              d.getFullYear() === dashYear &&
              (dashMonth === 0 || (d.getMonth() + 1) === dashMonth);
          };

          // ระบบใหม่: รายการ "เบิกค่าแรง" คือเงินจริงที่จ่ายออก
          let periodWagePaid = expenseTransactions
            .filter(tx =>
              tx.category === 'เบิกค่าแรง' &&
              isDateInSelectedPeriod(tx.transaction_date || tx.created_at)
            )
            .reduce((sum, tx) => sum + (Number(tx.total_amount) || 0), 0);

          // รองรับข้อมูลระบบเก่าที่ยังไม่ได้บันทึกเป็น "เบิกค่าแรง"
          // ถ้ามี paid_at/updated_at จะใช้วันจ่ายจริง; ถ้าไม่มีจริง ๆ จึง fallback เป็นวันที่สร้างบิล
          wageTransactions.forEach(tx => {
            const { jobWorkers, paidWorkers } = parseDashboardWageNote(tx.note);
            if (jobWorkers.length === 0) return;

            const hasLegacyPaid = tx.status === 'PAID' || paidWorkers.length > 0;
            if (!hasLegacyPaid) return;

            const legacyPaidDate = tx.paid_at || tx.updated_at || tx.created_at;
            if (!isDateInSelectedPeriod(legacyPaidDate)) return;

            const totalAmount = Number(tx.total_amount) || 0;
            if (tx.status === 'PAID') {
              periodWagePaid += totalAmount;
            } else {
              const uniquePaidWorkers = new Set(paidWorkers.filter(w => jobWorkers.includes(w)));
              periodWagePaid += (totalAmount / jobWorkers.length) * uniquePaidWorkers.size;
            }
          });

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
            groupedDebtorsMap[name].total_area += Number(j.billing_area ?? j.area_size) || 0;
            groupedDebtorsMap[name].job_count += 1;
            
            // 👇 ทบยอดพื้นที่ "แยกตามประเภทพืช"
            if (!groupedDebtorsMap[name].crop_areas[crop]) {
                groupedDebtorsMap[name].crop_areas[crop] = 0;
            }
            groupedDebtorsMap[name].crop_areas[crop] += Number(j.billing_area ?? j.area_size) || 0;
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
                  <div className="bg-teal-50 rounded-2xl p-3 border border-teal-100"><p className="text-[10px] font-bold text-teal-800">พื้นที่รวม</p><p className="text-xl font-black text-teal-700 mt-1">{formatRaiNgan(areaTotal)}</p></div>
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
                  <button onClick={() => { setWageFilter([]); setShowWageSummary(true); }} className="px-3 py-2 bg-white rounded-xl border border-orange-200 text-orange-700 text-[10px] font-black shadow-sm">เปิดสมุดค่าแรง →</button>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="bg-white/80 rounded-2xl p-3 border border-orange-100">
                    <p className="text-[10px] font-bold text-orange-700">ค่าแรงเกิดขึ้น</p>
                    <p className="text-2xl font-black text-green-600 mt-1">{formatMoney(periodWageEarned)} ฿</p>
                    <p className="text-[9px] text-gray-400 mt-1">จากงานในช่วงที่เลือก</p>
                  </div>
                  <div className="bg-white/80 rounded-2xl p-3 border border-orange-100">
                    <p className="text-[10px] font-bold text-orange-700">เบิกจ่ายจริง</p>
                    <p className="text-2xl font-black text-red-600 mt-1">{formatMoney(periodWagePaid)} ฿</p>
                    <p className="text-[9px] text-gray-400 mt-1">เงินที่จ่ายออกในช่วงที่เลือก</p>
                  </div>
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
                    {totalUnpaidWageAllTime > 0 && <button onClick={() => { setWageFilter([]); setShowWageSummary(true); }} className="w-full flex items-center justify-between p-3 rounded-2xl bg-orange-50 border border-orange-100 text-left hover:bg-orange-100 transition"><span><span className="block text-xs font-black text-orange-800">👷 ค่าแรงรอจ่าย (ยอดคงเหลือปัจจุบัน)</span><span className="block text-[10px] text-orange-600 mt-0.5">ยอดค้างจ่ายจริงของทีม ณ ตอนนี้</span></span><strong className="text-orange-600">{formatMoney(totalUnpaidWageAllTime)} ฿</strong></button>}
                    
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
                                .map(([cropName, area]) => `${cropName} ${formatRaiNgan(area)}`)
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

        {/* 💸 หน้าจอลูกหนี้ (รอเก็บเงิน) - ระบบกรุ๊ปบิลและเก็บเงินเหมา */}
        {activeTab === 'finance' && financeSubTab === 'debt' && (() => {
          const debtJobs = jobs.filter(j => j.status === 'DONE' && j.payment_status !== 'PAID');
          
          // 🧮 จัดกลุ่มบิลตามชื่อลูกค้า
          const groupedDebts = {};
          debtJobs.forEach(job => {
             const cName = job.customers?.name || 'ไม่ระบุชื่อ';
             if (!groupedDebts[cName]) groupedDebts[cName] = { total: 0, jobs: [] };
             groupedDebts[cName].jobs.push(job);
             groupedDebts[cName].total += (Number(job.total_price) || 0);
          });
          
          const totalDebtAll = debtJobs.reduce((sum, j) => sum + (Number(j.total_price) || 0), 0);

          // 🆕 เรียง "เจ้าลูกหนี้" ตามงานล่าสุดของแต่ละเจ้า: ใหม่สุดอยู่บนสุด
          // ไม่เปลี่ยนลำดับ group.jobs ภายใน เพื่อไม่กระทบ logic รับชำระ/ส่วนลดเดิม
          const debtCustomerNamesNewestFirst = Object.keys(groupedDebts).sort((nameA, nameB) => {
             const newestTime = (group) => Math.max(
               0,
               ...group.jobs.map(job => {
                 const raw = job.closed_at || job.job_date || job.created_at;
                 const t = raw ? new Date(raw).getTime() : 0;
                 return Number.isFinite(t) ? t : 0;
               })
             );
             const diff = newestTime(groupedDebts[nameB]) - newestTime(groupedDebts[nameA]);
             if (diff !== 0) return diff;

             // ถ้าวัน/เวลาชนกัน ใช้ Job ID ล่าสุดเป็นตัวตัดสิน
             const newestId = (group) => Math.max(0, ...group.jobs.map(job => Number(job.id) || 0));
             return newestId(groupedDebts[nameB]) - newestId(groupedDebts[nameA]);
          });

          // ✅ 1. ฟังก์ชันรับชำระแบบเหมาปิดบิล (หักส่วนลดอัตโนมัติจากบิลสุดท้าย)
          const handleBulkPay = async (customerName, customerJobs, totalDebt) => {
             const amountStr = window.prompt(`ยอดหนี้รวมของ [ ${customerName} ] (ค้าง ${customerJobs.length} แปลง)\nคือยอด: ${totalDebt.toLocaleString()} บาท\n\n💰 ลูกค้าจ่ายมาเท่าไหร่? (พิมพ์ยอดเงินสดที่รับจริง):`, totalDebt);
             if (amountStr === null) return;
             
             const actualPaid = Number(amountStr);
             if (isNaN(actualPaid) || actualPaid < 0) return alert("❌ กรุณาระบุตัวเลขให้ถูกต้องครับ");
             if (actualPaid > totalDebt) return alert("❌ ยอดรับเงินมากกว่ายอดหนี้รวม ระบบเหมายังไม่รองรับการจ่ายเกินครับ");

             const totalDiscount = totalDebt - actualPaid;
             let confirmMsg = actualPaid === totalDebt 
                 ? `✅ รับชำระเต็มจำนวน ${actualPaid.toLocaleString()} บาท\nปิดบิลทั้งหมด ${customerJobs.length} แปลง ใช่หรือไม่?`
                 : `✅ รับชำระ: ${actualPaid.toLocaleString()} บาท\n🎁 ให้ส่วนลดรวม: ${totalDiscount.toLocaleString()} บาท\n\nยืนยันปิดบิลทั้งหมด ${customerJobs.length} แปลง ใช่หรือไม่?`;

             if (!window.confirm(confirmMsg)) return;

             try {
                 let remainingDiscount = totalDiscount;
                 const now = new Date();
                 now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                 
                 // วนลูปบิลจากท้ายสุดมาหน้าสุด เพื่อเอาส่วนลดไปหักบิลใบสุดท้ายก่อน
                 for (let i = customerJobs.length - 1; i >= 0; i--) {
                     const job = customerJobs[i];
                     const currentJobDebt = Number(job.total_price);
                     
                     // คำนวณเผื่อบิลนี้เคยมีการจ่ายชำระบางส่วนมาก่อน
                     const orig = Number((job.billing_area ?? job.area_size) || 0) * Number(job.price_per_rai || 0);
                     const pastPaid = orig > currentJobDebt ? orig - currentJobDebt : 0;
                     
                     let discountForThisJob = 0;
                     if (remainingDiscount > 0) {
                         if (remainingDiscount >= currentJobDebt) {
                             discountForThisJob = currentJobDebt;
                             remainingDiscount -= currentJobDebt;
                         } else {
                             discountForThisJob = remainingDiscount;
                             remainingDiscount = 0;
                         }
                     }

                     const incomeFromThisPayment = currentJobDebt - discountForThisJob;
                     const finalTotalIncome = pastPaid + incomeFromThisPayment;
                     
                     // 1. อัปเดตยอดเงิน
                     const updatePayload = {
                         customer_name: job.customers?.name || '', phone: job.customers?.phone || '', address_note: job.address_note || '', crop_type: job.crop_type || 'ข้าว', area_size: (job.billing_area ?? job.area_size), job_date: job.job_date, latitude: job.latitude, longitude: job.longitude, vehicle_id: job.vehicles?.id || job.vehicle_id || 0, boundaries: job.boundaries || [], price_per_rai: job.price_per_rai,
                         total_price: finalTotalIncome, 
                         payment_status: 'PAID'
                     };
                     
                     await fetch(`https://harvester-api-server.onrender.com/api/jobs/${job.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatePayload) });
                     
                     // 2. ประทับเวลา PAID
                     await fetch(`https://harvester-api-server.onrender.com/api/jobs/${job.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_status: 'PAID', paid_at: now.toISOString() }) });
                 }
                 alert(`✅ รับชำระ ${customerName} เรียบร้อยแล้ว!`);
                 fetchJobs(); 
             } catch (err) { alert("❌ เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่"); }
          };

          // 💳 2. ฟังก์ชันชำระบางส่วนแบบเหมา (ไล่ตัดหนี้จากบิลที่เก่าที่สุดไปหาใหม่สุด)
          const handleBulkDeposit = async (customerName, customerJobs, totalDebt) => {
             const amountStr = window.prompt(`ยอดหนี้รวม [ ${customerName} ] คือ ${totalDebt.toLocaleString()} บาท\n\n💳 ลูกค้าชำระบางส่วนมาก่อนเท่าไหร่?:`);
             if (!amountStr) return;
             
             const depositAmt = Number(amountStr);
             if (isNaN(depositAmt) || depositAmt <= 0) return alert("❌ กรุณาระบุตัวเลขให้ถูกต้องครับ");
             if (depositAmt >= totalDebt) return alert("❌ ยอดชำระเท่ากับหรือมากกว่าหนี้รวม กรุณาใช้ปุ่ม '✅ รับชำระ' แทนครับ");

             if (!window.confirm(`ยืนยันรับชำระบางส่วน ${depositAmt.toLocaleString()} บาท\n(ระบบจะนำไปตัดยอดค้างชำระของ "บิลแปลงที่เก่าที่สุด" ก่อนตามลำดับ)`)) return;

             try {
                 let remainingDeposit = depositAmt;
                 const now = new Date();
                 now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                 
                 // เรียงบิลจากเก่าไปใหม่ (จ่ายของเก่าก่อน)
                 const sortedJobs = [...customerJobs].sort((a,b) => new Date(a.job_date) - new Date(b.job_date));

                 for (let i = 0; i < sortedJobs.length; i++) {
                     const job = sortedJobs[i];
                     if (remainingDeposit <= 0) break; // เงินชำระบางส่วนหมดแล้ว หยุดลูป

                     const currentJobDebt = Number(job.total_price);
                     const orig = Number((job.billing_area ?? job.area_size) || 0) * Number(job.price_per_rai || 0);
                     const pastPaid = orig > currentJobDebt ? orig - currentJobDebt : 0;
                     
                     let newStatus = 'UNPAID';
                     let newPrice = currentJobDebt;

                     if (remainingDeposit >= currentJobDebt) {
                         // เงินก้อนนี้ พอที่จะจ่ายเต็มบิลนี้
                         newPrice = pastPaid + currentJobDebt; // คืนค่ายอดรายได้สะสม
                         newStatus = 'PAID';
                         remainingDeposit -= currentJobDebt;
                     } else {
                         // เงินก้อนนี้จ่ายได้แค่บางส่วนของบิลนี้
                         newPrice = currentJobDebt - remainingDeposit; // อัปเดตยอดคงเหลือ
                         newStatus = 'DEPOSIT';
                         remainingDeposit = 0; 
                     }

                     // 1. อัปเดตยอดเงิน
                     const updatePayload = {
                         customer_name: job.customers?.name || '', phone: job.customers?.phone || '', address_note: job.address_note || '', crop_type: job.crop_type || 'ข้าว', area_size: (job.billing_area ?? job.area_size), job_date: job.job_date, latitude: job.latitude, longitude: job.longitude, vehicle_id: job.vehicles?.id || job.vehicle_id || 0, boundaries: job.boundaries || [], price_per_rai: job.price_per_rai,
                         total_price: newPrice, 
                         payment_status: newStatus
                     };
                     await fetch(`https://harvester-api-server.onrender.com/api/jobs/${job.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatePayload) });
                     
                     // 2. ประทับเวลา
                     await fetch(`https://harvester-api-server.onrender.com/api/jobs/${job.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_status: newStatus, paid_at: now.toISOString() }) });
                 }
                 alert(`✅ บันทึกรับชำระบางส่วน ${depositAmt.toLocaleString()} บาท ให้ ${customerName} เรียบร้อยแล้ว!`);
                 fetchJobs();
             } catch (err) { alert("❌ เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่"); }
          };

          return (
            <div className="space-y-6">
              {/* ป้ายสรุปรวมทั้งหมด */}
              <div className="bg-gradient-to-r from-red-50 to-orange-50 p-5 rounded-xl border border-red-200 shadow-sm flex justify-between items-center">
                 <div>
                   <h2 className="text-lg font-black text-red-800">💸 ลูกหนี้</h2>
                   <p className="text-xs text-red-600 font-semibold mt-1">รอเก็บเงิน {debtJobs.length} งาน</p>
                 </div>
                 <div className="text-right">
                   <span className="block text-xs text-red-700 font-bold mb-1">ยอดหนี้รวมทั้งหมด</span>
                   <span className="text-3xl font-black text-red-600">{totalDebtAll.toLocaleString()} <span className="text-sm">฿</span></span>
                 </div>
              </div>

              {debtJobs.length === 0 ? (
                 <div className="text-center text-gray-500 py-10 bg-white rounded-xl shadow-sm border border-gray-200">
                   <span className="text-4xl mb-2 block">🎉</span>
                   <p className="font-bold">ไม่มีลูกหนี้ค้างชำระ ยอดเยี่ยมมาก!</p>
                </div>
              ) : (
                 debtCustomerNamesNewestFirst.map(customerName => {
                    const group = groupedDebts[customerName];
                    return (
                      <div key={customerName} className="bg-white border border-red-200 rounded-2xl shadow-sm overflow-hidden mb-4">
                         
                         {/* หัวกรุ๊ปชื่อลูกค้า */}
                         <div className="bg-red-50 p-4 border-b border-red-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                            <div>
                               <h3 className="font-black text-red-900 text-lg flex items-center gap-2">
                                  👤 {customerName}
                               </h3>
                               <p className="text-xs text-red-600 font-bold mt-1">ค้างชำระ {group.jobs.length} แปลง</p>
                            </div>
                            <div className="w-full sm:w-auto text-right flex flex-col items-end">
                               <span className="block font-black text-2xl text-red-600 mb-2">{group.total.toLocaleString()} ฿</span>
                               {userRole === 'BOSS' && (
                                  <div className="flex gap-2 w-full sm:w-auto">
                                      <button onClick={() => handleBulkDeposit(customerName, group.jobs, group.total)} className="flex-1 sm:flex-none bg-amber-500 hover:bg-amber-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-md transition flex items-center justify-center gap-1">
                                         💳 ชำระบางส่วน
                                      </button>
                                      <button onClick={() => handleBulkPay(customerName, group.jobs, group.total)} className="flex-1 sm:flex-none bg-green-500 hover:bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-md transition flex items-center justify-center gap-1">
                                         ✅ รับชำระ
                                      </button>
                                  </div>
                               )}
                            </div>
                         </div>
                         
                         {/* รายการบิลย่อย */}
                         <div className="p-3 space-y-2 bg-gray-50/50">
                            {group.jobs.map(job => {
                               const orig = Number((job.billing_area ?? job.area_size) || 0) * Number(job.price_per_rai || 0);
                               const hasDiscount = orig > Number(job.total_price);
                               const isDeposit = job.payment_status === 'DEPOSIT';

                               return (
                                 <div 
                                    key={job.id} 
                                    onClick={() => {
                                      // 1. หาว่างานนี้อยู่หน้าไหนของแท็บประวัติ
                                      const jobIndex = historyJobs.findIndex(j => j.id === job.id);
                                      if (jobIndex !== -1) {
                                        const targetPage = Math.floor(jobIndex / itemsPerPage) + 1;
                                        setCurrentPage(targetPage);
                                      }
                                      
                                      // 2. เปลี่ยนหน้าไปที่ประวัติ และสั่งกางการ์ดออก
                                      setFinanceSubTab('history');
                                      setExpandedId(job.id);
                                      
                                      // 3. เลื่อนจอไปหาการ์ดใบนั้น แล้วทำเอฟเฟกต์กระพริบสีส้มเหมือนหน้าแรก
                                      setTimeout(() => {
                                        const targetCard = document.getElementById(`job-card-${job.id}`);
                                        if (targetCard) {
                                          targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                          targetCard.classList.add('ring-4', 'ring-orange-500', 'scale-[1.02]', 'transition-all', 'duration-500');
                                          setTimeout(() => {
                                            targetCard.classList.remove('ring-4', 'ring-orange-500', 'scale-[1.02]');
                                          }, 2000);
                                        } else {
                                          window.scrollTo({ top: 0, behavior: 'smooth' }); 
                                        }
                                      }, 150);
                                    }}
                                    className="bg-white p-3 rounded-lg shadow-sm border border-gray-100 relative overflow-hidden flex justify-between items-center cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition active:scale-[0.98]"
                                 >
                                    <div className={`absolute top-0 left-0 w-1.5 h-full ${isDeposit ? 'bg-amber-400' : 'bg-red-400'}`}></div>
                                    <div className="pl-3">
                                      <p className="text-[11px] text-gray-500 font-bold mb-0.5">
                                        📅 {new Date(job.job_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
                                      </p>
                                      <p className="text-xs font-bold text-gray-800">📐 {formatRaiNgan((job.billing_area ?? job.area_size) || 0)} (เรท {job.price_per_rai})</p>
                                      {userRole === 'BOSS' && (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); openBillingAreaAdjust(job); }}
                                          className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-black hover:bg-blue-100"
                                        >
                                          📐 แก้ไร่ตามลูกค้า
                                        </button>
                                      )}
                                    </div>
                                    <div className="text-right">
                                      {hasDiscount && <span className="block text-[10px] text-gray-400 line-through mb-0.5">{orig.toLocaleString()} ฿</span>}
                                      <span className={`block font-black text-base ${isDeposit ? 'text-amber-600' : 'text-red-600'}`}>
                                        {Number(job.total_price).toLocaleString()} ฿
                                      </span>
                                      {isDeposit && <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold mt-1 bg-amber-100 text-amber-700">💳 จ่ายบางส่วนแล้ว</span>}
                                    </div>
                                 </div>
                               )
                            })}
                         </div>
                      </div>
                    )
                 })
              )}
            </div>
          );
        })()}

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
                      const orig = Number(j.area_size || 0) * Number(j.price_per_rai || 0);
                      const trueTotal = orig > Number(j.total_price) ? orig : (Number(j.total_price) || 0);

                      // 👇 ถ้ารับเงินเต็มแล้ว (PAID) ให้ดึงยอดที่หักส่วนลดแล้วมาใช้คำนวณเลย
                      if (j.payment_status === 'PAID') return sum + (Number(j.total_price) || 0);
                      
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
                    const orig = Number((job.billing_area ?? job.area_size) || 0) * Number(job.price_per_rai || 0);
                    const trueTotal = orig > Number(job.total_price) ? orig : (Number(job.total_price) || 0);
                    
                    // 👇 บิลที่ปิดแล้ว จะดึงยอดเงินสดที่ได้รับจริงมาโชว์ตรงๆ
                    const displayIncome = isDeposit ? (trueTotal - Number(job.total_price)) : Number(job.total_price);

                    return (
                    <div key={job.id} className={`bg-white p-4 rounded-xl shadow-md relative overflow-hidden flex justify-between items-center ${isDeposit ? 'border border-amber-100' : 'border border-green-100'}`}>
                       <div className={`absolute top-0 left-0 w-1.5 h-full ${isDeposit ? 'bg-amber-400' : 'bg-green-400'}`}></div>
                       <div className="pl-2">
                         <h3 className="font-bold text-gray-900 text-lg">{job.customers?.name || 'ไม่ระบุชื่อ'}</h3>
                         <p className="text-[11px] text-gray-500 mt-0.5">
                           📅 รับเงิน: <span className="font-semibold text-gray-800">
                             {job.paid_at ? (() => {
                               const dateStr = job.paid_at.replace('Z', '').replace('+00:00', '');
                               const d = new Date(dateStr);
                               return `${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })} เวลา ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
                             })() : 'ไม่มีข้อมูลเวลา'}
                           </span>
                         </p>
                       </div>
                       <div className="text-right shrink-0">
                         {/* 💡 อัปเกรด: ถ้ายอดเต็มตอนแรก มากกว่า ยอดที่จ่ายจริง (คือมีส่วนลด) ให้โชว์ยอดเดิมแบบขีดทิ้ง */}
                         {!isDeposit && orig > Number(job.total_price) && (
                            <span className="block text-[10px] text-gray-400 line-through mb-0.5 font-bold">
                              {orig.toLocaleString()} ฿
                            </span>
                         )}
                         <span className="block font-black text-green-600 text-xl leading-none">
                           {displayIncome.toLocaleString()} <span className="text-sm">฿</span>
                         </span>
                         
                         {/* 💡 อัปเกรดป้ายสถานะ: เช็คว่ามีการลดราคาไหม */}
                         <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold mt-1.5 ${isDeposit ? 'bg-amber-100 text-amber-700 border border-amber-200' : (!isDeposit && orig > Number(job.total_price)) ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-green-100 text-green-700 border border-green-200'}`}>
                           {isDeposit 
                             ? '💳 จ่ายบางส่วน' 
                             : (!isDeposit && orig > Number(job.total_price)) 
                               ? `🎁 ลดให้ ${(orig - Number(job.total_price)).toLocaleString()} ฿` 
                               : '✅ จ่ายเต็ม'}
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
                    <p className="text-xs text-gray-500 mt-1">⏰ {new Date(job.job_date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น. | พื้นที่: {formatRaiNgan((job.billing_area ?? job.area_size) || 0)}</p>
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
        {showAddForm && (
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
                        <div key={idx} onMouseDown={() => setFormData({ ...formData, customer_name: cust.name, phone: cleanPhoneForUi(cust.phone) })} className="p-2 hover:bg-green-50 cursor-pointer border-b flex justify-between">
                          <span className="font-semibold text-gray-800">{cust.name}</span>
                          <span className="text-gray-500 text-xs">📞 {cleanPhoneForUi(cust.phone) || 'ไม่มีเบอร์'}</span>
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
                  <div className="flex justify-between items-center gap-2 mb-2">
                    <div>
                      <span className="font-bold text-blue-900 text-xs">📍 จุดนัดหมาย / ตำแหน่งคิว</span>
                      <p className="text-[10px] text-blue-700 mt-0.5">ใช้สำหรับนำทางเท่านั้น • ไม่ใช่พื้นที่วัด GPS</p>
                    </div>
                    <button type="button" onClick={handleGetCurrentLocation} className="bg-blue-600 text-white text-xs py-1.5 px-2 rounded-lg font-bold whitespace-nowrap">🎯 จุดปัจจุบัน</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <input type="text" placeholder="Latitude" readOnly value={formData.latitude} className="border p-1.5 rounded bg-gray-100 w-full" />
                    <input type="text" placeholder="Longitude" readOnly value={formData.longitude} className="border p-1.5 rounded bg-gray-100 w-full" />
                  </div>
                </div>

                {editingId && (() => {
                  const editingJob = jobs.find(j => String(j.id) === String(editingId));
                  const gps = editingJob?.gps_summary;
                  if (!gps || Number(gps.plot_count || 0) <= 0) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(false);
                        setGpsJobDetail(editingJob.id);
                      }}
                      className="w-full bg-sky-50 border border-sky-200 rounded-xl p-3 text-left hover:bg-sky-100 transition"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-black text-sky-800">🛰️ พื้นที่ GPS ที่ผูกกับ Job #{editingJob.id}</p>
                          <p className="text-lg font-black text-sky-950 mt-0.5">
                            {Number(gps.plot_count || 0)} แปลง • {formatRaiNgan(gps.area_rai || 0)}
                          </p>
                          <p className="text-[10px] text-sky-700 mt-1">พื้นที่จริงจัดการจากหน้า GPS เท่านั้น</p>
                        </div>
                        <span className="font-black text-blue-700 whitespace-nowrap">ดูแปลง →</span>
                      </div>
                    </button>
                  );
                })()}

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
                    <label className="block text-gray-700 mb-1 font-semibold">{editingId && jobs.find(j=>j.id===editingId)?.status==='DONE' ? '🤝 พื้นที่คิดเงินจริง (แก้แล้วปรับค่าแรง+ลูกหนี้)' : '🗣️ ลูกค้าแจ้งประมาณ (เว้นว่างได้)'}</label>
                    {/* กรอกแบบหน้างาน: ไร่ + งาน / ระบบแปลงกลับเป็นไร่ทศนิยมให้ API เอง */}
                    <RaiNganInput
                      value={formData.area_size}
                      onChange={(area) => {
                        const total = (area !== '' && formData.price_per_rai) ? (parseFloat(area || 0) * parseFloat(formData.price_per_rai)).toFixed(2) : '';
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
                    <label className="block text-gray-700 mb-1 font-semibold">
                      {editingId && jobs.find(j=>j.id===editingId)?.status==='DONE' ? 'ยอดตามพื้นที่คิดเงิน' : 'ยอดประมาณ (บาท)'}
                    </label>
                    <div className="w-full border p-2 rounded-lg bg-gray-100 text-gray-700 font-bold min-h-[40px] flex items-center">
                      {Number(formData.total_price || 0) > 0
                        ? `${Number(formData.total_price).toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`
                        : <span className="text-gray-400">{editingId && jobs.find(j=>j.id===editingId)?.status==='DONE' ? '—' : 'รอพื้นที่ / ราคา'}</span>}
                    </div>
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

        {/* 🌾 Popup ระบบรอบทำงาน: จบวันนี้ / จบงานทั้งหมด */}
        {/* 📐 Popup แก้ไร่ที่ลูกค้ายืนยันหลังปิดงาน */}
        {gpsJobDetail !== null && (()=>{const job=jobs.find(j=>String(j.id)===String(gpsJobDetail));if(!job)return null;const summary=job.gps_summary;return <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-3">
        <div role="dialog" aria-modal="true" aria-label="แปลงของคิวงาน" className="bg-white rounded-2xl w-full max-w-lg max-h-[90dvh] overflow-y-auto p-4">
          <div className="flex justify-between"><h3 className="text-lg font-black">🌾 {job.customers?.name} • คิว #{job.id}</h3><button aria-label="ปิดแปลงของคิว" onClick={()=>setGpsJobDetail(null)} className="p-2">✕</button></div>
          <p className="text-xs text-gray-500">ลูกค้า 1 คน • {summary?.plot_count || 0} แปลง • ทุกแปลงอ้างอิง Job ID #{job.id}</p>
          <p className="mt-3 text-lg font-black text-blue-800">🛰️ GPS: {summary ? plotThaiArea(summary.area_rai*1600).text : 'โหลดไม่สำเร็จ'}</p>
          <p className="text-sm text-gray-600">✅ ทำจริงที่ปิดรอบแล้ว: {formatRaiNgan(getJobWorkSummary(job).measuredArea)}</p>
          {job.status==='DONE'
            ? <p className="text-sm font-black text-green-800">🤝 พื้นที่คิดเงินสุดท้าย: {formatRaiNgan(job.billing_area ?? 0)}</p>
            : <p className="text-sm text-amber-700">🗣️ ลูกค้าแจ้งประมาณ: {job.area_size ? `~${formatRaiNgan(job.area_size)}` : 'ไม่ระบุ'}</p>}
          {!!summary?.invalid_count && <p className="text-red-700 text-sm">ต้องตรวจขอบแปลง {summary.invalid_count} แปลงก่อนใช้ยอด</p>}
          <div className="space-y-2 my-3">{(summary?.plots || []).map(plot=><button key={`${plot.vehicle_id}/${plot.work_date}/${plot.id}`} className="block w-full text-left border rounded-xl p-3 bg-sky-50" onClick={()=>{setGpsJobDetail(null);setTrackingMode('history');setTrackingVehicleId(String(plot.vehicle_id));setTrackingDate(plot.work_date);setGpsFocusPlot({...plot,request:Date.now()});setActiveTab('gps');setIsMapFullScreen(true);}}><strong>{plot.name}</strong><p className="text-sm">{plotThaiArea(plot.area_rai*1600).text}</p><p className="text-xs text-gray-500">{plot.work_date} • รถ {plot.vehicle_id} • เปิดบนแผนที่ ↗</p></button>)}</div>
          {userRole==='BOSS' && job.status==='DONE' && <button disabled={!summary?.plot_count || !!summary?.invalid_count || job.payment_status==='PAID'} onClick={()=>{setGpsJobDetail(null);openBillingAreaAdjust(job);setBillingAdjustArea(String(normalizeRaiNganValue(summary.area_rai)));}} className="w-full bg-emerald-600 text-white font-black rounded-xl py-3 disabled:opacity-40">📐 ใช้ GPS เป็นตัวช่วยตรวจไร่คิดเงิน</button>}
          {job.status!=='DONE' && <p className="text-xs text-blue-700 mt-2 font-bold">GPS เป็นข้อมูลหน้างาน • ปิดรอบวันนี้จะดึงเฉพาะยอดที่ยังไม่ลงรอบให้อัตโนมัติ</p>}
          {job.status==='DONE' && <p className="text-xs text-gray-500 mt-2">GPS ไม่แก้ทับข้อเท็จจริงย้อนหลัง • ปรับเฉพาะ 🤝 ไร่คิดเงิน และค่าแรงตามไร่ลูกค้า</p>}
        </div>
      </div>})()}
      {billingAdjustModal && (() => {
          const job = billingAdjustModal;
          const oldArea = Number((job.billing_area ?? job.area_size) || 0);
          const newArea = Number(billingAdjustArea);
          const valid = Number.isFinite(newArea) && newArea >= 0;
          const diff = valid ? newArea - oldArea : 0;
          const rate = Number(job.price_per_rai || 0);
          const measured = Number(job.work_summary?.measured_area_total || job.area_size || 0);
          const wageNow = Number(job.work_summary?.wage_area_total || oldArea || 0);
          const newTotal = valid ? newArea * rate : 0;

          return (
            <div className="fixed inset-0 bg-black/65 z-[360] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
                <div className="p-5 border-b bg-gradient-to-r from-blue-50 to-cyan-50 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-black text-blue-900">📐 แก้ไร่ตามที่ลูกค้ายืนยัน</h2>
                    <p className="text-sm font-bold text-gray-700 mt-1">{job.customers?.name || 'ไม่ระบุชื่อ'} • {job.crop_type || 'งานเกี่ยว'}</p>
                  </div>
                  <button disabled={isSavingBillingAdjust} onClick={() => setBillingAdjustModal(null)} className="w-9 h-9 rounded-full bg-white border border-gray-200 text-gray-500 font-bold disabled:opacity-50">✕</button>
                </div>

                <div className="p-4 overflow-y-auto space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-50 border rounded-xl p-3">
                      <p className="text-gray-500 font-bold">📐 วัด/ข้อมูลเดิม</p>
                      <p className="text-lg font-black text-gray-800 mt-1">{formatRaiNgan(measured)}</p>
                      <p className="text-[10px] text-gray-400">เก็บไว้ ไม่แก้ทับ</p>
                    </div>
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                      <p className="text-orange-700 font-bold">👷 ค่าแรงตอนนี้</p>
                      <p className="text-lg font-black text-orange-900 mt-1">{formatRaiNgan(wageNow)}</p>
                      <p className="text-[10px] text-orange-600">ปรับเฉพาะแปลง/บิลนี้</p>
                    </div>
                  </div>

                  <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-4">
                    <label className="block text-blue-900 font-black text-sm mb-2">🤝 ลูกค้ายืนยันพื้นที่เท่าไร?</label>
                    <RaiNganInput
                      autoFocus
                      value={billingAdjustArea}
                      onChange={setBillingAdjustArea}
                    />
                    <p className="text-[11px] text-blue-700 mt-2 font-bold">เดิมคิดเงินไว้ {formatRaiNgan(oldArea)}</p>
                  </div>

                  {valid && (
                    <div className="space-y-2">
                      <div className={`rounded-xl border p-3 ${diff < -0.001 ? 'bg-amber-50 border-amber-200' : diff > 0.001 ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex justify-between text-sm"><span className="font-bold text-gray-600">ต่างจากเดิม</span><b className={diff < 0 ? 'text-amber-700' : diff > 0 ? 'text-green-700' : 'text-gray-700'}>{formatSignedRaiNgan(diff)}</b></div>
                        <div className="flex justify-between text-sm mt-1"><span className="font-bold text-gray-600">👷 ค่าแรงหลังปรับ</span><b className="text-orange-800">{formatRaiNgan(newArea)}</b></div>
                        <div className="flex justify-between text-sm mt-1"><span className="font-bold text-gray-600">💵 ยอดตามไร่ใหม่</span><b className="text-green-800">{newTotal.toLocaleString()} บาท</b></div>
                      </div>

                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] leading-relaxed text-slate-700 font-semibold">
                        ✅ เปลี่ยนเฉพาะ <b>ไร่คิดเงิน + ค่าแรงของแปลง/บิลนี้</b><br/>
                        🧩 ถ้ามีหลายรอบในแปลงเดียวกัน ระบบปรับตามสัดส่วนเดิมของคนงาน<br/>
                        🔒 วัดจริง/ประวัติรอบทำงานยังอยู่เหมือนเดิม<br/>
                        💸 ถ้าลูกค้าต่อเป็น “ลดเงิน” ให้ใช้ระบบส่วนลดเดิม — ไม่แตะค่าแรง
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button disabled={isSavingBillingAdjust} onClick={() => setBillingAdjustModal(null)} className="flex-1 bg-gray-200 text-gray-800 py-3 rounded-xl font-bold disabled:opacity-50">ยกเลิก</button>
                    <button disabled={isSavingBillingAdjust || !valid || Math.abs(diff) < 0.000001} onClick={submitBillingAreaAdjust} className="flex-[1.4] bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-black shadow-lg disabled:opacity-40">
                      {isSavingBillingAdjust ? '⏳ กำลังปรับ...' : '✅ บันทึกไร่ใหม่'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {jobIntegrityModal && (()=>{
          const d = jobIntegrityModal.data;
          const checks = Array.isArray(d?.checks) ? d.checks : [];
          const audits = Array.isArray(d?.audit) ? d.audit : [];
          const integrityDone = jobIntegrityModal.job?.status === 'DONE';
          const badge = d?.health === 'OK' ? 'bg-green-100 text-green-800' : d?.health === 'ERROR' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';
          return <div className="fixed inset-0 z-[390] bg-black/65 flex items-center justify-center p-3">
            <div className="bg-white rounded-3xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl">
              <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-start gap-3 z-10">
                <div><h2 className="text-lg font-black text-indigo-900">🔍 ตรวจยอดงาน • Job #{jobIntegrityModal.job?.id}</h2><p className="text-xs text-gray-500">{jobIntegrityModal.job?.customers?.name || 'ไม่ระบุลูกค้า'}</p></div>
                <button onClick={()=>setJobIntegrityModal(null)} className="w-9 h-9 rounded-full bg-gray-100 font-bold">✕</button>
              </div>
              <div className="p-4 space-y-3">
                {jobIntegrityModal.loading ? <p className="text-center py-8 font-bold text-blue-700">⏳ กำลังตรวจ GPS / รอบงาน / ค่าแรง / ลูกหนี้…</p>
                  : jobIntegrityModal.error ? <p className="bg-red-50 border border-red-200 rounded-xl p-3 font-bold text-red-700">❌ {jobIntegrityModal.error}</p>
                  : <>
                    <div className="flex justify-between items-center"><span className="font-black">สถานะความสัมพันธ์ของข้อมูล</span><span className={`px-3 py-1 rounded-full text-xs font-black ${badge}`}>{d?.health || 'WARN'}</span></div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-sky-50 border border-sky-200 rounded-xl p-3"><span className="block text-gray-500">🛰️ GPS</span><b>{formatRaiNgan(d?.summary?.gps_area || 0)}</b></div>
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3"><span className="block text-gray-500">✅ ทำจริง</span><b>{formatRaiNgan(d?.summary?.measured_area || 0)}</b></div>
                      <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                        <span className="block text-gray-500">🤝 คิดเงิน</span>
                        <b className={integrityDone ? 'text-green-900' : 'text-gray-400'}>{integrityDone ? (d?.summary?.billing_area == null ? '-' : formatRaiNgan(d.summary.billing_area)) : 'รอปิดงาน'}</b>
                      </div>
                      <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                        <span className="block text-gray-500">👷 ค่าแรงจัดสรร</span>
                        <b className={integrityDone ? 'text-orange-900' : 'text-gray-400'}>{integrityDone ? formatRaiNgan(d?.summary?.wage_area || 0) : 'รอปิดงาน'}</b>
                      </div>
                    </div>
                    <div className="space-y-2">{checks.map((c,i)=><div key={i} className={`rounded-xl border p-2.5 text-xs ${c.level==='ERROR'?'bg-red-50 border-red-200':c.level==='WARN'?'bg-amber-50 border-amber-200':'bg-green-50 border-green-200'}`}><b>{c.level==='ERROR'?'❌':c.level==='WARN'?'⚠️':'✅'} {c.title}</b><p className="text-gray-600 mt-0.5">{formatAreaText(c.detail)}</p></div>)}</div>
                    <div className="border-t pt-3">
                      <p className="font-black text-sm mb-2">🕘 ประวัติแก้ไขล่าสุด</p>
                      {audits.length ? (
                        <div className="space-y-2">
                          {audits.slice(0,12).map(a=><div key={a.id} className="bg-gray-50 border rounded-xl p-2 text-xs">
                            <div className="flex justify-between gap-2">
                              <b>{auditActionLabel(a.action)}</b>
                              <span className="text-gray-400">{new Date(a.created_at).toLocaleString('th-TH')}</span>
                            </div>
                            <p className="text-gray-600 mt-1">{formatAreaText(a.summary || '-')}</p>
                          </div>)}
                        </div>
                      ) : <p className="text-xs text-gray-400">ยังไม่มีประวัติแก้ไข หรือยังไม่ได้รัน SQL Setup</p>}
                    </div>
                  </>}
              </div>
            </div>
          </div>
        })()}

        {workRoundModal && (() => {
          const job = workRoundModal.job;
          const isFinal = workRoundModal.mode === 'FINAL';
          const ws = getJobWorkSummary(job);
          const todayMeasured = Math.max(0, Number(workRoundData.measuredArea) || 0);
          const measuredTotal = ws.measuredArea + todayMeasured;
          const billingRaw = String(workRoundData.billingArea ?? '').trim();
          const billingArea = billingRaw === '' ? NaN : Number(billingRaw);
          const validBilling = Number.isFinite(billingArea) && billingArea >= 0;
          const customerDifference = isFinal && validBilling ? measuredTotal - billingArea : 0;
          const workersSelected = String(workRoundData.workers || '').split(',').map(v => v.trim()).filter(Boolean);

          // 🧮 Preview การแบ่ง "ไร่ที่ลูกค้ารับ" กลับเข้าค่าแรงแต่ละรอบตามพื้นที่วัดจริง
          const previewRounds = [
            ...ws.rounds.map((r, idx) => ({
              key: r.id || `old-${idx}`,
              label: `รอบ ${idx + 1}`,
              measured: Math.max(0, Number(r.measured_area) || 0),
              workers: String(r.workers || '').trim() || 'ไม่ระบุ',
              rate: Math.max(0, Number(r.wage_per_rai) || 60)
            })),
            ...(isFinal && todayMeasured > 0 ? [{
              key: 'today-final',
              label: `รอบ ${ws.rounds.length + 1} (วันนี้)`,
              measured: todayMeasured,
              workers: String(workRoundData.workers || '').trim() || 'ยังไม่เลือก',
              rate: Math.max(0, Number(workRoundData.wagePerRai) || 60)
            }] : [])
          ];
          const previewBasis = previewRounds.reduce((sum, r) => sum + r.measured, 0);
          const wagePreview = isFinal && validBilling ? previewRounds.map(r => ({
            ...r,
            wageArea: previewBasis > 0 ? billingArea * (r.measured / previewBasis) : 0
          })) : [];
          if (isFinal && validBilling && billingArea > 0 && previewBasis <= 0 && workersSelected.length) {
            wagePreview.push({
              key: 'fallback-final', label: 'รอบปิดงาน', measured: 0,
              workers: workersSelected.join(', '),
              rate: Math.max(0, Number(workRoundData.wagePerRai) || 60), wageArea: billingArea
            });
          }
          if (wagePreview.length) {
            const allocated = wagePreview.reduce((sum, r) => sum + r.wageArea, 0);
            wagePreview[wagePreview.length - 1].wageArea += billingArea - allocated;
          }
          const previewWageAmount = wagePreview.reduce((sum, r) => sum + (r.wageArea * r.rate), 0);
          const customerPreviewAmount = validBilling ? billingArea * (Number(job.price_per_rai) || 0) : 0;
          const money2 = (value) => Number(value || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
          const showFinalExtraRound = isFinal && (todayMeasured > 0 || workRoundData.measuredMode !== 'NONE');
          const showFinalWorkerInputs = !isFinal || todayMeasured > 0 || ws.roundCount === 0;
          const showWageBreakdown = wagePreview.length > 1;

          return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-3 z-[300]">
              <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[94vh] overflow-y-auto">
                <div className={`sticky top-0 z-10 px-5 py-4 border-b ${isFinal ? 'bg-green-50 border-green-200' : 'bg-rose-50 border-rose-200'} rounded-t-2xl`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className={`text-lg font-black ${isFinal ? 'text-green-800' : 'text-rose-800'}`}>
                        {isFinal ? '🏁 จบงานทั้งหมด' : '🌾 ปิดรอบวันนี้'}
                      </h2>
                      <p className="text-xs text-gray-600 mt-1">{job.customers?.name || 'ไม่ระบุลูกค้า'} • {job.crop_type || 'ข้าว'}</p>
                    </div>
                    <button onClick={() => !isSavingWorkRound && setWorkRoundModal(null)} className="w-9 h-9 rounded-full bg-white border border-gray-200 text-gray-500 font-bold">✕</button>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {isFinal ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-sky-700 font-bold">🛰️ GPS รวม</p>
                        <p className="font-black text-sky-950">{formatRaiNgan(getJobGpsArea(job))}</p>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-blue-700 font-bold">✅ ทำจริงแล้ว</p>
                        <p className="font-black text-blue-950">{formatRaiNgan(ws.measuredArea)}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-center">
                        <p className="text-[10px] text-amber-700 font-bold">🗣️ ลูกค้าแจ้งประมาณ</p>
                        <p className="font-black text-amber-900">{job.area_size != null && job.area_size !== '' ? formatRaiNgan(job.area_size) : 'ไม่ระบุ'}</p>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 text-center">
                        <p className="text-[10px] text-blue-700 font-bold">✅ ทำจริงก่อนหน้า</p>
                        <p className="font-black text-blue-900">{formatRaiNgan(ws.measuredArea)}</p>
                      </div>
                      <div className="bg-orange-50 border border-orange-200 rounded-xl p-2.5 text-center">
                        <p className="text-[10px] text-orange-700 font-bold">รอบทำงาน</p>
                        <p className="font-black text-orange-900">{ws.roundCount} รอบ</p>
                      </div>
                    </div>
                  )}

                  {(!isFinal || showFinalExtraRound) ? (
                    <div className="space-y-2">
                    <label className="block text-gray-800 font-black text-sm">📐 พื้นที่รอบนี้</label>
                    {Number(job.gps_summary?.plot_count || 0) > 0 && !job.gps_summary_error && (
                      <div className="bg-sky-50 border-2 border-sky-200 rounded-2xl p-3">
                        <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                          <div><span className="block text-sky-700 font-bold">🛰️ GPS รวม</span><b className="text-sky-950">{formatRaiNgan(getJobGpsArea(job))}</b></div>
                          <div className="border-x border-sky-200"><span className="block text-sky-700 font-bold">✅ ลงรอบแล้ว</span><b className="text-sky-950">{formatRaiNgan(ws.measuredArea)}</b></div>
                          <div><span className="block text-sky-700 font-bold">✨ ยังไม่ลงรอบ</span><b className="text-sky-950">{formatRaiNgan(Math.max(0,getJobGpsArea(job)-ws.measuredArea))}</b></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-3">
                          <button type="button" disabled={Math.max(0,getJobGpsArea(job)-ws.measuredArea)<=0}
                            onClick={()=>setWorkRoundData(prev=>({...prev,measuredArea:String(Number(Math.max(0,getJobGpsArea(job)-ws.measuredArea).toFixed(6))),measuredMode:'GPS'}))}
                            className={`rounded-xl py-2 text-xs font-black ${workRoundData.measuredMode==='GPS'?'bg-sky-600 text-white':'bg-white text-sky-800 border border-sky-300'} disabled:opacity-40`}>
                            ✅ ใช้ยอด GPS
                          </button>
                          <button type="button" onClick={()=>setWorkRoundData(prev=>({...prev,measuredMode:'MANUAL'}))}
                            className={`rounded-xl py-2 text-xs font-black ${workRoundData.measuredMode==='MANUAL'?'bg-amber-500 text-white':'bg-white text-amber-800 border border-amber-300'}`}>
                            ✏️ ปรับพื้นที่เอง
                          </button>
                        </div>
                      </div>
                    )}

                    {workRoundData.measuredMode === 'GPS' ? (
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex justify-between items-center">
                        <span className="text-sm font-bold text-blue-800">🛰️ ใช้ GPS รอบนี้</span>
                        <b className="text-xl text-blue-950">{formatRaiNgan(workRoundData.measuredArea || 0)}</b>
                      </div>
                    ) : (
                      <RaiNganInput
                        value={workRoundData.measuredArea}
                        onChange={(area) => setWorkRoundData(prev => ({ ...prev, measuredArea: area, measuredMode:'MANUAL' }))}
                      />
                    )}
                    <p className="text-[11px] text-blue-700 font-bold">ทำจริงสะสมหลังรอบนี้: {formatRaiNgan(measuredTotal)}</p>
                  </div>

                  ) : (
                    <button
                      type="button"
                      onClick={() => setWorkRoundData(prev => ({ ...prev, measuredArea:'', measuredMode:'MANUAL' }))}
                      className="w-full bg-slate-50 border border-dashed border-slate-300 text-slate-600 rounded-xl py-2.5 text-xs font-bold"
                    >
                      ➕ วันนี้มีเกี่ยวเพิ่มจากรอบเดิม
                    </button>
                  )}

                  {isFinal && (
                    <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-3">
                      <label className="block text-green-900 font-black mb-2 text-sm">🤝 สุดท้ายตกลงคิดเงินลูกค้าเท่าไร?</label>
                      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                        <RaiNganInput
                          value={workRoundData.billingArea}
                          onChange={(area) => setWorkRoundData(prev => ({ ...prev, billingArea: area }))}
                        />
                        <button
                          type="button"
                          onClick={() => setWorkRoundData(prev => ({ ...prev, billingArea: measuredTotal ? String(normalizeRaiNganValue(measuredTotal)) : '' }))}
                          className="h-[50px] px-3 rounded-xl bg-green-600 text-white text-[10px] font-black"
                        >
                          ใช้วัดจริง
                        </button>
                      </div>

                      {validBilling && (
                        <div className="mt-3 space-y-2 text-xs">
                          <div className="flex justify-between"><span className="text-gray-600">📐 วัดจริงทั้งหมด</span><b>{formatRaiNgan(measuredTotal)}</b></div>
                          <div className="flex justify-between"><span className="text-gray-600">🤝 คิดเงินลูกค้า</span><b className="text-green-800">{formatRaiNgan(billingArea)}</b></div>
                          <div className="flex justify-between border-t border-green-200 pt-2"><span className="font-black text-green-900">👷 ไร่ค่าแรงรวมที่จะลงสมุด</span><b className="text-lg text-orange-700">{formatRaiNgan(billingArea)}</b></div>
                          <p className="bg-white border border-green-200 rounded-lg p-2 font-bold text-green-900">
                            ✅ ค่าแรงรวมจะยึดพื้นที่ที่ตกลงกับลูกค้า และแบ่งตามสัดส่วนรอบทำงานอัตโนมัติ
                          </p>

                          {showWageBreakdown && (
                            <div className="bg-white border border-orange-200 rounded-xl p-2.5 space-y-2">
                              <p className="font-black text-orange-900">👷 ตัวอย่างแบ่งเข้าค่าแรง</p>
                              {wagePreview.map((r) => (
                                <div key={r.key} className="flex items-start justify-between gap-3 border-b last:border-b-0 border-orange-100 pb-1.5 last:pb-0">
                                  <div className="min-w-0">
                                    <p className="font-bold text-gray-800">{r.label} • {r.workers}</p>
                                    <p className="text-[10px] text-gray-500">วัดจริง {formatRaiNgan(r.measured)} • เรท {r.rate.toLocaleString()} บ./ไร่</p>
                                  </div>
                                  <b className="text-orange-700 whitespace-nowrap">{formatRaiNgan(r.wageArea)}</b>
                                </div>
                              ))}
                              <div className="flex justify-between pt-1 border-t border-orange-200">
                                <span className="font-black text-gray-700">ค่าแรงประมาณรวม</span>
                                <b className="text-orange-800">{money2(previewWageAmount)} บาท</b>
                              </div>
                            </div>
                          )}

                          {customerDifference > 0.001 && <p className="bg-amber-100 text-amber-900 rounded-lg p-2 font-bold">🤝 ลูกค้ารับน้อยกว่าวัดจริง {formatRaiNgan(customerDifference)} → ส่วนต่างถูกเฉลี่ยลดจากค่าแรงทุก round ตามสัดส่วน</p>}
                          {customerDifference < -0.001 && <p className="bg-blue-100 text-blue-900 rounded-lg p-2 font-bold">➕ ยอดคิดเงินมากกว่าวัดจริง {formatRaiNgan(Math.abs(customerDifference))} กรุณาตรวจอีกครั้ง</p>}
                          <div className="flex justify-between bg-white rounded-lg p-2 border border-green-200"><span className="text-gray-600">ยอดลูกค้าประมาณ</span><b className="text-green-800">{Math.round(customerPreviewAmount).toLocaleString('th-TH')} บาท</b></div>
                        </div>
                      )}
                    </div>
                  )}

                  {!isFinal && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
                      <label className="block text-rose-900 font-black mb-1 text-sm">📅 นัดมาเกี่ยวต่อเมื่อไร? <span className="font-normal text-gray-500">(ไม่รู้วัน ปล่อยว่าง)</span></label>
                      <input
                        type="datetime-local"
                        className="w-full border border-rose-200 bg-white p-2.5 rounded-lg font-bold text-gray-800"
                        value={workRoundData.nextWorkDate}
                        onChange={(e) => setWorkRoundData(prev => ({ ...prev, nextWorkDate: e.target.value }))}
                      />
                    </div>
                  )}

                  {showFinalWorkerInputs && (
                    <div className="bg-orange-50 p-3 rounded-xl border border-orange-200">
                    <label className="block text-orange-900 font-black mb-1">👷 {isFinal ? 'คนที่รับค่าแรงรอบสุดท้าย' : 'คนที่รับค่าแรงรอบนี้'}</label>
                    <p className="text-[11px] text-orange-700 font-bold mb-2">
                      {isFinal ? 'ถ้าวันนี้ไม่ได้เกี่ยวเพิ่ม ไม่ต้องเลือกใหม่ • ระบบใช้คนที่จำไว้ในรอบก่อน' : '✅ ติ๊กแล้วจำไว้ก่อน • ยังไม่ลงสมุดค่าแรงจนกว่าจะ 🏁 จบงานทั้งหมด'}
                    </p>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {['พี่ยันต์', 'จักร กฤษณ์'].map(name => {
                        const selected = workersSelected.includes(name);
                        return (
                          <button
                            key={name} type="button"
                            onClick={() => toggleRoundWorker(name)}
                            className={`px-3 py-2 rounded-lg text-xs font-bold border ${selected ? 'bg-orange-500 text-white border-orange-600' : 'bg-white text-orange-700 border-orange-300'}`}
                          >
                            {selected ? '✅' : '➕'} {name}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      className="w-full border border-orange-300 p-2.5 rounded-lg bg-white text-orange-900 font-semibold"
                      placeholder="พิมพ์ชื่อคนอื่นเพิ่มได้..."
                      value={workRoundData.workers}
                      onChange={(e) => setWorkRoundData(prev => ({ ...prev, workers: e.target.value }))}
                    />
                  </div>

                  )}

                  {showFinalWorkerInputs && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gray-600 font-bold mb-1 text-xs">ค่าแรง/ไร่</label>
                      <input
                        type="number" min="0"
                        className="w-full border border-gray-300 p-2.5 rounded-lg bg-gray-50 font-black"
                        value={workRoundData.wagePerRai}
                        onChange={(e) => setWorkRoundData(prev => ({ ...prev, wagePerRai: e.target.value }))}
                      />
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5">
                      <p className="text-[10px] text-blue-700 font-bold">{isFinal ? '💰 ค่าแรงรวมที่จะลงสมุด' : '📝 ค่าแรงรอบนี้ (ยังไม่ลงสมุด)'}</p>
                      <p className="text-lg font-black text-blue-900">
                        {isFinal
                          ? `${money2(previewWageAmount)} บาท`
                          : `${(todayMeasured * (Number(workRoundData.wagePerRai) || 60)).toLocaleString()} บาท`}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-gray-600 font-bold mb-1 text-xs">📝 จดว่าเกี่ยวแปลงไหน / หมายเหตุ</label>
                    <input
                      type="text"
                      className="w-full border border-gray-300 p-2.5 rounded-lg"
                      placeholder="เช่น แปลงย่อย 3, 6, 7"
                      value={workRoundData.note}
                      onChange={(e) => setWorkRoundData(prev => ({ ...prev, note: e.target.value }))}
                    />
                  </div>

                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button disabled={isSavingWorkRound} onClick={() => setWorkRoundModal(null)} className="flex-1 bg-gray-200 text-gray-800 py-3 rounded-xl font-bold disabled:opacity-50">ยกเลิก</button>
                    <button
                      disabled={isSavingWorkRound}
                      onClick={submitWorkRound}
                      className={`flex-[1.4] text-white py-3 rounded-xl font-black shadow-lg disabled:opacity-50 ${isFinal ? 'bg-green-600 hover:bg-green-700' : 'bg-rose-600 hover:bg-rose-700'}`}
                    >
                      {isSavingWorkRound ? '⏳ กำลังบันทึก...' : isFinal ? '🏁 ยืนยันปิดงานทั้งหมด' : '✅ บันทึกรอบวันนี้'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        {/* 👆 จบ Popup ระบบรอบทำงาน 👆 */}

        {/* 💰 Popup สมุดจดค่าแรงลูกจ้าง (Hybrid System: กระเป๋าเงิน + รายงานบิล) */}
        {showWageSummary && (() => {
          
          // 🧠 ฟังก์ชันสกัดชื่อและข้อมูลจากหมายเหตุบิล
          const parseWageNote = (rawNote) => {
            const noteStr = rawNote || '';
            const paidMatches = noteStr.match(/\[จ่ายแล้ว:([^\]]+)\]/g) || [];
            const paidWorkers = paidMatches.map(m => m.replace('[จ่ายแล้ว:', '').replace(']', '').trim());
            
            let cleanNote = noteStr.replace(/\[จ่ายแล้ว:[^\]]+\]/g, '').trim();
            let detailsStr = '';
            let wStr = cleanNote;
            if (wStr.includes('คนทำ:') && wStr.includes('(')) {
                const parts = wStr.split('(');
                wStr = parts[0].replace('คนทำ:', '').trim();
                detailsStr = parts[1].replace(')', '').trim();
            } else if (wStr.includes('(')) {
                const parts = wStr.split('(');
                wStr = parts[0].trim();
                detailsStr = parts[1].replace(')', '').trim();
            }
            const jobWorkers = wStr.split(',').map(w => w.trim()).filter(w => w);
            return { jobWorkers, paidWorkers, detailsStr };
          };

          // 👨‍🌾 1. ดึงชื่อลูกจ้างทั้งหมดที่มีในระบบ
          const uniqueWorkers = new Set(['พี่ยันต์', 'จักร กฤษณ์']);
          wageTransactions.forEach(tx => {
            const { jobWorkers } = parseWageNote(tx.note);
            jobWorkers.forEach(w => uniqueWorkers.add(w));
          });
          const workersList = Array.from(uniqueWorkers);
          
          // บังคับให้เลือกดูทีละคน เพื่อความชัดเจนของยอด
          const activeWorker = wageFilter.length === 1 ? wageFilter[0] : null;

          // 🧮 2. ฟังก์ชันคำนวณยอดกระเป๋าเงิน (หา ยอดทำได้, ยอดเบิก, ยอดคงเหลือ)
          const getWorkerWallet = (workerName) => {
            let earned = 0;
            let oldSystemPaid = 0;
            
            // รวมยอดจากรายได้หน้าแปลง
            wageTransactions.forEach(tx => {
               const { jobWorkers, paidWorkers } = parseWageNote(tx.note);
               if (jobWorkers.includes(workerName)) {
                  const divisor = jobWorkers.length > 0 ? jobWorkers.length : 1;
                  const share = Number(tx.total_amount) / divisor;
                  earned += share;
                  
                  // ถ้าระบบเก่าเคยกด จ่ายแล้ว/จ่ายเหมา ไปแล้ว ให้ถือว่าเบิกเงินแล้ว
                  if (tx.status === 'PAID' || paidWorkers.includes(workerName)) {
                     oldSystemPaid += share;
                   }
               }
            });

            // รวมยอดจากประวัติการกด "เบิกเงิน" แบบใหม่ (พิมพ์ตัวเลขเอง)
            const newWithdrawals = expenseTransactions.filter(tx => tx.category === 'เบิกค่าแรง' && tx.spender_name === workerName);
            const withdrawnNew = newWithdrawals.reduce((sum, tx) => sum + Number(tx.total_amount), 0);
            
            const totalWithdrawn = oldSystemPaid + withdrawnNew;
            const balance = earned - totalWithdrawn;
            return { earned, totalWithdrawn, balance, newWithdrawals };
          };

          // 💸 ฟังก์ชันเบิกเงิน (พิมพ์ตัวเลขได้ตามใจชอบ เช่น 5,000)
          const handleWithdraw = async (workerName, balance) => {
             const amountStr = window.prompt(`ระบุจำนวนเงินที่ [ ${workerName} ] ต้องการเบิก\n(ยอดคงเหลือสูงสุด: ${balance.toLocaleString()} บาท):`);
             if (!amountStr) return;
             const amount = Number(amountStr);
             if (isNaN(amount) || amount <= 0) return alert("❌ กรุณาระบุตัวเลขให้ถูกต้องครับ");
             if (amount > balance) {
                if(!window.confirm(`⚠️ ยอดเบิก (${amount.toLocaleString()}) มากกว่ายอดคงเหลือ (${balance.toLocaleString()})\nคุณต้องการจ่ายเกิน/ให้เบิกก่อนล่วงหน้า ใช่หรือไม่?`)) return;
             }
             
             try {
               const formData = new FormData();
               formData.append('category', 'เบิกค่าแรง');
               formData.append('total_amount', amount);
               formData.append('spender_name', workerName);
               formData.append('note', 'เบิกเงินสดจากกระเป๋าเงินสะสม');
               
               const d = new Date(); 
               d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
               formData.append('transaction_date', d.toISOString());

               const res = await fetch('https://harvester-api-server.onrender.com/api/transactions/expenses', {
                 method: 'POST', body: formData
               });
               if(res.ok) { 
                 alert(`✅ บันทึกการเบิกเงิน ${amount.toLocaleString()} บาท ให้ ${workerName} สำเร็จ!`); 
                 // ✅ รีเฟรชทั้งค่าแรง + ยอดเบิก ป้องกันยอด 11,550 / 1,350 สลับกัน
                 await refreshWageLedger();
                 await fetchDashboard();
               } else alert('❌ บันทึกไม่สำเร็จ');
             } catch(e) { console.error(e); alert('❌ เกิดข้อผิดพลาดในการเชื่อมต่อ'); }
          };

          // กรองบิลที่ทำงาน (สำหรับแท็บ "ประวัติลงแปลง")
          const displayJobs = wageTransactions.filter(tx => {
              if (!activeWorker) return true;
              const { jobWorkers } = parseWageNote(tx.note);
              return jobWorkers.includes(activeWorker);
          });

          return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[200]">
              <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                
                {/* Header */}
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white z-10 shrink-0">
                  <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <span>💰</span> สมุดค่าแรง & เบิกเงิน
                  </h2>
                  <button onClick={() => { setShowWageSummary(false); setWageFilter([]); }} className="text-gray-400 hover:text-red-500 bg-gray-100 hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center font-bold text-lg transition">✕</button>
                </div>
                
                <div className="p-4 flex-1 overflow-y-auto">
                    {/* 🔍 แถบกรองชื่อ */}
                    <div className="mb-4">
                      <p className="text-[11px] font-bold text-gray-500 mb-2">🔍 กดเลือกชื่อเพื่อดูยอด / จ่ายเงิน:</p>
                      <div className="flex flex-wrap gap-2">
                        {workersList.map(name => {
                          const isSelected = activeWorker === name;
                          return (
                            <button key={name} onClick={() => setWageFilter(isSelected ? [] : [name])}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition shadow-sm ${isSelected ? 'bg-orange-500 text-white border-orange-600' : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-orange-50'}`}
                            >
                              {isSelected ? '✅' : '🧑‍🌾'} {name}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* 💳 ส่วนกระเป๋าเงิน (สลับอัตโนมัติระหว่าง 'บุคคล' กับ 'ภาพรวมทุกคน') */}
                    {activeWorker ? (() => {
                       const wallet = getWorkerWallet(activeWorker);
                       return (
                         <div className="mb-4 bg-gradient-to-br from-blue-900 to-indigo-900 rounded-xl p-4 text-white shadow-lg relative overflow-hidden">
                            <div className="absolute -right-4 -bottom-4 text-6xl opacity-10">💸</div>
                            <h3 className="font-bold text-blue-100 text-sm mb-3">กระเป๋าเงินของ: <span className="text-white text-lg">{activeWorker}</span></h3>
                            
                            <div className="grid grid-cols-2 gap-3 mb-4">
                               <div className="bg-white/10 rounded-lg p-2 text-center border border-white/10">
                                 <span className="block text-[10px] text-blue-200 mb-1">สะสมทำได้ทั้งหมด</span>
                                 <span className="font-bold text-lg">{wallet.earned.toLocaleString()} <span className="text-xs">฿</span></span>
                               </div>
                               <div className="bg-white/10 rounded-lg p-2 text-center border border-white/10">
                                 <span className="block text-[10px] text-blue-200 mb-1">เบิกไปแล้วรวม</span>
                                 <span className="font-bold text-lg text-orange-300">{wallet.totalWithdrawn.toLocaleString()} <span className="text-xs">฿</span></span>
                               </div>
                            </div>

                            <div className="flex items-center justify-between bg-black/20 p-3 rounded-lg border border-white/10">
                               <div>
                                 <span className="block text-[10px] text-blue-200 font-bold mb-0.5">ยอดคงเหลือ (รอเบิกสุทธิ)</span>
                                 <span className={`font-black text-2xl ${wallet.balance > 0 ? 'text-green-400' : 'text-white'}`}>{wallet.balance.toLocaleString()} <span className="text-sm">฿</span></span>
                               </div>
                               
                               {userRole === 'BOSS' && wallet.balance > 0 && (
                                 <button onClick={() => handleWithdraw(activeWorker, wallet.balance)} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-md transition">
                                   💸 เบิกเงิน
                                 </button>
                               )}
                            </div>
                         </div>
                       );
                    })() : (() => {
                       // 👨‍👩‍👦 คำนวณยอดรวมที่ยังไม่ได้จ่ายทั้งหมด (ทุกคนรวมกัน)
                       let overallBalance = 0;
                       workersList.forEach(w => { overallBalance += getWorkerWallet(w).balance; });
                       
                       return (
                         <div className="mb-4 bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-4 text-white shadow-lg relative overflow-hidden">
                            <div className="absolute -right-4 -bottom-4 text-6xl opacity-10">👥</div>
                            <h3 className="font-bold text-gray-300 text-sm mb-2">ภาพรวมทีมงาน (ทุกคน)</h3>
                            <div className="flex items-center justify-between bg-black/30 p-4 rounded-lg border border-white/10">
                               <div>
                                 <span className="block text-[10px] text-gray-300 font-bold mb-0.5">ยอดค้างจ่ายรวมทั้งหมด (รอเบิก)</span>
                                 <span className={`font-black text-3xl ${overallBalance > 0 ? 'text-orange-400' : 'text-white'}`}>{overallBalance.toLocaleString()} <span className="text-sm">฿</span></span>
                               </div>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-2 text-center">* กดเลือกชื่อลูกน้องด้านบน เพื่อดูยอดแยกรายคน และกดจ่ายเงิน</p>
                         </div>
                       );
                    })()}

                    {/* 📑 แท็บสลับดู รายงานลงแปลง / ประวัติเบิกเงิน (โชว์เสมอ ไม่ซ่อนแล้ว) */}
                    <div className="flex gap-2 mb-3 bg-gray-100 p-1 rounded-lg shrink-0">
                      <button onClick={() => setWageTab('UNPAID')} className={`flex-1 py-2 text-sm font-bold rounded-md transition ${wageTab === 'UNPAID' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>🚜 ประวัติลงแปลง</button>
                      <button onClick={() => setWageTab('PAID')} className={`flex-1 py-2 text-sm font-bold rounded-md transition ${wageTab === 'PAID' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>💸 ประวัติเบิกเงิน</button>
                    </div>

                    {/* 🚜 แสดงประวัติการลงแปลง (รายงานการทำงาน) */}
                    {wageTab === 'UNPAID' && (
                      <div className="space-y-3">
                        {displayJobs.length === 0 ? <p className="text-center text-xs text-gray-400 py-5 font-bold">ยังไม่มีประวัติการลงแปลง</p> : null}
                        {displayJobs.map(tx => {
                          const { jobWorkers, paidWorkers, detailsStr } = parseWageNote(tx.note);
                          const divisor = jobWorkers.length > 0 ? jobWorkers.length : 1;
                          const totalAmount = Number(tx.total_amount);

                          // 👤 ใช้ job_id ของบิลค่าแรงเป็นตัวหลัก เพื่อบอกว่าค่าแรงนี้มาจากงานของใคร
                          const sourceJob = jobs.find(j => Number(j.id) === Number(tx.job_id));
                          const sourceJobName = sourceJob?.customers?.name || sourceJob?.customer_name || (tx.job_id ? `งาน #${tx.job_id}` : 'ไม่พบชื่องาน');
                          // ซ่อนเลขรอบภายในระบบ เช่น [รอบงาน:12] ไม่ให้รกสมุดค่าแรง
                          const cleanDetailsStr = String(detailsStr || '')
                            .replace(/\s*\[รอบงาน:[^\]]+\]/g, '')
                            .replace(/\s{2,}/g, ' ')
                            .trim();
                          
                          // ถ้าระบุตัวคน ให้โชว์แค่ส่วนแบ่งของเขา ถ้าไม่ได้ระบุ (ดูภาพรวม) ให้โชว์ยอดเต็มบิล
                          const displayAmount = activeWorker ? (totalAmount / divisor) : totalAmount;
                          
                          // ดักว่าในบิลเก่าเคยตัดยอดไปหรือยัง (ถ้าดูภาพรวม เช็คว่ามีใครสักคนในบิลนี้รับไปแล้วหรือยัง)
                          const isPaidInOldSystem = activeWorker 
                            ? (paidWorkers.includes(activeWorker) || tx.status === 'PAID')
                            : (paidWorkers.length > 0 || tx.status === 'PAID');

                          return (
                            <div key={tx.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
                               <div className={`absolute top-0 left-0 w-1.5 h-full ${isPaidInOldSystem ? 'bg-orange-400' : 'bg-blue-400'}`}></div>
                               <div className="flex justify-between items-start pl-2">
                                 <div className="flex-1 pr-2">
                                   <div className="mb-2">
                                     <span className="inline-flex items-center text-[11px] font-black px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200">
                                       👤 งาน: {sourceJobName}
                                     </span>
                                   </div>
                                   <div className="flex flex-wrap gap-1.5 mb-2">
                                     {jobWorkers.map((w, idx) => {
                                       const isMe = w === activeWorker;
                                       // โชว์ติ๊กถูกหน้าชื่อ ถ้าคนนั้นรับเงินไปแล้ว
                                       const hasPaid = paidWorkers.includes(w) || tx.status === 'PAID';
                                       return (
                                         <span key={idx} className={`text-[10px] font-bold px-2 py-1 rounded-md border shadow-sm ${hasPaid ? 'bg-green-100 text-green-700 border-green-300' : (isMe ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-gray-50 text-gray-500 border-gray-200')}`}>
                                           {hasPaid ? '✅' : '🧑‍🌾'} {w}
                                         </span>
                                       )
                                     })}
                                   </div>
                                   <p className="text-sm text-gray-700 font-bold mb-1">{cleanDetailsStr ? `📐 ${cleanDetailsStr}` : ''}</p>
                                   <p className="text-[10px] text-gray-500">📅 ลงสมุด: {new Date(tx.created_at).toLocaleString('th-TH')}</p>
                                 </div>

                                 <div className="text-right shrink-0">
                                   <span className={`block font-black text-xl leading-none mb-1 text-gray-800`}>
                                     +{displayAmount.toLocaleString()} <span className="text-sm">฿</span>
                                   </span>
                                   <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-gray-100 text-gray-600 border-gray-200 border">
                                     {activeWorker ? (divisor > 1 ? `ส่วนแบ่งหาร ${divisor}` : `งานเดี่ยว`) : `ยอดเต็มบิล`}
                                   </span>
                                   {isPaidInOldSystem && <span className="block text-[9px] text-orange-600 font-bold mt-1 bg-orange-50 px-1 py-0.5 rounded">* มีการตัดยอดแล้ว</span>}
                                 </div>
                               </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* 💸 แสดงประวัติการเบิกเงินสด และ ประวัติเคลียร์บิล (แบบรวม) */}
                    {wageTab === 'PAID' && (() => {
                       // 1. ประวัติเบิกเงินสด (แบบใหม่ - พิมพ์ตัวเลข)
                       const newWithdrawals = activeWorker 
                           ? getWorkerWallet(activeWorker).newWithdrawals 
                           : expenseTransactions.filter(tx => tx.category === 'เบิกค่าแรง');

                       // 2. ประวัติเคลียร์บิล (แบบเก่า - จ่ายรายแปลง)
                       const oldPaidBills = wageTransactions.filter(tx => {
                           const { jobWorkers, paidWorkers } = parseWageNote(tx.note);
                           if (activeWorker) {
                               return jobWorkers.includes(activeWorker) && (tx.status === 'PAID' || paidWorkers.includes(activeWorker));
                           } else {
                               return tx.status === 'PAID' || paidWorkers.length > 0;
                           }
                       });

                       const hasAnyRecord = newWithdrawals.length > 0 || oldPaidBills.length > 0;

                       return (
                         <div className="space-y-4">
                           {!hasAnyRecord ? (
                             <p className="text-center text-xs text-gray-400 py-5 font-bold">ยังไม่มีประวัติการรับเงิน</p>
                           ) : (
                             <>
                               {/* ส่วนที่ 1: เบิกเงินสด */}
                               {newWithdrawals.length > 0 && (
                                 <div>
                                   <h4 className="text-[11px] font-bold text-gray-500 mb-2">💸 ประวัติเบิกเงินสด</h4>
                                   <div className="space-y-2">
                                     {newWithdrawals.sort((a,b) => new Date(b.transaction_date || b.created_at) - new Date(a.transaction_date || a.created_at)).map(tx => (
                                       <div key={tx.id} className="bg-orange-50 p-3 rounded-xl border border-orange-100 flex justify-between items-center shadow-sm">
                                         <div>
                                           <h4 className="font-bold text-orange-900 text-sm">เบิกเงินสด ({tx.spender_name})</h4>
                                           <p className="text-[10px] text-orange-700 mt-0.5">📅 {new Date(tx.transaction_date || tx.created_at).toLocaleString('th-TH')}</p>
                                         </div>
                                         <div className="text-right">
                                            <span className="font-black text-orange-700 text-lg">-{Number(tx.total_amount).toLocaleString()} ฿</span>
                                            {userRole === 'BOSS' && (
                                              <button onClick={() => handleDeleteExpense(tx.id)} className="block text-[10px] text-red-500 font-bold mt-1 hover:underline text-right w-full">
                                                ยกเลิก (ดึงเงินกลับ)
                                              </button>
                                            )}
                                         </div>
                                       </div>
                                     ))}
                                   </div>
                                 </div>
                               )}

                               {/* ส่วนที่ 2: เคลียร์บิลรายแปลง */}
                               {oldPaidBills.length > 0 && (
                                 <div>
                                   <h4 className="text-[11px] font-bold text-gray-500 mb-2 mt-4">🚜 ประวัติรับเงินรายแปลง</h4>
                                   <div className="space-y-2">
                                     {oldPaidBills.map(tx => {
                                        const { jobWorkers, paidWorkers, detailsStr } = parseWageNote(tx.note);
                                        const divisor = jobWorkers.length > 0 ? jobWorkers.length : 1;
                                        const totalAmount = Number(tx.total_amount);
                                        const displayAmount = activeWorker ? (totalAmount / divisor) : totalAmount;

                                        return (
                                          <div key={tx.id} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
                                             <div className="absolute top-0 left-0 w-1.5 h-full bg-green-400"></div>
                                             <div className="flex justify-between items-start pl-2">
                                               <div className="flex-1 pr-2">
                                                 <div className="flex flex-wrap gap-1 mb-1.5">
                                                   {jobWorkers.map((w, idx) => {
                                                     const hasPaid = paidWorkers.includes(w) || tx.status === 'PAID';
                                                     return (
                                                       <span key={idx} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${hasPaid ? 'bg-green-100 text-green-700 border-green-300' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                                                         {hasPaid ? '✅' : '⏳'} {w}
                                                       </span>
                                                     )
                                                   })}
                                                 </div>
                                                 <p className="text-[11px] text-gray-700 font-bold mb-0.5">{detailsStr ? `📐 ${detailsStr}` : 'ไม่มีรายละเอียด'}</p>
                                               </div>
                                               <div className="text-right shrink-0">
                                                 <span className="block font-black text-green-600 text-lg leading-none mb-1">
                                                   +{displayAmount.toLocaleString()} ฿
                                                 </span>
                                                 <span className="inline-block text-[8px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border-gray-200 border">
                                                   {activeWorker ? (divisor > 1 ? `ส่วนแบ่งหาร ${divisor}` : `งานเดี่ยว`) : `ยอดเต็มบิล`}
                                                 </span>
                                               </div>
                                             </div>
                                          </div>
                                        )
                                     })}
                                   </div>
                                 </div>
                               )}
                             </>
                           )}
                         </div>
                       )
                    })()}
                </div>
              </div>
            </div>
          );
        })()}

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
                {/* หมวดหมู่ (ระบบเรียนรู้คำอัตโนมัติ) */}
                {(() => {
                  // 🧠 1. ดึงชื่อหมวดหมู่ที่เคยบันทึกไว้ในประวัติ มาผสมกับหมวดหมู่พื้นฐาน
                  const defaultCategories = ['น้ำมัน', 'อะไหล่', 'ซ่อมรถ', 'ค่าอาหาร', 'ค่าเดินทาง', 'ค่างวดรถเกี่ยว', 'ค่างวดรถ 10 ล้อ'];
                  
                  // ดึงหมวดหมู่จากฐานข้อมูล (กรองเอาพวกค่าแรงออกไป เพราะมีระบบจัดการแยกแล้ว)
                  const usedCategories = expenseTransactions
                      .map(tx => tx.category)
                      .filter(c => c && !['เบิกค่าแรง', 'WAGE', 'ค่าแรง'].includes(c));
                  
                  // ลบชื่อที่ซ้ำกันออก
                  const allCategories = Array.from(new Set([...defaultCategories, ...usedCategories]));
                  
                  // เช็คว่าหมวดหมู่ปัจจุบันอยู่ในลิสต์หรือไม่ (ถ้าไม่อยู่แปลว่ากำลังพิมพ์ของใหม่)
                  const isStandard = allCategories.includes(expenseData.category) && expenseData.category !== '';

                  return (
                    <div>
                      <label className="block text-gray-700 font-semibold mb-1 text-sm">หมวดหมู่ค่าใช้จ่าย</label>
                      <select 
                        className="w-full border p-2 rounded-lg bg-gray-50 mb-2 font-bold text-gray-800"
                        value={isStandard ? expenseData.category : 'CUSTOM'}
                        onChange={(e) => {
                          if (e.target.value === 'CUSTOM') {
                            setExpenseData({...expenseData, category: ''});
                          } else {
                            setExpenseData({...expenseData, category: e.target.value});
                          }
                        }}
                      >
                        {allCategories.map(cat => (
                          <option key={cat} value={cat}>
                             {/* เติมไอคอนให้หมวดหมู่หลัก ถ้าเป็นของใหม่ที่ดึงมาให้ใช้ไอคอน 📌 */}
                             {cat === 'น้ำมัน' ? '⛽ ' : 
                              cat === 'อะไหล่' ? '🛞 ' : 
                              cat === 'ซ่อมรถ' ? '🔧 ' : 
                              cat === 'ค่าอาหาร' ? '🍚 ' : 
                              cat === 'ค่าเดินทาง' ? '🚗 ' : 
                              cat.includes('ค่างวด') ? '🚜 ' : '📌 '}
                             {cat}
                          </option>
                        ))}
                        <option value="CUSTOM">✨ พิมพ์หมวดหมู่ใหม่...</option>
                      </select>

                      {/* กล่องพิมพ์จะโผล่มาเฉพาะตอนเลือก "พิมพ์หมวดหมู่ใหม่..." */}
                      {!isStandard && (
                        <input 
                          type="text" 
                          placeholder="ตั้งชื่อหมวดหมู่ใหม่ (เช่น ค่าทางด่วน, ค่าปรับ)" 
                          className="w-full border border-blue-400 bg-blue-50 text-blue-900 font-bold p-2 rounded-lg text-sm shadow-inner focus:ring-2 focus:ring-blue-500 outline-none"
                          value={expenseData.category}
                          onChange={(e) => setExpenseData({...expenseData, category: e.target.value})}
                          autoFocus
                        />
                      )}
                    </div>
                  );
                })()}

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