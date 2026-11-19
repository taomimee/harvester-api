// Choose grab handles on the original ring. Never replace the measured vertices.
const openLength = points => points.length > 1 && points[0].lat === points.at(-1).lat &&
  points[0].lng === points.at(-1).lng ? points.length - 1 : points.length;

export function boundaryHandles(points, detailed = false) {
  const count = openLength(points);
  if (detailed || count <= 8) return Array.from({length: count}, (_, i) => i);
  const scale = Math.cos(points[0].lat * Math.PI / 180);
  const xy = points.slice(0, count).map(p => [p.lng * scale, p.lat]);
  const distance2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const farthest = i => xy.reduce((best, p, j) =>
    distance2(xy[i], p) > distance2(xy[i], xy[best]) ? j : best, i);
  const first = farthest(0);
  const second = farthest(first);
  if (first === second) return [0];
  const handles = [first, second].sort((a, b) => a - b);
  while (handles.length < 8) {
    let next = -1, largest = -1;
    for (let h = 0; h < handles.length; h++) {
      const from = handles[h], to = handles[(h + 1) % handles.length];
      const a = xy[from], b = xy[to], length2 = distance2(a, b);
      for (let i = (from + 1) % count; i !== to; i = (i + 1) % count) {
        const p = xy[i];
        const t = length2 ? Math.max(0, Math.min(1,
          ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length2)) : 0;
        const error = distance2(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        if (error > largest) { largest = error; next = i; }
      }
    }
    // About one metre of deviation. Straight sides do not need extra handles.
    if (next < 0 || (handles.length >= 3 && largest < (1 / 111320) ** 2)) break;
    handles.push(next);
    handles.sort((a, b) => a - b);
  }
  return handles;
}

// Taper a corner move along each edge until the next visible, stationary handle.
export function moveBoundaryHandle(points, handles, index, destination) {
  const count = openLength(points);
  const anchor = points[index];
  const scale = Math.cos(anchor.lat * Math.PI / 180);
  const deltaLat = destination.lat - anchor.lat, deltaLng = destination.lng - anchor.lng;
  const next = points.slice();
  const anchors = new Set(handles);
  if (!anchors.has(index) || handles.length < 2) return points;
  for (const step of [-1, 1]) {
    let i = index, distance = 0;
    const hidden = [];
    do {
      const j = (i + count + step) % count;
      distance += Math.hypot(points[j].lat - points[i].lat, (points[j].lng - points[i].lng) * scale);
      i = j;
      if (!anchors.has(i)) hidden.push([i, distance]);
    } while (!anchors.has(i));
    for (const [j, travelled] of hidden) {
      const weight = distance ? 1 - travelled / distance : 0;
      next[j] = {...points[j], lat: points[j].lat + weight * deltaLat, lng: points[j].lng + weight * deltaLng};
    }
  }
  next[index] = {...anchor, lat:destination.lat, lng:destination.lng};
  if (count < points.length) next[count] = {...next[0]};
  return next;
}
