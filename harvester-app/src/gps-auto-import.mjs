import { area, polygon } from '@turf/turf';

// Convert only durable lock receipts into the existing editable plot format.
// A receipt/part has one stable ID. Retrying never replaces an edited or linked copy.
export function prepareAutoPlotUse(data, plotId, existing, vehicle, date) {
  if (String(data?.vehicle_id) !== String(vehicle) || data?.work_date !== date) throw new Error('รถหรือวันที่ของแปลงเปลี่ยนแล้ว กรุณาโหลดใหม่');
  const receipts = (data.locked_plots || []).filter(p => p.plot_id === plotId && p.locked_at);
  if (!receipts.length) throw new Error('แปลงนี้ยังไม่มีส่วนที่ล็อกแล้ว');
  const next = existing.map(p => ({...p})), ids = [], added = [], skipped = [];
  for (const receipt of receipts) {
    const geometry = receipt.geometry?.geometry || receipt.geometry;
    const parts = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
    if (!parts.length) throw new Error('ไม่พบขอบแปลงที่ล็อกไว้');
    for (const [index, rings] of parts.entries()) {
      const id = `auto-${receipt.id}-${index + 1}`;
      if (id.length > 120) throw new Error('รหัสแปลงยาวเกินไป');
      if (next.some(p => p.id === id)) { ids.push(id); continue; }
      const ring = coordinates => {
        const closed = coordinates.length > 1 && coordinates[0][0] === coordinates.at(-1)[0] && coordinates[0][1] === coordinates.at(-1)[1];
        const points = (closed ? coordinates.slice(0,-1) : coordinates).map(([lng,lat]) => ({lat,lng}));
        if (points.length < 3 || points.length > 2000 || points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) throw new Error('ขอบแปลงไม่พร้อมใช้ กรุณาตรวจพิกัด');
        return points;
      };
      if (rings.length > 101) throw new Error('แปลงนี้มีวงหักเกินขีดจำกัด กรุณาตรวจขอบแปลงก่อน');
      // Difference operations can leave sub-square-metre fragments along an
      // earlier lock. Keep raw receipts, stable part numbers and edited copies;
      // exclude only new fragments below the editable plot's 1 m² minimum.
      const points = ring(rings[0]);
      const holes = rings.slice(1).map((r,i) => ({id:`auto-hole-${i+1}`,points:ring(r),source:'GPS_LOCK',status:'confirmed'}));
      const closedRing = pts => [...pts.map(p => [p.lng,p.lat]),[pts[0].lng,pts[0].lat]];
      const squareMetres = area(polygon([closedRing(points),...holes.map(h => closedRing(h.points))]));
      if (squareMetres < 1) { skipped.push({id,squareMetres}); continue; }
      ids.push(id);
      next.push({id, name:`แปลงออโต้ ${receipt.number}${parts.length > 1 ? ` · ส่วน ${index+1}` : ''}`, job_id:null,
        source:'GPS_LOCK', points, holes, holeSuggestions:[],
        created_at:receipt.locked_at, auto_origin:{vehicle_id:Number(vehicle),work_date:date,plot_id:plotId,receipt_id:receipt.id,part:index+1,locked_at:receipt.locked_at}});
      added.push(id);
    }
  }
  if (!ids.length) throw new Error('มีเฉพาะเศษขอบ GPS เล็กกว่า 1 ตร.ม. จึงยังไม่มีแปลงที่นำไปใช้ได้');
  if (next.length > 200) throw new Error('จำนวนแปลงรวมเกิน 200 รายการ กรุณาจัดรายการเดิมก่อน');
  return {plots:next, ids, added, skipped, indices:next.flatMap((p,i) => ids.includes(p.id) ? [i] : [])};
}

export function usedAutoPlotParts(existing, plotId) {
  return existing.filter(p => p.auto_origin?.plot_id === plotId);
}

export function prepareFieldGpsDay(trip, entry, newId) {
  if (trip.status !== 'OPEN' || !trip.vehicles.some(v => String(v.id) === String(entry.vehicle_id)) || entry.work_date < trip.start_date) throw new Error('แปลงนี้ไม่ตรงกับรถหรือช่วงวันที่ของทริป');
  const old = trip.days.find(d => d.work_date === entry.work_date && String(d.vehicle_id) === String(entry.vehicle_id));
  const keys = entry.plot_ids.map(id => `${entry.vehicle_id}/${entry.work_date}/${id}`);
  return {
    ...(old || {id:newId,work_date:entry.work_date,vehicle_id:String(entry.vehicle_id),plot_count:1,confirmed_rai:'',price_per_rai:trip.price_per_rai,note:''}),
    worker_names: (old?.crew || trip.days.at(-1)?.crew || []).map(w=>w.name),
    gps_keys:[...new Set([...(old?.gps_plots || []).map(p=>p.key),...keys])]
  };
}
