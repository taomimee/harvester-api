export function logicalFieldKey(plot) {
  if(plot.group_id || plot.group_key)return plot.group_id || plot.group_key;
  const scope=`${plot.vehicle_id}/${plot.work_date}`;
  const origin=plot.auto_origin;
  if(origin?.plot_id && String(origin.vehicle_id)===String(plot.vehicle_id) && origin.work_date===plot.work_date)return `${scope}/auto:${origin.plot_id}`;
  // Older job responses did not expose origin metadata. Only our own durable
  // GPS receipt IDs identify a group; names or nearby positions never do.
  const receipt=String(plot.id || '').match(/^auto-(GPS-\d+-\d{4}-\d{2}-\d{2}-\d+)@/);
  return receipt?`${scope}/auto:${receipt[1]}`:`${scope}/${plot.id}`;
}
export function groupJobPlots(plots=[]) {
  const grouped=new Map();
  for(const plot of plots) {
    const key=logicalFieldKey(plot);
    if(!grouped.has(key))grouped.set(key,{...plot,group_id:key,name:String(plot.name || 'แปลง').replace(/\s*·\s*ส่วน\s*\d+$/,''),area_rai:0,members:[],polygons:[]});
    const group=grouped.get(key);group.members.push(plot);group.area_rai+=Number(plot.area_rai)||0;
    const g=plot.preview_geometry;
    if(g?.type==='Polygon')group.polygons.push(g.coordinates);
    else if(g?.type==='MultiPolygon')group.polygons.push(...g.coordinates);
  }
  return [...grouped.values()].map(({polygons,...group})=>({...group,preview_geometry:polygons.length?{type:'MultiPolygon',coordinates:polygons}:null}));
}
export function fieldPaymentStatus(group,paidKeys,fullyPaid=false) {
  const members=group.members || [group];
  const count=members.filter(p=>fullyPaid || paidKeys.has(`${p.vehicle_id}/${p.work_date}/${p.id}`)).length;
  return count===members.length?'paid':count>0?'partial':'unpaid';
}
