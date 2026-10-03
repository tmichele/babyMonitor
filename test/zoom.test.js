import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampOffset, zoomAround, pan, IDENTITY, ZOOM } from '../js/zoom.js';

const box = { width: 400, height: 300 };

test('clampOffset: a scala 1 nessuno spostamento, altrimenti entro il bordo', () => {
  assert.equal(clampOffset(-50, 1, 400), 0);
  assert.equal(clampOffset(50, 2, 400), 0);
  assert.equal(clampOffset(-999, 2, 400), -400);
  assert.equal(clampOffset(-100, 2, 400), -100);
});

test('zoomAround: il punto sotto il cursore resta fermo e la scala è limitata', () => {
  const s1 = zoomAround(IDENTITY, 2, 200, 150, box);
  assert.equal(s1.scale, 2);
  assert.equal(s1.x, -200);
  assert.equal(s1.y, -150);
  // il punto (200,150) del contenuto (a scala 1) resta sotto il cursore anche dopo lo zoom
  assert.equal(s1.x + 200 * s1.scale, 200);
  assert.equal(s1.y + 150 * s1.scale, 150);
  const corner = zoomAround(IDENTITY, 2, 0, 0, box);
  assert.deepEqual(corner, { scale: 2, x: 0, y: 0 });
  const huge = zoomAround(IDENTITY, 100, 0, 0, box);
  assert.equal(huge.scale, ZOOM.max);
  const tiny = zoomAround({ scale: 2, x: -100, y: -50 }, 0.01, 0, 0, box);
  assert.deepEqual(tiny, { scale: 1, x: 0, y: 0 });
});

test('pan: trascina entro i limiti e non muove a scala 1', () => {
  assert.deepEqual(pan(IDENTITY, -50, -50, box), { scale: 1, x: 0, y: 0 });
  const z = { scale: 2, x: -100, y: -100 };
  assert.deepEqual(pan(z, -50, 30, box), { scale: 2, x: -150, y: -70 });
  assert.deepEqual(pan(z, -999, 999, box), { scale: 2, x: -400, y: 0 });
});
