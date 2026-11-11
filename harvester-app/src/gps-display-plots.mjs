import { area, difference, featureCollection, truncate, union } from '@turf/turf';

const merge = shapes => shapes.length > 1
  ? union(featureCollection(shapes.map(s => truncate(s, { precision: 7, coordinates: 2 }))))
  : shapes[0] || null;
const subtract = (shape, covered) => shape && covered
  ? difference(featureCollection([shape, covered].map(s => truncate(s, { precision: 7, coordinates: 2 }))))
  : shape;

// A previous partial lock does not mean continued work is finished. Missing
// GPS status and manually saved boundaries must not look automatically locked.
export function gpsPlotStatus(group) {
  if (group.growing) return { key: 'measuring', label: '⏳ กำลังวัด' };
  const lockedAt = group.autoPlot?.locked_at;
  if (group.autoPlot?.state === 'completed' && Number.isFinite(Date.parse(lockedAt))) {
    return { key: 'locked', label: '🔒 ล็อกแล้ว', lockedAt };
  }
  return group.sourceId ? { key: 'checking', label: 'รอสถานะ GPS' }
    : { key: 'saved', label: 'บันทึกขอบแล้ว' };
}

// Lock receipts are storage parts, not separate fields. Combine their display
// by the existing field identity; never infer ownership from a shared border.
// This projection does not change saved boundaries, IDs, links, or accounting.
export function gpsDisplayPlots(saved, geometries, data, vehicle, date, revision) {
  const current = data?.enabled && String(data.vehicle_id) === String(vehicle) && data.work_date === date ? data : null;
  const ready = current?.editable_ready && Number.isInteger(revision) && revision >= current.editable_revision;
  const groups = new Map();
  saved.forEach((plot, index) => {
    const origin = plot.auto_origin;
    const sourceId = origin?.plot_id && String(origin.vehicle_id) === String(vehicle) && origin.work_date === date ? origin.plot_id : null;
    const key = sourceId ? `auto:${sourceId}` : `saved:${plot.id}`;
    if (!groups.has(key)) groups.set(key, { key, id: plot.id, sourceId, name: plot.name, indices: [], shapes: [] });
    const group = groups.get(key);
    group.indices.push(index);
    if (geometries[index]?.net) group.shapes.push(geometries[index].net);
  });
  for (const group of groups.values()) {
    group.geometry = merge(group.shapes);
    group.savedRai = group.geometry ? area(group.geometry) / 1600 : 0;
  }
  const savedCoverage = merge([...groups.values()].map(g => g.geometry).filter(Boolean));
  for (const plot of current?.plots || []) {
    const key = `auto:${plot.id}`;
    let group = groups.get(key);
    const knownReceipts = new Set((group?.indices || []).map(i => saved[i].auto_origin?.receipt_id));
    // Remove original locked coverage before adding work in progress. This
    // preserves edited holes/edges and never brings a deleted receipt back.
    const receipts = (current.locked_plots || []).filter(p => p.plot_id === plot.id && (ready || knownReceipts.has(p.id)));
    let extra = ready && plot.state === 'completed' ? null : subtract(plot.geometry, merge(receipts.map(p => p.geometry)));
    extra = subtract(extra, savedCoverage);
    if (extra && area(extra) < 1) extra = null;
    if (!group && !extra) continue;
    if (!group) {
      group = { key, id: key, sourceId: plot.id, indices: [], shapes: [], savedRai: 0 };
      groups.set(key, group);
    }
    group.autoPlot = plot;
    group.growing = plot.state !== 'completed';
    if (!group.name || /^แปลงออโต้ \d+( · ส่วน \d+)?$/.test(group.name)) group.name = `แปลงที่ ${plot.number}`;
    group.geometry = merge([group.geometry, extra].filter(Boolean));
  }
  return [...groups.values()].map(group => {
    // Flatten outer rings only for camera fitting, not for area calculations.
    const geometry = group.geometry?.geometry;
    const rings = geometry?.type === 'Polygon' ? [geometry.coordinates[0]]
      : geometry?.type === 'MultiPolygon' ? geometry.coordinates.map(p => p[0]) : [];
    return { ...group, areaRai: group.geometry ? area(group.geometry) / 1600 : 0,
      points: rings.flat().map(([lng, lat]) => ({ lng, lat })) };
  });
}
