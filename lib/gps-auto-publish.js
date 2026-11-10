'use strict';
const turf=require('@turf/turf');
const ring=points=>{const xy=points.map(p=>[Number(p.lng),Number(p.lat)]);return [...xy,xy[0]];};
const shape=plot=>turf.polygon([ring(plot.points),...(plot.holes||[]).map(h=>ring(h.points))]);
const unwrap=result=>{if(result.error)throw result.error;return result.data;};
function autoPublishStore(db) {
  return {
    async snapshot(vehicle,date) {
      const [plots,daily]=await Promise.all([
        db.from('harvest_plots').select('plots_data,revision').eq('vehicle_id',vehicle).eq('work_date',date).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle(),
        db.from('gps_area_daily').select('published_parts').eq('vehicle_id',vehicle).eq('work_date',date).single()
      ]);
      return {...(unwrap(plots)||{plots_data:[],revision:0}),published_parts:unwrap(daily).published_parts};
    },
    async append(vehicle,date,revision,plots,handled) {
      return unwrap(await db.rpc('publish_gps_area_plots',{p_vehicle_id:vehicle,p_work_date:date,p_expected_revision:revision,p_new_plots:plots,p_handled_parts:handled}));
    }
  };
}
async function planAutoPublish(data,snapshot,normalize=plots=>plots) {
  const {prepareAutoPlotUse}=await import('../harvester-app/src/gps-auto-import.mjs');
  const existing=snapshot.plots_data, handled=new Set(snapshot.published_parts),newPlots=[],parts=[];
  // Subtract saved geometry, including older manually generated plots, before adding new area.
  // Failure to read an old boundary must stop publication instead of counting the area twice.
  const shapes=existing.map(shape);
  let covered=shapes.length>1?turf.union(turf.featureCollection(shapes)):shapes[0];
  for(const plotId of new Set((data.locked_plots||[]).map(p=>p.plot_id))) {
    const plan=prepareAutoPlotUse(data,plotId,[],data.vehicle_id,data.work_date,{allowEmpty:true});
    for(const p of plan.plots) {
      if(handled.has(p.id))continue;
      parts.push(p.id);
      if(existing.some(old=>old.id===p.id || old.auto_origin?.source_part_id===p.id))continue;
      const original=shape(p), remaining=covered?turf.difference(turf.featureCollection([original,covered])):original;
      if(!remaining || turf.area(remaining)<1)continue;
      // A mostly matching saved field is an owner's existing boundary, not a
      // request to refill its corrected edges/holes with dozens of GPS slivers.
      if(covered && turf.area(remaining)/turf.area(original)<=0.2)continue;
      const changed=turf.area(original)-turf.area(remaining)>0.01;
      const polygons=remaining.geometry.type==='MultiPolygon'?remaining.geometry.coordinates:[remaining.geometry.coordinates];
      for(const [index,rings] of polygons.entries()) {
        if(turf.area(turf.polygon(rings))<(changed?25:1))continue;
        const points=xy=>xy.slice(0,-1).map(([lng,lat])=>({lat,lng}));
        if(rings.length>101 || rings.some(r=>r.length<4 || r.length>2001))throw new Error('GPS_PLOT_GEOMETRY_LIMIT');
        newPlots.push({...p,id:changed?`${p.id}-c${index+1}`:p.id,
          points:points(rings[0]),holes:rings.slice(1).map((r,i)=>({id:`auto-hole-${i+1}`,points:points(r),source:'GPS_LOCK',status:'confirmed'})),
          auto_origin:{...p.auto_origin,source_part_id:p.id}});
      }
      covered=covered?turf.union(turf.featureCollection([covered,remaining])):remaining;
    }
    for(const p of plan.skipped)if(!handled.has(p.id))parts.push(p.id);
  }
  if(existing.length+newPlots.length>200)throw new Error('GPS_PLOT_LIMIT');
  return {plots:normalize(newPlots,data.vehicle_id,data.work_date),handled:parts};
}
function createAutoPublisher(store,normalize) {
  return async data=>{
    for(let attempt=0;attempt<3;attempt++) {
      const snapshot=await store.snapshot(data.vehicle_id,data.work_date);
      const plan=await planAutoPublish(data,snapshot,normalize);
      if(!plan.handled.length)return {editable_ready:true,editable_revision:snapshot.revision};
      try {
        const result=await store.append(data.vehicle_id,data.work_date,snapshot.revision,plan.plots,plan.handled);
        return {editable_ready:true,editable_revision:result.revision};
      } catch(error) {if(!String(error.message).includes('GPS_REVISION_CONFLICT') || attempt===2)throw error;}
    }
  };
}
module.exports={autoPublishStore,createAutoPublisher,planAutoPublish};
