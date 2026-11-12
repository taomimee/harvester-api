// Keep exact segments, but batch each visual style into one noninteractive layer.
// Separate arrays retain gaps; no simplification changes measurement or editing.
const pointKey=p=>p?.id!=null?String(p.id):`${p?.created_at}|${p?.latitude}|${p?.longitude}`;
export function gpsRouteLines(rows,{excluded=new Set(),selected=new Set(),showExcluded=false,editing=false,restore=false,harvesting=()=>false}={}) {
  const groups=new Map();
  for(let i=1;i<rows.length;i++) {
    const a=rows[i-1],b=rows[i],key=`${pointKey(a)}>${pointKey(b)}`,removed=excluded.has(key),chosen=selected.has(key);
    if(removed&&!editing&&!showExcluded)continue;
    if([a,b].some(p=>p.latitude==null||p.longitude==null||p.latitude===''||p.longitude===''))continue;
    const points=[[Number(a.latitude),Number(a.longitude)],[Number(b.latitude),Number(b.longitude)]];
    const gap=(Date.parse(b.created_at)-Date.parse(a.created_at))/1000;
    if(!points.flat().every(Number.isFinite)||gap<=0||gap>180)continue;
    const harvest=harvesting(a,b),style=chosen?(restore?'restore':'selected'):removed?'excluded':harvest?'harvest':'transit';
    if(!groups.has(style))groups.set(style,{style,lines:[],color:chosen?(restore?'#22C55E':'#F97316'):removed?'#94A3B8':harvest?'#2563EB':'#D946EF',weight:chosen?9:harvest?4:2,opacity:chosen?1:removed?.45:.8,dashArray:removed&&!chosen?'5 7':undefined});
    groups.get(style).lines.push(points);
  }
  return [...groups.values()];
}
