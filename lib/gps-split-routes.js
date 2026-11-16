'use strict';
const {createHash}=require('node:crypto');
const {validDay}=require('./gps-auto-routes');
const modules=Promise.all([import('../harvester-app/src/gps-split.mjs'),import('../harvester-app/src/gps-field-identity.mjs')]);
const unwrap=result=>{if(result.error)throw result.error;return result.data;};
const fail=(message,status=409)=>Object.assign(new Error(message),{status});

function splitStore(db) {
  return {
    async snapshot(vehicle,date) {return unwrap(await db.from('harvest_plots').select('plots_data,revision').eq('vehicle_id',vehicle).eq('work_date',date).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle())||{plots_data:[],revision:0};},
    async area(vehicle,date) {return unwrap(await db.from('gps_area_daily').select('result').eq('vehicle_id',vehicle).eq('work_date',date).maybeSingle())?.result;},
    async claimed(keys) {return unwrap(await db.from('field_trip_gps_claims').select('plot_key').in('plot_key',keys).limit(1)).length>0;},
    async save(vehicle,date,revision,plots) {return unwrap(await db.rpc('save_gps_job_plots',{p_vehicle_id:vehicle,p_work_date:date,p_plots:plots,p_expected_revision:revision}));}
  };
}
function createSplitService(store,normalize,now=()=>new Date().toISOString()) {
  return async body=>{
    const {vehicle_id:vehicle,work_date:date,expected_revision:revision,source_ids:ids,line,names,request_id:requestId}=body||{};
    if(!Number.isSafeInteger(vehicle)||vehicle<=0||!validDay(date)||!Number.isSafeInteger(revision)||revision<0
      ||!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string'||id.length>120)
      ||!Array.isArray(line)||line.length!==2||!Array.isArray(names)||names.length!==2||names.some(n=>typeof n!=='string'||!n.trim()||n.length>120)
      ||typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw fail('ข้อมูลแบ่งแปลงไม่ครบ กรุณาเปิดแปลงใหม่',400);
    const requestHash=createHash('sha256').update(JSON.stringify({vehicle,date,ids:[...ids].sort(),line,names})).digest('hex');
    const snapshot=await store.snapshot(vehicle,date);
    const repeated=snapshot.plots_data.find(p=>p.split_origin?.request_id===requestId);
    if(repeated){if(repeated.split_origin.request_hash!==requestHash)throw fail('รหัสคำขอซ้ำกับการแบ่งครั้งอื่น');return {...snapshot,repeated:true};}
    if(snapshot.revision!==revision)throw fail('มีการแก้แปลงแล้ว กรุณาโหลดล่าสุดแล้ววางเส้นใหม่');
    const [{buildSplitPlan},{gpsFieldAliases,gpsOriginFieldId}]=await modules;
    const data=await store.area(vehicle,date),aliases=gpsFieldAliases(data?.plots);
    const key=p=>gpsOriginFieldId(p,aliases,vehicle,date)||`saved:${p.id}`;
    const selected=snapshot.plots_data.filter(p=>ids.includes(p.id));
    if(selected.length!==ids.length || !selected.length)throw fail('ไม่พบแปลงที่เลือก');
    const group=key(selected[0]);
    if(selected.some(p=>key(p)!==group)||snapshot.plots_data.some(p=>key(p)===group&&!ids.includes(p.id)))throw fail('กรุณาเลือกทั้งแปลงจากรายการล่าสุด');
    if(!selected[0].split_origin && data?.plots?.some(p=>(aliases[p.id]||p.id)===group&&p.state!=='completed'))throw fail('แปลงยังวัดอยู่ กรุณาล็อกแปลงก่อนแบ่งย้อนหลัง');
    if(selected.some(p=>p.job_id!=null))throw fail('แปลงนี้ผูกคิวแล้ว กรุณาตรวจคิวและยกเลิกการผูกก่อนแบ่ง เพื่อรักษายอดเดิม');
    if(await store.claimed(ids.map(id=>`${vehicle}/${date}/${id}`)))throw fail('แปลงนี้ใช้ลงยอดนอกพื้นที่แล้ว กรุณาตรวจรายการในทริปก่อนแบ่ง');
    let plan;
    try {plan=buildSplitPlan({plots:snapshot.plots_data,ids,line,names,requestId,vehicle,date,createdAt:now()});}
    catch(error){throw fail(error.message,400);}
    for(const plot of plan.created)plot.split_origin.request_hash=requestHash;
    const normalized=normalize(plan.plots,vehicle,date);
    try{return {...await store.save(vehicle,date,revision,normalized),areas:plan.areas,total_rai:plan.totalRai};}
    catch(error){
      if(!String(error.message).includes('GPS_REVISION_CONFLICT'))throw error;
      const newer=await store.snapshot(vehicle,date);
      if(newer.plots_data.some(p=>p.split_origin?.request_id===requestId&&p.split_origin.request_hash===requestHash))return {...newer,repeated:true};
      throw fail('มีการแก้แปลงแล้ว กรุณาโหลดล่าสุดแล้ววางเส้นใหม่');
    }
  };
}
function registerGpsSplit(app,{store,normalize}) {
  const split=createSplitService(store,normalize);
  app.post('/api/plots/split',async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{res.json({success:true,...await split(req.body)});}
    catch(error){console.error('GPS split:',error.message);res.status(error.status||503).json({error:error.status?error.message:'ยังยืนยันการแบ่งไม่ได้ กรุณาลองใหม่ด้วยปุ่มเดิม'});}
  });
}
module.exports={splitStore,createSplitService,registerGpsSplit};
