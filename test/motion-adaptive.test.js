import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMotion, frameMean } from '../js/detection/motion.js';

function frame(n, fn) {
  const g = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) g[i] = fn(i);
  return g;
}
// Rumore pseudo-casuale deterministico in [-amp, amp]
function noisy(base, amp, seed) {
  let s = seed;
  return (i) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return base(i) + ((s % (2 * amp + 1)) - amp);
  };
}

const N = 64 * 48;

test('frameMean', () => {
  assert.equal(frameMean(frame(10, () => 100)), 100);
  assert.equal(frameMean(new Uint8ClampedArray(0)), 0);
});

test('normalizzazione: un cambio globale di luminosità (autoesposizione) non è movimento', () => {
  const a = frame(N, (i) => 60 + (i % 7) * 3);
  const b = frame(N, (i) => 60 + (i % 7) * 3 + 40); // tutto più chiaro di 40
  const r = analyzeMotion(a, b);
  assert.equal(r.offset, -40);
  assert.equal(r.score, 0);
  const raw = analyzeMotion(a, b, { normalize: false, adaptive: false });
  assert.equal(raw.score, 100, 'senza normalizzazione né adattamento sarebbe tutto "movimento"');
});

test('adattivo: il rumore del sensore al buio alza la soglia e non produce movimento', () => {
  const dark = (i) => 20 + (i % 5);
  const a = frame(N, noisy(dark, 20, 1));
  const b = frame(N, noisy(dark, 20, 2));
  const fixed = analyzeMotion(a, b, { adaptive: false });
  const adaptive = analyzeMotion(a, b);
  assert.ok(fixed.score > 5, `con soglia fissa il rumore dà movimento (${fixed.score.toFixed(1)} %)`);
  assert.ok(adaptive.pixelDelta > 28, `soglia alzata a ${adaptive.pixelDelta}`);
  assert.ok(adaptive.score < 1, `con soglia adattiva il rumore sparisce (${adaptive.score.toFixed(2)} %)`);
});

test('adattivo: il movimento vero resta visibile anche con rumore', () => {
  const dark = (i) => 20 + (i % 5);
  const a = frame(N, noisy(dark, 20, 3));
  const bNoise = noisy(dark, 20, 4);
  // un oggetto chiaro copre il 10 % dei pixel
  const b = frame(N, (i) => (i < N / 10 ? 200 : bNoise(i)));
  const r = analyzeMotion(a, b);
  assert.ok(r.score > 8 && r.score < 14, `movimento ~10 % rilevato (${r.score.toFixed(1)} %)`);
  assert.ok(r.brightness > 20);
});

test('in piena luce senza rumore la soglia resta quella base', () => {
  const a = frame(N, (i) => 120 + (i % 3));
  const r = analyzeMotion(a, a);
  assert.equal(r.pixelDelta, 28);
  assert.equal(r.noise, 0);
  assert.equal(r.score, 0);
});
