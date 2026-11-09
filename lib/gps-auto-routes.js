'use strict';
const { createHash, timingSafeEqual } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { VERSION } = require('./gps-auto');
const unwrap = value => { if(value.error)throw value.error;return value.data; };
const thaiDay = (now=Date.now()) => new Date(now+7*3600000).toISOString().slice(0,10);
const validDay = date => typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date;
const secureEqual = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));

function gpsAreaStore(db) {
  return {
    async settings(vehicle) { return unwrap(await db.from('gps_area_settings').select('vehicle_id,enabled,head_width_m').eq('vehicle_id',vehicle).maybeSingle()); },
    async enabled() { return unwrap(await db.from('gps_area_settings').select('vehicle_id').eq('enabled',true)); },
    async token() { return unwrap(await db.from('gps_area_worker').select('token').eq('id','main').single()).token; },
    async saved(vehicle,date) { return unwrap(await db.from('gps_area_daily').select('*').eq('vehicle_id',vehicle).eq('work_date',date).maybeSingle()); },
    async edges(vehicle,date) { return unwrap(await db.from('gps_route_edits').select('excluded_edges,revision').eq('vehicle_id',vehicle).eq('work_date',date).maybeSingle()) || {excluded_edges:[],revision:0}; },
    async gps(vehicle,date) {
      const start=new Date(`${date}T00:00:00+07:00`),end=new Date(start.getTime()+86400000),rows=[];
      for(let offset=0;offset<100000;offset+=1000) {
        const page=unwrap(await db.from('gps_logs').select('id,vehicle_id,latitude,longitude,created_at,is_harvesting').eq('vehicle_id',vehicle)
          .gte('created_at',start.toISOString()).lt('created_at',end.toISOString()).order('created_at').order('id').range(offset,offset+999));
        rows.push(...page);if(page.length<1000)return rows;
      }
      throw new Error('GPS day is too large');
    },
    async save(row,revision) {
      const query=revision?db.from('gps_area_daily').update(row).eq('vehicle_id',row.vehicle_id).eq('work_date',row.work_date).eq('revision',revision):db.from('gps_area_daily').insert(row);
      const answer=await query.select('*').maybeSingle();
      if(answer.error?.code==='23505'||(!answer.error&&!answer.data)) return null;
      return unwrap(answer);
    }
  };
}

function runAnalysis(rows,options) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'gps-auto-worker.js'),{workerData:{rows,options}});
    let settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);worker.terminate();};
    const timer=setTimeout(()=>finish(new Error('GPS analysis timed out')),30000);
    worker.once('message',message=>finish(message.error?new Error(message.error):null,message.result));
    worker.once('error',error=>finish(error));
    worker.once('exit',code=>{if(!settled)finish(new Error(`GPS worker stopped (${code})`));});
  });
}

function createAreaService(store,{analyze=runAnalysis,now=()=>Date.now()}={}) {
  const pending=new Map(),cache=new Map();
  async function calculate(vehicle,date) {
    const [settings,saved,edits,rows]=await Promise.all([store.settings(vehicle),store.saved(vehicle,date),store.edges(vehicle,date),store.gps(vehicle,date)]);
    if(!settings?.enabled) return {enabled:false,vehicle_id:vehicle,work_date:date};
    // Raw tracker history expires after seven days. Never replace a complete snapshot with a truncated one.
    if(saved && (!rows.length || (saved.source_first && Date.parse(rows[0].created_at)>Date.parse(saved.source_first))))
      return {...saved.result,enabled:true,archived:true,updated_at:saved.updated_at};
    if(!rows.length) return {enabled:true,status:'no_data',estimated_rai:null,vehicle_id:vehicle,work_date:date,head_width_m:Number(settings.head_width_m),plots:[],accepted_edges:[]};
    const fingerprint=createHash('sha256').update(JSON.stringify({v:VERSION,head:Number(settings.head_width_m),edits:edits.revision,rows:rows.map(p=>[p.id,p.created_at,p.latitude,p.longitude])})).digest('hex');
    if(saved?.fingerprint===fingerprint)return {...saved.result,enabled:true,updated_at:saved.updated_at};
    const result=await analyze(rows,{vehicleId:vehicle,workDate:date,headWidth:Number(settings.head_width_m),excludedEdges:edits.excluded_edges});
    const row={vehicle_id:vehicle,work_date:date,result,fingerprint,revision:(saved?.revision||0)+1,source_first:rows[0].created_at,source_last:rows.at(-1).created_at,updated_at:new Date(now()).toISOString()};
    const persisted=await store.save(row,saved?.revision||0);
    if(!persisted) {
      const newer=await store.saved(vehicle,date);
      if(!newer)throw new Error('Concurrent GPS snapshot update');
      return {...newer.result,enabled:true,updated_at:newer.updated_at};
    }
    return {...result,enabled:true,updated_at:row.updated_at};
  }
  async function get(vehicle,date) {
    const key=`${vehicle}/${date}`,cached=cache.get(key);
    if(cached && now()-cached.at<20000)return cached.result;
    if(pending.has(key))return pending.get(key);
    if(pending.size>=2)throw Object.assign(new Error('GPS analysis busy'),{status:429});
    const promise=calculate(vehicle,date).then(result=>{
      if(cache.size>30)cache.delete(cache.keys().next().value);cache.set(key,{at:now(),result});return result;
    }).finally(()=>pending.delete(key));
    pending.set(key,promise);return promise;
  }
  let ticking=null;
  async function tick() {
    if(ticking)return ticking;
    ticking=(async()=>{
      const vehicles=await store.enabled(),dates=[thaiDay(now()-86400000),thaiDay(now())],results=[];
      for(const v of vehicles)for(const date of dates) {
        try {await get(Number(v.vehicle_id),date);results.push({vehicle_id:v.vehicle_id,date,ok:true});}
        catch(error){console.error('GPS area worker:',error.message);results.push({vehicle_id:v.vehicle_id,date,ok:false});}
      }
      return results;
    })().finally(()=>{ticking=null;});
    return ticking;
  }
  return {get,tick};
}

function registerGpsArea(app,{store,service=createAreaService(store)}) {
  app.get('/api/gps-area/:vehicle',async(req,res)=>{
    const vehicle=Number(req.params.vehicle),date=req.query.date||thaiDay();
    if(!Number.isSafeInteger(vehicle)||vehicle<=0||!validDay(date)||date>thaiDay())return res.status(400).json({error:'รถหรือวันที่ไม่ถูกต้อง'});
    try {res.set('Cache-Control','no-store').json(await service.get(vehicle,date));}
    catch(error){console.error('GPS area:',error.message);res.status(error.status||503).json({error:'คำนวณพื้นที่ยังไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ'});}
  });
  app.post('/api/gps-area-worker',async(req,res)=>{
    try {
      if(!secureEqual(req.get('x-gps-worker-token'),await store.token()))return res.sendStatus(403);
      const results=await service.tick();res.status(results.every(r=>r.ok)?200:503).json({results});
    } catch(error){console.error('GPS scheduled worker:',error.message);res.sendStatus(503);}
  });
  // Also refresh while the API is running; a database schedule wakes sleeping hosts.
  const timer=setInterval(()=>service.tick().catch(error=>console.error('GPS background:',error.message)),120000);
  timer.unref();
  return {service,stop:()=>clearInterval(timer)};
}
module.exports={gpsAreaStore,createAreaService,registerGpsArea,thaiDay,validDay,secureEqual};
