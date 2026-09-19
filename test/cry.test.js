import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmsFromTimeDomain, rmsToDb, analyzeSpectrum, cryScore } from '../js/detection/cry.js';

const SR = 48000;
const FFT = 2048;
const BINS = FFT / 2;
const binHz = SR / FFT;

function spectrum(fn) {
  const data = new Uint8Array(BINS);
  for (let i = 0; i < BINS; i++) data[i] = Math.max(0, Math.min(255, Math.round(fn(i * binHz))));
  return data;
}

test('rms: silenzio → 0, onda quadra piena → 1', () => {
  assert.equal(rmsFromTimeDomain(new Uint8Array(1024).fill(128)), 0);
  const square = new Uint8Array(1024).map((_, i) => (i % 2 ? 0 : 255));
  assert.ok(Math.abs(rmsFromTimeDomain(square) - 1) < 0.01);
  assert.equal(rmsToDb(0), -100);
  assert.ok(Math.abs(rmsToDb(0.1) + 20) < 1e-9);
});

test('analyzeSpectrum: energia armonica in banda → bandRatio e peakiness alti', () => {
  const harmonic = spectrum((hz) => {
    for (const f of [450, 900, 1350, 1800, 2250]) if (Math.abs(hz - f) < binHz) return 230;
    return 20;
  });
  const a = analyzeSpectrum(harmonic, SR, FFT);
  assert.ok(a.bandRatio > 0.8, `bandRatio ${a.bandRatio}`);
  assert.ok(a.peakiness > 0.6, `peakiness ${a.peakiness}`);

  const white = spectrum(() => 120);
  const w = analyzeSpectrum(white, SR, FFT);
  assert.ok(w.bandRatio < 0.45, `rumore bianco bandRatio ${w.bandRatio}`);
  assert.ok(w.peakiness < 0.05, `rumore bianco peakiness ${w.peakiness}`);

  const lowHum = spectrum((hz) => (hz < 150 ? 220 : 5));
  const l = analyzeSpectrum(lowHum, SR, FFT);
  assert.ok(l.bandRatio < 0.1, `ronzio bandRatio ${l.bandRatio}`);

  assert.deepEqual(analyzeSpectrum(new Uint8Array(BINS), SR, FFT), { bandRatio: 0, peakiness: 0, total: 0 });
});

test('cryScore: cresce con il volume ed è più alto per suoni simili a pianto', () => {
  const quiet = cryScore({ db: -70, bandRatio: 1, peakiness: 1 });
  const loudCry = cryScore({ db: -12, bandRatio: 0.9, peakiness: 0.8 });
  const loudNoise = cryScore({ db: -12, bandRatio: 0.3, peakiness: 0.05 });
  assert.equal(quiet, 0);
  assert.ok(loudCry > 85, `loudCry ${loudCry}`);
  assert.ok(loudNoise < loudCry);
  assert.ok(loudNoise > 30, 'un rumore forte resta comunque segnalato');
  assert.ok(cryScore({ db: -40, bandRatio: 0.9, peakiness: 0.8 }) < loudCry);
});
