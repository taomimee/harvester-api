'use strict';
const turf = require('@turf/turf');
const {createHash} = require('node:crypto');
const fail = (message, status=409) => Object.assign(new Error(message), {status});
const merge = shapes => shapes.length>1 ? turf.union(turf.featureCollection(shapes.map(p=>turf.truncate(p,{precision:7,coordinates:2})))) : shapes[0] || null;

// A manual seal is a durable, explicit boundary between work sessions. Automatic
// departure receipts alone continue to use the existing return/merge behaviour.
async function sealGpsPlot(result, plotId, requestId, lockedAt) {
  const {gpsFieldAliases}=await import('../harvester-app/src/gps-field-identity.mjs');
  const aliases=gpsFieldAliases(result.plots),canonical=aliases[plotId];
  if(!canonical)throw fail('ไม่พบแปลงนี้ กรุณาเปิดรายการล่าสุด');
  const members=result.plots.filter(p=>aliases[p.id]===canonical);
  if(!members.some(p=>p.state!=='completed') || members.some(p=>p.manual_seal))
    throw fail('แปลงนี้ล็อกแล้ว กรุณาเปิดรายการล่าสุด');
  if(!Number.isFinite(Date.parse(result.observed_at)))throw fail('ยังไม่มีพิกัดสำหรับล็อกแปลง');
  const ids=new Set(members.map(p=>p.id));
  const locks=(result.locked_plots||[]).map(p=>ids.has(p.plot_id)?{...p,manual_seal:requestId,manual_cutoff_at:result.observed_at}:p);
  let covered=merge(locks.map(p=>p.geometry));
  for(const plot of members) {
    const geometry=covered?turf.difference(turf.featureCollection([plot.geometry,covered].map(p=>turf.truncate(p,{precision:7,coordinates:2})))):plot.geometry;
    if(!geometry || turf.area(geometry)<1)continue;
    // Short deterministic receipt IDs stay within the existing editable-plot limit.
    const id='MANUAL-'+createHash('sha256').update(`${result.vehicle_id}/${result.work_date}/${requestId}/${plot.id}`).digest('hex').slice(0,24);
    const sqm=covered?turf.area(geometry):plot.area_sqm;
    locks.push({...plot,id,plot_id:plot.id,geometry,area_sqm:sqm,estimated_rai:sqm/1600,
      state:'completed',closed_at:lockedAt,locked_at:lockedAt,manual_seal:requestId,manual_cutoff_at:result.observed_at,reason:'manually_locked'});
    covered=merge([covered,geometry].filter(Boolean));
  }
  const seal={request_id:requestId,plot_id:canonical,plot_ids:[...ids],cutoff_at:result.observed_at,locked_at:lockedAt,
    edge_keys:[...new Set(members.flatMap(p=>p.edge_keys||[]))]};
  const plots=result.plots.map(p=>{
    if(!ids.has(p.id))return p;
    const own=locks.filter(r=>r.plot_id===p.id),rai=own.reduce((n,r)=>n+r.estimated_rai,0);
    return {...p,state:'completed',locked_at:lockedAt,closed_at:lockedAt,manual_seal:requestId,
      geometry:merge(own.map(r=>r.geometry)),estimated_rai:rai,area_sqm:rai*1600,locked_rai:rai,additional_rai:0,reason:'manually_locked'};
  });
  const completed=locks.reduce((n,p)=>n+p.estimated_rai,0);
  const working=plots.filter(p=>p.state!=='completed').reduce((n,p)=>n+(p.additional_rai??p.estimated_rai),0);
  return {...result,plots,locked_plots:locks,manual_seals:[...(result.manual_seals||[]),seal],
    estimated_rai:completed+working,completed_rai:completed,working_rai:working,
    locked_count:new Set(locks.map(p=>p.plot_id)).size,status:working>0?'measuring':'completed'};
}
module.exports={sealGpsPlot};
