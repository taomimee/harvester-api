// A growing spatial component can absorb an earlier locked component while
// the append-only receipts retain both IDs. Exact work-edge containment is
// evidence of that continuation; proximity, names and road crossings are not.
export function gpsFieldAliases(plots = []) {
  const sets = plots.map(p => new Set(p.edge_keys || []));
  const parents = plots.map((_, i) => i);
  const find = i => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  for (let i = 0; i < plots.length; i++) for (let j = i + 1; j < plots.length; j++) {
    const [small, large] = sets[i].size <= sets[j].size ? [sets[i], sets[j]] : [sets[j], sets[i]];
    if (small.size >= 6 && [...small].every(edge => large.has(edge))) parents[find(j)] = find(i);
  }
  const groups = new Map();
  plots.forEach((p, i) => { const key = find(i); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p); });
  const aliases = {};
  for (const group of groups.values()) {
    const first = [...group].sort((a, b) => (a.number || Infinity) - (b.number || Infinity) || String(a.id).localeCompare(String(b.id)))[0];
    for (const p of group) aliases[p.id] = first.id;
  }
  return aliases;
}

export function gpsOriginFieldId(plot, aliases, vehicle, date) {
  const origin = plot?.auto_origin;
  if (!origin?.plot_id || String(origin.vehicle_id) !== String(vehicle) || origin.work_date !== date) return null;
  return aliases[origin.plot_id] || origin.plot_id;
}
