const test = require('node:test');
const assert = require('node:assert/strict');
const formatter = import('../harvester-app/src/thai-area.mjs');

test('area display converts decimal rai to four ngan per rai', async () => {
  const { formatRaiNgan } = await formatter;
  for (const [value, expected] of [
    [24.67, '24 ไร่ 2.68 งาน'], [14.25, '14 ไร่ 1 งาน'],
    [4.54, '4 ไร่ 2.16 งาน'], [0.25, '0 ไร่ 1 งาน'],
    [0.5, '0 ไร่ 2 งาน'], [0.75, '0 ไร่ 3 งาน'],
    [1, '1 ไร่ 0 งาน'], [0, '0 ไร่ 0 งาน'],
    ['24.67', '24 ไร่ 2.68 งาน'], [1234.5, '1,234 ไร่ 2 งาน'],
  ]) assert.equal(formatRaiNgan(value), expected);
});

test('display rounding carries into rai and never produces four ngan', async () => {
  const { formatRaiNgan, splitThaiArea } = await formatter;
  assert.equal(formatRaiNgan(0.9999), '1 ไร่ 0 งาน');
  assert.equal(formatRaiNgan(24.9999), '25 ไร่ 0 งาน');
  assert.equal(formatRaiNgan(1.00125), '1 ไร่ 0.01 งาน');
  for (let i = 0; i < 10000; i++) {
    const value = i / 1337;
    const { rai, ngan } = splitThaiArea(value);
    assert.ok(ngan >= 0 && ngan < 4);
    assert.ok(Math.abs(rai + ngan / 4 - value) <= 0.001250000001);
  }
});

test('invalid and missing area values do not display NaN or Infinity', async () => {
  const { formatRaiNgan } = await formatter;
  for (const value of [null, undefined, '', NaN, Infinity, -1, 'bad']) {
    assert.equal(formatRaiNgan(value), '0 ไร่ 0 งาน');
  }
});

test('GPS rounds every fractional ngan upward, with four ngan carried into rai', async () => {
  const { formatGpsRaiNgan } = await formatter;
  for (const [value, expected] of [
    [8 + 1.46 / 4, '8 ไร่ 2 งาน'], [2 + 0.31 / 4, '2 ไร่ 1 งาน'],
    [8 + 3.01 / 4, '9 ไร่ 0 งาน'], [8.25, '8 ไร่ 1 งาน'],
    [24.67, '24 ไร่ 3 งาน'], [0.000001, '0 ไร่ 1 งาน'],
    [0, '0 ไร่ 0 งาน'], ['8.365', '8 ไร่ 2 งาน'],
    [8.250000000000002, '8 ไร่ 1 งาน'],
  ]) assert.equal(formatGpsRaiNgan(value), expected);
});

test('whole GPS display never rounds down or changes the precise accounting display', async () => {
  const { formatGpsRaiNgan, splitGpsThaiArea, formatRaiNgan } = await formatter;
  for (let i = 0; i < 10000; i++) {
    const value = i / 1337;
    const { rai, ngan } = splitGpsThaiArea(value);
    const displayed = rai + ngan / 4;
    assert.ok(Number.isInteger(rai) && Number.isInteger(ngan));
    assert.ok(ngan >= 0 && ngan < 4);
    assert.ok(displayed + 1e-12 >= value && displayed - value < 0.25);
  }
  assert.equal(formatGpsRaiNgan(8.365), '8 ไร่ 2 งาน');
  assert.equal(formatRaiNgan(8.365), '8 ไร่ 1.46 งาน');
  for (const value of [null, undefined, '', NaN, Infinity, -1, 'bad']) {
    assert.equal(formatGpsRaiNgan(value), '0 ไร่ 0 งาน');
  }
});
