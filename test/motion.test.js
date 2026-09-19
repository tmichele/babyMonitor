import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGrayscale, compareFrames } from '../js/detection/motion.js';

function rgbaFrame(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = typeof fill === 'function' ? fill(i) : fill;
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return data;
}

test('toGrayscale converte in luminanza', () => {
  const g = toGrayscale(rgbaFrame(2, 1, 200), 2, 1);
  assert.equal(g.length, 2);
  assert.ok(Math.abs(g[0] - 200) <= 1);
  const out = new Uint8ClampedArray(2);
  assert.equal(toGrayscale(rgbaFrame(2, 1, 10), 2, 1, out), out, 'riusa il buffer');
});

test('compareFrames: nessun cambiamento → 0, metà pixel → 50', () => {
  const w = 10; const h = 10;
  const a = toGrayscale(rgbaFrame(w, h, 100), w, h);
  const same = compareFrames(a, a, 28);
  assert.equal(same.score, 0);
  assert.equal(same.meanDelta, 0);
  const b = toGrayscale(rgbaFrame(w, h, (i) => (i < 50 ? 200 : 100)), w, h);
  const mask = new Uint8Array(w * h);
  const half = compareFrames(a, b, 28, mask);
  assert.equal(half.score, 50);
  assert.equal(half.changedFraction, 0.5);
  assert.ok(half.meanDelta > 90);
  assert.equal(mask[0], 1);
  assert.equal(mask[99], 0);
});

test('compareFrames ignora il rumore sotto pixelDelta', () => {
  const a = new Uint8ClampedArray([100, 100, 100, 100]);
  const b = new Uint8ClampedArray([110, 90, 105, 100]);
  assert.equal(compareFrames(a, b, 28).score, 0);
  assert.equal(compareFrames(a, b, 5).score, 75);
});
