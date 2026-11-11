'use strict';
const turf = require('@turf/turf');
// Centimetre-scale snapping avoids near-coincident floating-point rings when a
// previously subtracted boundary is unioned again. It is far below GPS accuracy.
const snapped = shape => turf.truncate(shape, {precision:7,coordinates:2,mutate:false});
const merge = shapes => shapes.length > 1 ? turf.union(turf.featureCollection(shapes.map(snapped))) : shapes[0] || null;
const unique = values => [...new Set(values)];

// Locks are append-only measurement receipts inside the existing daily snapshot.
// Returning to a field can add uncovered area to its original number, never count it twice.
function finalizePlotLocks(measured, previous, routeRevision = 0, {hasFreshWork, publishedParts} = {}) {
  const sameScope = previous?.lock_version === 1 && previous.vehicle_id === measured.vehicle_id &&
    previous.work_date === measured.work_date && previous.head_width_m === measured.head_width_m &&
    previous.route_revision === routeRevision;
  const prior = sameScope ? previous : null;
  const locks = [];
  for (const p of (prior?.locked_plots || []).slice().sort((a,b) => Date.parse(a.locked_at)-Date.parse(b.locked_at))) {
    const earlier = locks.filter(lock => lock.plot_id === p.plot_id);
    const published = !Array.isArray(publishedParts) || publishedParts.some(id => id.startsWith(`auto-${p.id}-`));
    // Recheck legacy, unpublished extensions on rollout. Saved/edited/linked
    // field receipts remain authoritative and are never removed by this check.
    if (earlier.length && !published && p.return_evidence_version !== 1 && hasFreshWork && !hasFreshWork(p,earlier,p.locked_at)) continue;
    locks.push({...p});
  }
  const previousPlots = prior?.plots || [];
  let nextNumber = Math.max(0, ...previousPlots.map(p => p.number || 0)) + 1;
  let covered = merge(locks.map(p => p.geometry));
  const pending = [], identities = new Map(previousPlots.map(p => [p.id, p]));

  for (const plot of measured.plots) {
    const edgeSet = new Set(plot.edge_keys);
    const matches = previousPlots.map(p => ({plot:p, overlap:p.edge_keys.filter(e => edgeSet.has(e)).length}))
      .filter(p => p.overlap > 0).sort((a,b) => b.overlap-a.overlap);
    const previousPlot = matches[0]?.plot;
    const id = previousPlot?.id || plot.id;
    const identity = {...plot, id, number:previousPlot?.number || nextNumber++};
    identities.set(id, identity);
    const sameFieldLocks = locks.filter(p => p.plot_id === id);
    // No later harvesting: subsequent traffic/GPS support must not reshape a locked field.
    if (sameFieldLocks.length && Date.parse(plot.last_work_at) <= Math.max(...sameFieldLocks.map(p => Date.parse(p.last_work_at)))) continue;
    const remainder = covered ? turf.difference(turf.featureCollection([plot.geometry, covered].map(snapped))) : plot.geometry;
    if (!remainder) continue;
    const sqm = covered ? turf.area(remainder) : plot.area_sqm;
    // Ignore small buffer/simplification slivers on a repeated pass through a locked field.
    if (sameFieldLocks.length && sqm < 25) continue;
    const part = {...identity, geometry:remainder, area_sqm:sqm, estimated_rai:sqm/1600};
    if (sameFieldLocks.length && hasFreshWork && !hasFreshWork(part,sameFieldLocks,plot.closed_at || measured.observed_at)) continue;
    if (sameFieldLocks.length && hasFreshWork) part.return_evidence_version = 1;
    if (plot.state === 'completed' && plot.closed_at) {
      locks.push({...part, id:`${id}@${plot.closed_at}`, plot_id:id, locked_at:plot.closed_at});
    } else pending.push(part);
    covered = merge([covered, remainder].filter(Boolean));
  }

  const groups = new Map();
  for (const lock of locks) {
    if (!groups.has(lock.plot_id)) groups.set(lock.plot_id, {locks:[],pending:[]});
    groups.get(lock.plot_id).locks.push(lock);
  }
  for (const part of pending) {
    if (!groups.has(part.id)) groups.set(part.id, {locks:[],pending:[]});
    groups.get(part.id).pending.push(part);
  }
  const plots = [...groups.entries()].map(([id, group]) => {
    const all = [...group.locks, ...group.pending];
    const identity = identities.get(id) || all[0];
    const latest = [...all].sort((a,b) => Date.parse(b.last_work_at)-Date.parse(a.last_work_at))[0];
    const closedAt = group.locks.map(p => p.locked_at).sort().at(-1) || null;
    const lockedRai = group.locks.reduce((n,p) => n+p.estimated_rai,0);
    const activeRai = group.pending.reduce((n,p) => n+p.estimated_rai,0);
    const state = group.pending.length ? group.pending[0].state : 'completed';
    return {...identity, id, state, number:all[0].number,
      geometry:merge(all.map(p => p.geometry)), area_sqm:(lockedRai+activeRai)*1600,
      estimated_rai:lockedRai+activeRai, locked_rai:lockedRai, additional_rai:activeRai,
      started_at:all.map(p => p.started_at).sort()[0], last_work_at:latest.last_work_at,
      closed_at:state === 'completed' ? closedAt : null, locked_at:closedAt,
      edge_keys:unique([...all.flatMap(p => p.edge_keys), ...(group.pending.length ? identity.edge_keys || [] : [])]),
      reason:state === 'completed' ? 'locked_after_departure' : identity.reason};
  }).sort((a,b) => a.number-b.number);
  const completed = locks.reduce((n,p) => n+p.estimated_rai,0);
  const working = pending.reduce((n,p) => n+p.estimated_rai,0);
  return {...measured, lock_version:1, route_revision:routeRevision, locked_plots:locks, plots,
    lock_policy:{distance_m:60,away_seconds:300},
    status:plots.length ? (working > 0 ? 'measuring' : 'completed') : measured.status,
    estimated_rai:completed+working, completed_rai:completed, working_rai:working,
    locked_count:new Set(locks.map(p => p.plot_id)).size,
    accepted_edges:unique(plots.flatMap(p => p.edge_keys))};
}
module.exports = {finalizePlotLocks};
