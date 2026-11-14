'use strict';
const identity = import('../harvester-app/src/gps-field-identity.mjs');

// Read-only metadata for queue/trip counts. Never rewrite receipts, geometry,
// ownership or payments. Share the short cache across these presentation APIs.
function createGpsFieldIdentityReader(db, {now = () => Date.now()} = {}) {
  const cache = new Map(), pending = new Map();
  return async (vehicle, day, plots = []) => {
    const sources = new Set(plots.filter(p => String(p.auto_origin?.vehicle_id) === String(vehicle) && p.auto_origin?.work_date === day).map(p => p.auto_origin.plot_id));
    if (sources.size < 2) return {};
    const key = `${vehicle}/${day}`, old = cache.get(key);
    if (old && now() - old.at < 60000) return old.aliases;
    if (pending.has(key)) return pending.get(key);
    const promise = (async () => {
      const {data, error} = await db.from('gps_area_daily').select('result').eq('vehicle_id', Number(vehicle)).eq('work_date', day).maybeSingle();
      if (error) throw error;
      const result = data?.result;
      const aliases = result && String(result.vehicle_id) === String(vehicle) && result.work_date === day
        ? (await identity).gpsFieldAliases(result.plots) : {};
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(key, {at: now(), aliases});
      return aliases;
    })().finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}
module.exports = {createGpsFieldIdentityReader};
