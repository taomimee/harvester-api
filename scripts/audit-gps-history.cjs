// Offline, read-only comparison. Saved polygons are a reference, not ground truth.
const fs = require('node:fs');
const turf = require('@turf/turf');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const output = [];
const time = r => Date.parse(r.created_at);
const coords = r => [Number(r.longitude), Number(r.latitude)];
const ring = points => { const c=points.map(p=>[Number(p.lng),Number(p.lat)]); return [...c,c[0]]; };
const quantile = (a,q) => {a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a[Math.floor((a.length-1)*q)] ?? null;};
for (const day of input.days) {
  const points = day.gps.slice().sort((a,b)=>time(a)-time(b) || a.id-b.id);
  const excluded = new Set(day.route_edits.excluded_edges);
  const plots = day.plots.plots_data.map((p,i)=>({
    id:p.id, label:i+1, source:p.source, rai:p.area.rawRai,
    polygon:turf.polygon([ring(p.points),...(p.holes||[]).map(h=>ring(h.points))])
  }));
  for(const p of plots) p.mask=turf.buffer(p.polygon,5,{units:'meters'});
  const edges=[];
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dt=(time(b)-time(a))/1000;
    const distance=turf.distance(coords(a),coords(b),{units:'meters'}),speed=distance/dt*3.6;
    const isExcluded=excluded.has(`${a.id}>${b.id}`), gap=dt>180 || dt<=0;
    const oldHarvest=!gap && distance<5000 && (b.is_harvesting || (distance>=1.5 && distance<=250 && speed>=.4 && speed<=15));
    const mid=turf.midpoint(coords(a),coords(b));
    const plot=plots.find(p=>turf.booleanPointInPolygon(mid,p.mask));
    edges.push({i,key:`${a.id}>${b.id}`,from:a.created_at,to:b.created_at,a:coords(a),b:coords(b),dt,distance,speed,
      oldHarvest,excluded:isExcluded,gap,plot:plot?.label||null,flag:b.is_harvesting});
  }
  const valid=edges.filter(e=>!e.gap && e.distance<=250 && !e.excluded);
  const moving=valid.filter(e=>e.distance>=1.5 && e.speed>=.4);
  const plotStats=plots.map(p=>{
    const e=valid.filter(e=>e.plot===p.label), travel=e.filter(e=>e.speed>=.4&&e.distance>=1.5);
    return {label:p.label,rai:p.rai,source:p.source,first:e[0]?.from,last:e.at(-1)?.to,
      movingMinutes:travel.reduce((n,e)=>n+e.dt,0)/60,speedMedian:quantile(travel.map(e=>e.speed),.5),speedP95:quantile(travel.map(e=>e.speed),.95)};
  });
  const summary={date:day.date,vehicle_id:day.vehicle_id,points:points.length,savedPlots:plots.length,
    savedRai:plots.reduce((n,p)=>n+p.rai,0),start:points[0]?.created_at,end:points.at(-1)?.created_at,
    intervalMedianSec:quantile(edges.map(e=>e.dt),.5),intervalP95Sec:quantile(edges.map(e=>e.dt),.95),
    gaps:edges.filter(e=>e.gap&&e.dt>180).length,excludedEdges:excluded.size,
    totalKm:valid.reduce((n,e)=>n+e.distance,0)/1000,
    legacyHarvestKm:valid.filter(e=>e.oldHarvest).reduce((n,e)=>n+e.distance,0)/1000,
    outsideSavedLegacyKm:valid.filter(e=>e.oldHarvest&&!e.plot).reduce((n,e)=>n+e.distance,0)/1000,
    speedMedian:quantile(moving.map(e=>e.speed),.5),speedP95:quantile(moving.map(e=>e.speed),.95),
    outlierEdges:edges.filter(e=>!e.gap&&(e.speed>30||e.distance>250)).length,
    slowFlagFalseEdges:valid.filter(e=>e.oldHarvest&&!e.flag).length,plotStats};
  output.push({summary,plots:plots.map(({mask,...p})=>p),edges});
}
fs.writeFileSync(process.argv[3],JSON.stringify({captured_at:input.captured_at,days:output},null,2));
console.log(JSON.stringify(output.map(d=>d.summary),null,2));
