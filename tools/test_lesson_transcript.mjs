import assert from 'node:assert/strict';
import { activeTurnIndex, createHeightIndex, windowRange } from '../js/lessons/transcript-view.js';

assert.equal(activeTurnIndex([], 0), -1);
const turns = [{ start: 2 }, { start: 5 }, { start: 5 }, { start: 9 }];
for (const [time, expected] of [[0, -1], [1.49, -1], [1.5, 0], [4.49, 0], [4.5, 2], [8.5, 3], [900, 3]]) {
  assert.equal(activeTurnIndex(turns, time), expected, `active sentence at ${time}`);
}
let reads = 0;
const long = Array.from({ length: 100000 }, (_, i) => ({ get start() { reads++; return i; } }));
assert.equal(activeTurnIndex(long, 54321), 54321);
assert(reads <= 18, 'playback lookup must be logarithmic');

const empty = createHeightIndex(0);
assert.equal(empty.indexAt(20), -1);
assert.equal(empty.offset(1), 0);
const heights = createHeightIndex(100, 100);
const expected = Array(100).fill(100);
for (let i = 0; i < expected.length; i++) {
  expected[i] = 35 + (i * 47) % 400;
  heights.set(i, expected[i]);
}
heights.set(2, NaN); heights.set(2, 0); heights.set(-1, 100); heights.set(100, 100);
let total = 0;
for (let i = 0; i < expected.length; i++) {
  assert.equal(heights.offset(i), total);
  assert.equal(heights.indexAt(total), i);
  assert.equal(heights.indexAt(total + expected[i] - 0.1), i);
  total += expected[i];
}
assert.equal(heights.offset(100), total);
assert.equal(heights.indexAt(-1), 0);
assert.equal(heights.indexAt(total + 10000), 99);
assert.equal(heights.offset(1000), total);
assert.equal(heights.offset(-1), 0);
for (const count of [0, 1, 20, 80, 100, 100000]) {
  for (const first of [0, 2, 45, count - 1]) {
    const range = windowRange(count, first, first + 12);
    assert(range.start >= 0);
    assert(range.end <= count);
    assert(range.end - range.start <= 80, 'mounted transcript rows stay bounded');
    if (first >= 0 && first < count) assert(range.start <= first && range.end > first, 'visible sentence is included');
  }
}
assert.deepEqual(windowRange(100000, 50000, 50010), { start: 49992, end: 50019 });
assert.deepEqual(windowRange(100000, 50000, 90000), { start: 49992, end: 50072 });
console.log('Lesson transcript helpers: passed (binary seek, measured height index, bounded window).');
