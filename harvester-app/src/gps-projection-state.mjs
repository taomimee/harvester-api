// Saved lock receipts alone cannot identify fields absorbed by later work.
// Wait for the matching GPS result instead of briefly rendering the old parts.
export function gpsAreaMatches(data, vehicle, date) {
  return typeof data?.enabled === 'boolean' && String(data.vehicle_id) === String(vehicle)
    && data.work_date === date;
}

export function selectGpsProjection(snapshot, saved, data, vehicle, date, revision) {
  const scope = `${vehicle}/${date}`;
  if (gpsAreaMatches(data, vehicle, date) && Number.isInteger(revision)
      && snapshot?.scope === scope && snapshot.saved === saved) {
    return {...snapshot, pending: !snapshot.error && snapshot.source !== data};
  }
  return {plots: [], geometries: [], source: null, pending: Boolean(vehicle && date), error: ''};
}

// While the next projection runs, the map still shows the last complete one.
// Its header must keep those exact totals, never fall back to raw receipt counts.
export function gpsVisibleTotals(totals, data) {
  return data?.enabled && totals?.source?.enabled
    && gpsAreaMatches(totals.source, data.vehicle_id, data.work_date) ? totals : null;
}

// A delayed GET cannot undo an acknowledged manual command.
export function retainNewestGpsArea(previous, data, scope) {
  if (previous?.scope === scope && Number(previous.data?.snapshot_revision || 0) > Number(data?.snapshot_revision || 0)) return previous;
  if (previous?.scope === scope && JSON.stringify(previous.data) === JSON.stringify(data)) return previous;
  return {scope,data};
}
