import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import {createPortal} from 'react-dom';
import {runGpsGeometry} from './useGpsMapGeometry';
import {formatGpsRaiNgan} from './thai-area.mjs';
import './gps-split.css';

const colors=['#1d4ed8','#b45309'];
export default function GpsSplit({map,group,vehicle,date,revision,sourceIds,onSaved,onClose}) {
  const [line,setLine]=useState([]),[preview,setPreview]=useState(null),[error,setError]=useState('');
  const [names,setNames]=useState([`${group.name || 'แปลง'} ก`,`${group.name || 'แปลง'} ข`]);
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const request=useRef(null),dialog=useRef(null),cancel=useRef(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(!map)return;
    const fit=()=>map.fitBounds(L.geoJSON(group.geometry).getBounds(),{paddingTopLeft:[42,40],paddingBottomRight:[42,220],maxZoom:19,animate:false});
    fit();map.on('resize',fit);
    return()=>map.off('resize',fit);
  },[map,group.geometry]);
  useEffect(()=>{
    setPreview(null);setConfirm(false);setError('');
    if(line.length!==2)return;
    let active=true;const task=runGpsGeometry('split',{geometry:group.geometry,line});
    task.result.then(result=>{if(active)setPreview(result);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;task.cancel();};
  },[line,group.geometry]);
  useEffect(()=>{
    if(!map)return;
    const layer=L.layerGroup().addTo(map);
    let positionLabels;
    if(preview){
      const labels=[];
      preview.parts.forEach((part,i)=>{
        const shape=L.geoJSON(part,{style:{color:colors[i],fillColor:colors[i],fillOpacity:.3,weight:4},interactive:false}).addTo(layer);
        const center=shape.getBounds().getCenter();
        const label=L.marker(center,{interactive:false,icon:L.divIcon({className:'gps-split-label',html:`<b style="color:${colors[i]}">${i+1}</b><span>${formatGpsRaiNgan(preview.areas[i])}</span>`,iconSize:[110,50]})}).addTo(layer);
        labels.push({center,label});
      });
      positionLabels=()=>{
        const points=labels.map(({center})=>map.latLngToContainerPoint(center));
        if(Math.abs(points[0].x-points[1].x)<120 && Math.abs(points[0].y-points[1].y)<64){
          const middle=(points[0].y+points[1].y)/2, firstAbove=points[0].y<=points[1].y;
          points[0].y=middle+(firstAbove?-32:32);points[1].y=middle+(firstAbove?32:-32);
        }
        labels.forEach(({label},i)=>label.setLatLng(map.containerPointToLatLng(points[i])));
      };
      positionLabels();map.on('zoomend resize',positionLabels);
      L.polyline(preview.extendedLine.map(([lng,lat])=>[lat,lng]),{color:'#dc2626',weight:3,dashArray:'8 6',interactive:false}).addTo(layer);
    } else L.geoJSON(group.geometry,{style:{color:'#176147',fillOpacity:.15,weight:3},interactive:false}).addTo(layer);
    line.forEach((p,i)=>L.marker([p.lat,p.lng],{draggable:!confirm,icon:L.divIcon({className:'gps-split-point',html:String(i+1),iconSize:[36,36],iconAnchor:[18,18]})})
      .on('dragend',e=>{const p=e.target.getLatLng();setLine(old=>old.map((v,j)=>j===i?{lat:p.lat,lng:p.lng}:v));}).addTo(layer));
    const click=e=>{if(!confirm && line.length<2)setLine(old=>[...old,{lat:e.latlng.lat,lng:e.latlng.lng}]);};
    map.on('click',click);
    return()=>{map.off('click',click);if(positionLabels)map.off('zoomend resize',positionLabels);layer.remove();};
  },[map,line,preview,group.geometry,confirm]);
  useEffect(()=>{
    if(confirm){dialog.current?.showModal();cancel.current?.focus();}
  },[confirm]);
  const save=async()=>{
    if(busy || !preview)return;
    request.current ||= {vehicle_id:Number(vehicle),work_date:date,expected_revision:revision,source_ids:sourceIds,line,names,request_id:crypto.randomUUID()};
    setBusy(true);setError('');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch('https://harvester-api-server.onrender.com/api/plots/split',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.current),signal:controller.signal});
      const result=await response.json();
      if(!response.ok){setUncertain(response.status>=500);throw new Error(result.error || 'ยังบันทึกไม่ได้');}
      if(alive.current)onSaved(result);
    }catch(e){if(alive.current){if(e.name==='AbortError'||e instanceof TypeError)setUncertain(true);setError(e.name==='AbortError'?'ยังไม่ทราบผล กดยืนยันซ้ำได้โดยไม่แบ่งซ้ำ':e.message);}}
    finally{clearTimeout(timer);if(alive.current)setBusy(false);}
  };
  return <>
    <section className="gps-split-panel" aria-label="แบ่งแปลงย้อนหลัง">
      <div className="gps-split-title"><strong>✂️ แบ่งแปลงย้อนหลัง</strong><button type="button" onClick={onClose}>ยกเลิก</button></div>
      <p>{line.length<2?`แตะจุดที่ ${line.length+1} บนแผนที่ เพื่อวางเส้นระหว่างสองแปลง`:'ลากจุด 1 หรือ 2 เพื่อปรับเส้น · ตรวจสองสีก่อนยืนยัน'}</p>
      {preview && <p><b>1: {formatGpsRaiNgan(preview.areas[0])}</b> · <b>2: {formatGpsRaiNgan(preview.areas[1])}</b></p>}
      {error&&!confirm && <p role="alert">{error}</p>}
      <div className="gps-split-actions"><button type="button" disabled={!line.length} onClick={()=>setLine([])}>วางเส้นใหม่</button>
        {line.length<2 && <button type="button" onClick={()=>{const p=map.getCenter();setLine(old=>[...old,{lat:p.lat,lng:p.lng}]);}}>＋ จุดกลางจอ</button>}
        <button type="button" className="gps-split-primary" disabled={!preview} onClick={()=>{request.current=null;setConfirm(true);}}>ตรวจและยืนยัน</button></div>
    </section>
    {confirm && preview && createPortal(<dialog className="gps-split-dialog" ref={dialog} aria-labelledby="gps-split-confirm-title" onCancel={e=>{e.preventDefault();if(!busy&&!uncertain)setConfirm(false);}}>
      <h2 id="gps-split-confirm-title">ยืนยันแยกเป็น 2 แปลง?</h2>
      {names.map((name,i)=><label key={i} style={{borderColor:colors[i]}}>ชื่อแปลง {i+1}<input value={name} maxLength={120} disabled={busy||uncertain} onChange={e=>{request.current=null;setNames(old=>old.map((v,j)=>j===i?e.target.value:v));}}/><b>{formatGpsRaiNgan(preview.areas[i])}</b></label>)}
      <p>รวม {formatGpsRaiNgan(preview.totalRai)} · พื้นที่จริงเท่าเดิม<br/><small>แสดงงานปัดขึ้นตามเดิม · แยกผูกคิวและลงยอดได้หลังบันทึก</small></p>
      {error&&<p role="alert">{error}</p>}
      <div className="gps-split-actions"><button type="button" ref={cancel} disabled={busy} onClick={()=>{if(uncertain)onClose();else setConfirm(false);}}>{uncertain?'ปิดและโหลดล่าสุด':'กลับไปปรับเส้น'}</button><button type="button" className="gps-split-primary" disabled={busy||names.some(n=>!n.trim())} onClick={save}>{busy?'กำลังบันทึก…':'ยืนยันแบ่งแปลง'}</button></div>
    </dialog>,document.body)}
  </>;
}
