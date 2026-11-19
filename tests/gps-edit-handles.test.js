const {test} = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../harvester-app/src/gps-edit-handles.mjs');

// A rectangular field with many GPS fixes along its straight edges.
function field() {
  const corners = [[0,0], [0,1], [1,1], [1,0]];
  return corners.flatMap(([y,x], side) => {
    const [ny,nx] = corners[(side+1)%4];
    return Array.from({length:25}, (_, i) => ({
      lat:15 + (y + (ny-y)*i/25)/1000,
      lng:101 + (x + (nx-x)*i/25)/1000
    }));
  });
}

test('opening and switching handles on a dense field preserves every fix', async () => {
  const {boundaryHandles} = await helpers;
  const points = field(), original = structuredClone(points);
  assert.deepEqual(boundaryHandles(points), [0,25,50,75]);
  assert.equal(boundaryHandles(points, true).length, 100);
  assert.deepEqual(points, original);
});

test('coarse drag tapers along both edges, preserves other corners and ring closure', async () => {
  const {boundaryHandles, moveBoundaryHandle} = await helpers;
  const points = field();
  points.push({...points[0]});
  const handles = boundaryHandles(points);
  const moved = moveBoundaryHandle(points, handles, 0, {lat:15.0001,lng:101});
  assert.equal(moved.length, 101);
  assert.deepEqual(moved[0], moved.at(-1));
  assert.ok(moved[1].lat > moved[10].lat);
  assert.ok(moved[99].lat > points[99].lat);
  for (const i of [25,50,75]) assert.deepEqual(moved[i], points[i]);
  assert.equal(points[0].lat, 15);
});

test('fine drag moves only its vertex and simple fields keep their corners', async () => {
  const {boundaryHandles, moveBoundaryHandle} = await helpers;
  const points = field(), handles = boundaryHandles(points, true);
  const moved = moveBoundaryHandle(points, handles, 30, {lat:15.001,lng:101.001});
  assert.deepEqual(moved.filter((p,i) => p !== points[i]), [moved[30]]);
  const triangle = [points[0],points[25],points[50]];
  assert.deepEqual(boundaryHandles(triangle), [0,1,2]);
});

test('detailed editing spaces visible controls, prioritizes the selected point and reveals more on zoom', async () => {
  const {boundaryControls} = await helpers;
  const ring = field();
  const pixels = ring.map(p => ({x:(p.lng - 101)*200000, y:(p.lat - 15)*200000}));
  const small = boundaryControls(ring, pixels, 1);
  assert.ok(small.corners.some(c => c.index === 1));
  assert.ok(small.corners.length < 12);
  const zoom = boundaryControls(ring, pixels.map(p => ({x:p.x*8,y:p.y*8})), 1);
  assert.ok(zoom.corners.length > small.corners.length);
  assert.ok(zoom.corners.filter(c => c.number).length <= 8);
  assert.ok(zoom.additions.length > 0);
  for (const layout of [small,zoom]) assert.equal(new Set(layout.corners.map(c => c.index)).size,layout.corners.length);
});

test('inserting on the closing edge preserves area, dragging outward or inward changes it, and deleting restores it', async () => {
  const {boundaryControls, boundaryPointBetween, boundaryPointCount, removeBoundaryPoint, nearestBoundaryEdge, moveBoundaryHandle} = await helpers;
  const {savedPlotGeometry} = await import('../harvester-app/src/gps-map-compute.mjs');
  const corners = [0,25,50,75].map(i => field()[i]);
  const ring = [...corners, {...corners[0]}];
  const pixels = [{x:0,y:0},{x:300,y:0},{x:300,y:300},{x:0,y:300}];
  const {after,t} = nearestBoundaryEdge(pixels, {x:-1,y:150});
  assert.equal(after,3);
  assert.equal(t,.5);
  assert.ok(boundaryControls(ring,pixels).additions.some(a => a.after === after));
  const point = boundaryPointBetween(ring,after,t);
  const added = [...corners, point, ring.at(-1)];
  const area = points => savedPlotGeometry({points}).netSqM;
  assert.ok(Math.abs(area(added) - area(ring)) < .0001);
  const edit = delta => moveBoundaryHandle(added, [0,1,2,3,4], 4, {...point,lng:point.lng+delta});
  assert.ok(area(edit(-.0001)) > area(ring));
  assert.ok(area(edit(.0001)) < area(ring));
  assert.deepEqual(removeBoundaryPoint(added,4),ring);
  const triangle = removeBoundaryPoint(ring,0);
  assert.deepEqual(triangle[0],triangle.at(-1));
  assert.equal(boundaryPointCount(triangle),3);
  assert.equal(removeBoundaryPoint(triangle,0),triangle);
});
