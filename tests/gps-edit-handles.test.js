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
