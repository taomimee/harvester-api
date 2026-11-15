import { gpsAreaMatches } from './gps-projection-state.mjs';

export const thaiWorkDate = (now = Date.now()) => new Date(now + 7 * 3600000).toISOString().slice(0, 10);

// Read the same published snapshot and edited boundaries as the map. No raw
// tracker download or route calculation is needed for the home card.
export async function loadHomeVehicle({fetcher, base, vehicle, date, signal, project, previous}) {
  const url = `${base}/gps-area/${vehicle}?date=${date}`;
  const options = {signal, cache:'no-store'};
  let response = await fetcher(`${url}&snapshot=1`, options);
  if (response.status === 204) response = await fetcher(url, options);
  if (!response.ok) throw new Error('GPS_UNAVAILABLE');
  const data = await response.json();
  if (!gpsAreaMatches(data, vehicle, date)) throw new Error('GPS_SCOPE_MISMATCH');
  if (!data.enabled) return {vehicle, date, state:'disabled'};
  const savedResponse = await fetcher(`${base}/plots-snapshot/${vehicle}?date=${date}`, options);
  if (!savedResponse.ok) throw new Error('GPS_PLOTS_UNAVAILABLE');
  const saved = await savedResponse.json();
  if (!Array.isArray(saved.plots_data) || !Number.isInteger(saved.revision)
      || (data.editable_ready && saved.revision < data.editable_revision)) throw new Error('GPS_PLOTS_PENDING');
  const key = `${vehicle}/${date}/${data.snapshot_revision}/${saved.revision}/${data.observed_at}`;
  if (previous?.key === key) return {...previous, stale:false};
  const result = await project({saved:saved.plots_data, data, vehicle, date, revision:saved.revision});
  const rai = result.plots.reduce((sum, plot) => sum + plot.areaRai, 0);
  if (!Number.isFinite(rai) || rai < 0) throw new Error('GPS_AREA_INVALID');
  return {vehicle, date, key, state:result.plots.length ? 'ready' : data.status === 'no_data' ? 'empty' : 'observing', rai,
    count:result.plots.length, working:result.plots.some(p => p.growing), observedAt:data.observed_at};
}

// Recorded work and GPS describe overlapping work, so never add them together.
export function homeHarvestSummary(vehicles, rows, date, recordedRai = 0) {
  const ids = [...new Set(vehicles.map(v => String(v.id)))];
  const current = ids.map(id => rows[id]?.date === date ? rows[id] : null);
  const ready = current.filter(row => row?.state === 'ready');
  const pending = current.filter(row => !row || ['error','observing'].includes(row.state) || row.stale).length;
  const recorded = Math.max(0, Number(recordedRai) || 0);
  return {source:ready.length ? 'gps' : recorded > 0 || (ids.length && !pending) ? 'recorded' : 'pending',
    rai:ready.length ? ready.reduce((sum, row) => sum + row.rai, 0) : recorded,
    count:ready.reduce((sum, row) => sum + row.count, 0), working:ready.some(row => row.working),
    pending, recorded, observedAt:ready.map(row => row.observedAt).filter(Boolean).sort().at(-1)};
}
