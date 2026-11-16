import {area, bbox, featureCollection, intersect, polygon, union} from '@turf/turf';
import {savedPlotGeometry} from './gps-map-compute.mjs';

export function splitGeometry(geometry, line) {
  if (!geometry || !Array.isArray(line) || line.length !== 2) throw new Error('แตะสองจุดเพื่อวางเส้นแบ่ง');
  const xy = line.map(p => [Number(p.lng), Number(p.lat)]);
  if (xy.some(p => !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new Error('ตำแหน่งเส้นแบ่งไม่ถูกต้อง');
  const [a,b] = xy, dx = b[0]-a[0], dy = b[1]-a[1], length = Math.hypot(dx,dy);
  if (length < .00001) throw new Error('จุดเส้นแบ่งอยู่ใกล้กันเกินไป');
  const box=bbox(geometry), radius=Math.max(...[[box[0],box[1]],[box[2],box[3]]].map(p=>Math.hypot(p[0]-a[0],p[1]-a[1]))) * 4 + .01;
  const u=[dx/length,dy/length], n=[-u[1],u[0]];
  const start=[a[0]-u[0]*radius,a[1]-u[1]*radius], end=[a[0]+u[0]*radius,a[1]+u[1]*radius];
  const parts=[1,-1].map(side=>{
    const shift=p=>[p[0]+n[0]*radius*side,p[1]+n[1]*radius*side];
    return intersect(featureCollection([geometry,polygon([[start,end,shift(end),shift(start),start]])]));
  });
  if (parts.some(p=>!p || area(p)<1)) throw new Error('เส้นนี้ยังไม่แบ่งเป็นสองแปลง เลื่อนเส้นให้ผ่านแปลง');
  const total=area(geometry), sum=parts.reduce((s,p)=>s+area(p),0);
  if (Math.abs(total-sum)>Math.max(.01,total*1e-8)) throw new Error('พื้นที่ก่อนและหลังแบ่งไม่ตรงกัน กรุณาปรับเส้น');
  return {parts, totalRai:total/1600, areas:parts.map(p=>area(p)/1600), line, extendedLine:[start,end]};
}

export function buildSplitPlan({plots, ids, line, names, requestId, vehicle, date, createdAt}) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size!==ids.length) throw new Error('กรุณาเลือกแปลงที่ต้องการแบ่ง');
  const selected=plots.filter(p=>ids.includes(p.id));
  if (selected.length!==ids.length) throw new Error('รายการแปลงเปลี่ยนแล้ว กรุณาโหลดล่าสุด');
  if (selected.some(p=>p.job_id!=null)) throw new Error('แปลงนี้ผูกคิวแล้ว กรุณาตรวจคิวและยกเลิกการผูกก่อนแบ่ง เพื่อรักษายอดเดิม');
  const shapes=selected.map(p=>savedPlotGeometry(p).net);
  if (shapes.some(p=>!p)) throw new Error('ขอบแปลงเดิมไม่พร้อมแบ่ง');
  const geometry=shapes.length>1?union(featureCollection(shapes)):shapes[0];
  const preview=splitGeometry(geometry,line), newPlots=[];
  const sourceParts=[...new Set(selected.flatMap(p=>[p.id,p.auto_origin?.source_part_id,...p.split_origin?.source_parts||[]]).filter(Boolean))];
  const sourceReceipts=[...new Set(selected.flatMap(p=>[p.auto_origin?.receipt_id,...p.split_origin?.source_receipts||[]]).filter(Boolean))];
  preview.parts.forEach((part,side)=>{
    const polygons=part.geometry.type==='Polygon'?[part.geometry.coordinates]:part.geometry.coordinates;
    for (const [i,rings] of polygons.entries()) {
      if (area(polygon(rings))<1) throw new Error('เส้นแบ่งเกิดเศษแปลงเล็กกว่า 1 ตร.ม. กรุณาขยับเส้นเล็กน้อย');
      if (rings.length>101 || rings.some(r=>r.length>2001)) throw new Error('ขอบแปลงมีจุดมากเกินไป กรุณาปรับเส้นแบ่ง');
      const points=r=>r.slice(0,-1).map(([lng,lat])=>({lat,lng}));
      newPlots.push({id:`split-${requestId}-${side+1}-${i+1}`,name:String(names?.[side]||`แปลงใหม่ ${side+1}`).trim().slice(0,120),
        job_id:null,source:'GPS_SPLIT',created_at:createdAt,points:points(rings[0]),
        holes:rings.slice(1).map((r,h)=>({id:`split-hole-${h+1}`,points:points(r),status:'confirmed',source:'GPS_SPLIT'})),holeSuggestions:[],
        auto_origin:selected[0].auto_origin,
        split_origin:{request_id:requestId,field_id:`split-${requestId}-${side+1}`,side:side+1,vehicle_id:Number(vehicle),work_date:date,
          locked_at:createdAt,source_ids:ids,source_parts:sourceParts,source_receipts:sourceReceipts,line}});
    }
  });
  const next=[...plots.filter(p=>!ids.includes(p.id)),...newPlots];
  if(next.length>200)throw new Error('จำนวนแปลงเกินขีดจำกัด');
  return {...preview,plots:next,created:newPlots};
}
