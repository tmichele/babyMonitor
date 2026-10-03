import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, hannWindow, magnitudeSpectrum } from '../js/detection/fft.js';
import { magnitudesToBytes, rmsFromFloat } from '../js/detection/cry.js';

test('fft: una sinusoide a fondo scala produce un picco ~1 nel bin giusto', () => {
  const n = 1024;
  const k = 37;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = Math.sin((2 * Math.PI * k * i) / n);
  const mags = magnitudeSpectrum(samples, hannWindow(n), new Float32Array(n), new Float32Array(n), new Float32Array(n / 2));
  let peak = 0;
  for (let i = 1; i < mags.length; i++) if (mags[i] > mags[peak]) peak = i;
  assert.equal(peak, k);
  assert.ok(Math.abs(mags[k] - 1) < 0.05, `ampiezza ${mags[k]}`);
  assert.ok(mags[k + 10] < 0.01, 'fuori dal picco è quasi zero');
});

test('fft: rifiuta lunghezze non potenza di 2 e lascia la DC nel bin 0', () => {
  assert.throws(() => fft(new Float32Array(100), new Float32Array(100)));
  const re = new Float32Array(8).fill(1);
  const im = new Float32Array(8);
  fft(re, im);
  assert.equal(re[0], 8);
  assert.ok(Math.abs(re[1]) < 1e-6);
});

test('magnitudesToBytes mappa -100..-30 dB su 0..255; rmsFromFloat', () => {
  const b = magnitudesToBytes(new Float32Array([0, 1e-5, 10 ** (-65 / 20), 1]));
  assert.equal(b[0], 0);
  assert.equal(b[1], 0);
  assert.ok(b[2] === 127 || b[2] === 128, `valore medio ${b[2]}`);
  assert.equal(b[3], 255);
  assert.ok(Math.abs(rmsFromFloat(new Float32Array([1, -1, 1, -1])) - 1) < 1e-9);
  assert.equal(rmsFromFloat(new Float32Array(4)), 0);
});
