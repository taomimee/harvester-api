// Choose grab handles on the original ring. Never replace the measured vertices.
export const boundaryPointCount = points => points.length > 1 && points[0].lat === points.at(-1).lat &&
  points[0].lng === points.at(-1).lng ? points.length - 1 : points.length;

export function boundaryHandles(points, detailed = false) {
  const count = boundaryPointCount(points);
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
  const count = boundaryPointCount(points);
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

// Lay out tap targets in screen pixels. The underlying ring retains all GPS fixes.
export function boundaryControls(points, pixels, selected = -1) {
  const count = boundaryPointCount(points);
  const main = boundaryHandles(points);
  const corners = [], additions = [];
  const grid = new Map();
  const key = (x, y) => x + ',' + y;
  const fits = (p, gap) => {
    const x = Math.floor(p.x / 96), y = Math.floor(p.y / 96);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (grid.get(key(x + dx, y + dy))?.some(q => Math.hypot(q.x - p.x, q.y - p.y) < gap)) return false;
    }
    return true;
  };
  const occupy = p => {
    const cell = key(Math.floor(p.x / 96), Math.floor(p.y / 96));
    if (!grid.has(cell)) grid.set(cell, []);
    grid.get(cell).push(p);
  };
  const candidates = new Set([selected, ...main, ...Array.from({length:count}, (_, i) => i)]);
  for (const i of candidates) {
    if (i < 0 || i >= count) continue;
    const number = main.indexOf(i) + 1;
    if (!fits(pixels[i], number ? 52 : 96)) continue;
    occupy(pixels[i]);
    corners.push({index:i, number});
  }
  corners.sort((a, b) => a.index - b.index);
  for (let c = 0; c < corners.length && corners.length > 1; c++) {
    const from = corners[c].index, to = corners[(c + 1) % corners.length].index;
    const edges = [];
    let total = 0;
    for (let i = from; i !== to; i = (i + 1) % count) {
      const a = pixels[i], b = pixels[(i + 1) % count];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length) edges.push({i, length, start:total});
      total += length;
    }
    const edge = edges.find(e => e.start + e.length >= total / 2);
    if (!edge) continue;
    const fraction = (total / 2 - edge.start) / edge.length;
    const t = fraction < .1 || fraction > .9 ? .5 : fraction;
    const a = pixels[edge.i], b = pixels[(edge.i + 1) % count];
    const p = {x:a.x + (b.x - a.x) * t, y:a.y + (b.y - a.y) * t};
    if (!fits(p, 44)) continue;
    occupy(p);
    additions.push({after:edge.i, t});
  }
  return {corners, additions};
}

export function nearestBoundaryEdge(pixels, target) {
  let best = null;
  for (let i = 0; i < pixels.length; i++) {
    const a = pixels[i], b = pixels[(i + 1) % pixels.length];
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const t = Math.min(1, Math.max(0, ((target.x - a.x) * dx + (target.y - a.y) * dy) / length2));
    const distance = Math.hypot(target.x - a.x - t * dx, target.y - a.y - t * dy);
    if (!best || distance < best.distance) best = {after:i, t, distance};
  }
  return best;
}

export function boundaryPointBetween(points, after, t) {
  const a = points[after], b = points[(after + 1) % boundaryPointCount(points)];
  return {lat:a.lat + (b.lat - a.lat) * t, lng:a.lng + (b.lng - a.lng) * t};
}

export function removeBoundaryPoint(points, index) {
  const count = boundaryPointCount(points);
  if (count <= 3 || index < 0 || index >= count) return points;
  const result = points.slice(0, count);
  result.splice(index, 1);
  if (count < points.length) result.push({...result[0]});
  return result;
}
