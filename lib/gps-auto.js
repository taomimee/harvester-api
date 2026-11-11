'use strict';

const turf = require('@turf/turf');
const VERSION = 'gps-area-v6';
const { finalizePlotLocks } = require('./gps-plot-locks');
const EARTH = 6371008.8;
const rad = Math.PI / 180;
const pointKey = p => p.id != null ? String(p.id) : `${p.created_at}|${p.latitude}|${p.longitude}`;

// is_harvesting is a speed heuristic in the existing tracker, not a PTO sensor.
// Independent, nearby passes are required before a segment contributes area.
function measureGpsDay(rows, { headWidth = 3, excludedEdges = [], vehicleId, workDate } = {}) {
  if (!Number.isFinite(headWidth) || headWidth < 1 || headWidth > 15) throw new Error('Invalid head width');
  const points = rows.map(p => ({ ...p, lat: Number(p.latitude), lng: Number(p.longitude), at: Date.parse(p.created_at) }))
    .filter(p => p.latitude != null && p.longitude != null && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 85 && Math.abs(p.lng) <= 180 && Number.isFinite(p.at))
    .sort((a,b) => a.at-b.at || Number(a.id)-Number(b.id))
    .filter((p,i,a) => !i || p.at !== a[i-1].at || p.lat !== a[i-1].lat || p.lng !== a[i-1].lng);
  const excluded = new Set(excludedEdges);
  const empty = {version:VERSION,vehicle_id:vehicleId,work_date:workDate,head_width_m:headWidth,
    observed_at:points.at(-1)?.created_at || null,point_count:points.length,estimated_rai:0,
    completed_rai:0,working_rai:0,plots:[],accepted_edges:[],diagnostics:{gaps:0,invalid:rows.length-points.length,transit_edges:0}};
  if (points.length < 8) return {...empty,status:'insufficient'};
  const lat0=points[0].lat,lng0=points[0].lng,xScale=EARTH*rad*Math.cos(lat0*rad),yScale=EARTH*rad;
  for (const p of points) {p.x=(p.lng-lng0)*xScale;p.y=(p.lat-lat0)*yScale;}
  const segments=[];
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dt=(b.at-a.at)/1000,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),speed=length/dt*3.6;
    if(dt>90) empty.diagnostics.gaps++;
    const key=`${pointKey(a)}>${pointKey(b)}`;
    if(excluded.has(key) || dt<=0 || dt>90 || length<1.5 || length>200 || speed<.5 || speed>12) continue;
    segments.push({a,b,i,key,dt,length,speed,ux:dx/length,uy:dy/length,x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  }
  const radius=Math.max(18,headWidth*5),grid=new Map();
  const cell=(x,y)=>`${Math.floor(x/radius)},${Math.floor(y/radius)}`;
  for(const s of segments) {
    // Sample long, sparsely reported passes so their midpoints do not hide neighbours.
    const count=Math.max(1,Math.ceil(s.length/8));
    s.samples=[];
    for(let j=0;j<count;j++) {
      const t=(j+.5)/count,sample={x:s.a.x+(s.b.x-s.a.x)*t,y:s.a.y+(s.b.y-s.a.y)*t,s};
      s.samples.push(sample); const k=cell(sample.x,sample.y);
      if(!grid.has(k)) grid.set(k,[]);grid.get(k).push(sample);
    }
  }
  const dense=segments.filter(s=>{
    let supported=0;
    for(const sample of s.samples) {
      const lanes=new Set(),gx=Math.floor(sample.x/radius),gy=Math.floor(sample.y/radius);
      for(let x=gx-1;x<=gx+1;x++) for(let y=gy-1;y<=gy+1;y++) for(const other of grid.get(`${x},${y}`)||[]) {
        const o=other.s;
        if(Math.abs(o.b.at-s.b.at)<45000 || Math.abs(s.ux*o.ux+s.uy*o.uy)<.82) continue;
        const dx=other.x-sample.x,dy=other.y-sample.y,lateral=dx*(-s.uy)+dy*s.ux;
        if(Math.hypot(dx,dy)>radius || Math.abs(lateral)<Math.max(1.8,headWidth*.6) || Math.abs(dx*s.ux+dy*s.uy)>12) continue;
        lanes.add(Math.round(lateral/Math.max(2.5,headWidth)));
      }
      const offsets=[...lanes];
      if(offsets.length>=2 && Math.max(0,...offsets)-Math.min(0,...offsets)>=2) supported++;
    }
    return supported/Math.max(1,s.samples.length)>=.4;
  });
  empty.diagnostics.transit_edges=segments.length-dense.length;
  if(dense.length<6) return {...empty,status:'observing'};

  // Spatial components require support from real work passes. Time gaps never form lines.
  const parents=dense.map((_,i)=>i),find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  const join=(a,b)=>{a=find(a);b=find(b);if(a!==b) parents[b]=a;};
  const mergeRadius=Math.max(10,headWidth*3),cells=new Map();
  dense.forEach((s,i)=>{
    for(const p of s.samples) {
      const gx=Math.floor(p.x/mergeRadius),gy=Math.floor(p.y/mergeRadius);
      for(let x=gx-1;x<=gx+1;x++) for(let y=gy-1;y<=gy+1;y++) for(const other of cells.get(`${x},${y}`)||[]) {
        if(Math.hypot(p.x-other.x,p.y-other.y)<=mergeRadius) join(i,other.i);
      }
      const k=`${gx},${gy}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push({...p,i});
    }
  });
  const groups=new Map();dense.forEach((s,i)=>{const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(s);});
  const plots=[], measuredGeometries=[];
  for(const work of groups.values()) {
    if(work.length<6 || work.reduce((n,s)=>n+s.dt,0)<240) continue;
    // One continuous pass is one line, rather than hundreds of tiny buffers to union.
    // Every original point is retained; gaps and excluded edges always start a new line.
    const lines=[];let previous=null;
    for(const s of work) {
      if(previous && previous.i+1===s.i && previous.b.at===s.a.at) lines.at(-1).push([s.b.lng,s.b.lat]);
      else lines.push([[s.a.lng,s.a.lat],[s.b.lng,s.b.lat]]);
      previous=s;
    }
    const shape=turf.buffer(turf.multiLineString(lines),headWidth/2,{units:'meters',steps:4});
    if(!shape) continue;
    // Close only sub-header GPS cracks; retain substantial unworked holes.
    const expanded=turf.buffer(shape,headWidth*.75,{units:'meters',steps:4});
    const closed=expanded && turf.buffer(expanded,-headWidth*.75,{units:'meters',steps:4}) || shape;
    // A lone entrance/exit track must not add a header-width tail to the field.
    const interior=turf.buffer(closed,-headWidth,{units:'meters',steps:4});
    const coverage=interior && turf.buffer(interior,headWidth,{units:'meters',steps:4});
    if(!coverage) continue;
    const polygons=coverage.geometry.type==='Polygon'?[coverage.geometry.coordinates]:coverage.geometry.coordinates;
    const features=polygons.map(p=>turf.polygon(p)).filter(p=>turf.area(p)>=Math.max(180,headWidth*50));
    if(!features.length) continue;
    const geometry=features.length===1?features[0]:turf.multiPolygon(features.map(p=>p.geometry.coordinates));
    const sqm=turf.area(geometry);
    const xs=work.flatMap(s=>[s.a.x,s.b.x]),ys=work.flatMap(s=>[s.a.y,s.b.y]);
    const cx=xs.reduce((n,x)=>n+x,0)/xs.length,cy=ys.reduce((n,y)=>n+y,0)/ys.length;
    let xx=0,yy=0,xy=0;
    for(let i=0;i<xs.length;i++){xx+=(xs[i]-cx)**2;yy+=(ys[i]-cy)**2;xy+=(xs[i]-cx)*(ys[i]-cy);}
    const theta=.5*Math.atan2(2*xy,xx-yy);
    const along=xs.map((x,i)=>(x-cx)*Math.cos(theta)+(ys[i]-cy)*Math.sin(theta));
    const major=Math.max(...along)-Math.min(...along),effectiveWidth=sqm/Math.max(1,major);
    if(sqm<400 || effectiveWidth<Math.max(12,headWidth*3)) continue;
    // Length alone must never invalidate real swaths in a long, narrow field.
    // Check physical interior width instead: a bent three-pass road can have a
    // deceptively wide bounding box, but has no substantial work-area interior.
    // This is evidence only; do not shave the measured field's edges or area.
    const core=turf.buffer(geometry,-Math.max(6,headWidth*1.5),{units:'meters',steps:4});
    if(!core || turf.area(core)<Math.min(100,sqm*.1)) continue;
    const first=work.reduce((a,b)=>a.a.at<b.a.at?a:b),last=work.reduce((a,b)=>a.b.at>b.b.at?a:b);
    const exitMask=turf.buffer(geometry,60,{units:'meters',steps:4});
    const following=points.filter(p=>p.at>last.b.at);
    let awayStart=null,awayPrevious=null,awayCount=0,closedAt=null;
    for(const p of following) {
      if(turf.booleanPointInPolygon([p.lng,p.lat],exitMask)) {awayStart=null;awayPrevious=null;awayCount=0;closedAt=null;continue;}
      if(awayPrevious && p.at-awayPrevious>90000){awayStart=null;awayCount=0;closedAt=null;}
      if(awayStart===null)awayStart=p.at;
      awayPrevious=p.at;awayCount++;
      if(awayCount>=4 && p.at-awayStart>=300000) {closedAt=p.created_at;break;}
    }
    const recent=points.at(-1).at-last.b.at<180000;
    const state=closedAt?'completed':recent?'working':'waiting';
    const rawId=`GPS-${vehicleId}-${workDate}-${pointKey(first.a)}`;
    let displayGeometry=turf.simplify(geometry,{tolerance:.000004,highQuality:true,mutate:false});
    if(Math.abs(turf.area(displayGeometry)-sqm)>sqm*.01)displayGeometry=geometry;
    plots.push({id:rawId,state,estimated_rai:sqm/1600,area_sqm:sqm,geometry:displayGeometry,
      started_at:first.a.created_at,last_work_at:last.b.created_at,closed_at:closedAt,
      work_minutes:work.reduce((n,s)=>n+s.dt,0)/60,edge_keys:work.map(s=>s.key),
      reason:state==='completed'?'left_area':state==='waiting'?'await_exit_evidence':'harvesting'});
    measuredGeometries.push(geometry);
  }
  plots.sort((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at));
  // Union across components prevents double area when the vehicle revisits a patch.
  const union=measuredGeometries.length>1?turf.union(turf.featureCollection(measuredGeometries)):measuredGeometries[0];
  const estimated=union?turf.area(union)/1600:0;
  return {...empty,status:plots.length?'measuring':'observing',plots,estimated_rai:estimated,
    completed_rai:plots.filter(p=>p.state==='completed').reduce((n,p)=>n+p.estimated_rai,0),
    working_rai:plots.filter(p=>p.state!=='completed').reduce((n,p)=>n+p.estimated_rai,0),
    accepted_edges:plots.flatMap(p=>p.edge_keys)};
}

function analyzeGpsDay(rows, options = {}) {
  const measured = measureGpsDay(rows, options);
  const fresh = new Map();
  // Old swaths must not turn a return/exit track into new harvesting. Require
  // independent post-lock passes outside the locked boundary's header-width band.
  const hasFreshWork = (candidate, locks, through) => {
    const cutoff = Math.max(...locks.map(p => Date.parse(p.locked_at)));
    const end = Date.parse(through || measured.observed_at);
    if (!Number.isFinite(cutoff) || !Number.isFinite(end) || end <= cutoff) return false;
    const key = `${cutoff}/${end}`;
    if (!fresh.has(key)) {
      const recent = rows.filter(p => Date.parse(p.created_at) > cutoff && Date.parse(p.created_at) <= end);
      fresh.set(key, measureGpsDay(recent, options).plots);
    }
    const shapes = locks.map(p => p.geometry);
    const coverage = shapes.length > 1 ? turf.union(turf.featureCollection(shapes.map(p => turf.truncate(p,{precision:7,coordinates:2})))) : shapes[0];
    const band = turf.buffer(coverage, Math.max(3, options.headWidth || 3), {units:'meters',steps:4});
    let evidence = 0;
    for (const plot of fresh.get(key)) {
      const outside = turf.difference(turf.featureCollection([plot.geometry, band]));
      if (!outside) continue;
      const overlap = turf.intersect(turf.featureCollection([outside, candidate.geometry]));
      if (overlap) evidence += turf.area(overlap);
    }
    // A few boundary slivers cannot reopen a completed field. This is evidence
    // only; it does not trim real new area or alter the original locked receipt.
    return evidence >= 100;
  };
  return finalizePlotLocks(measured, options.previous, options.routeRevision || 0,
    {hasFreshWork, publishedParts:options.publishedParts});
}
module.exports={analyzeGpsDay,VERSION};
