// AudioWorkletProcessor: calcola le caratteristiche del pianto sul thread audio e le invia al
// thread principale. Gira anche con la scheda in background (i timer JS vengono rallentati,
// l'elaborazione audio no).
import { hannWindow, magnitudeSpectrum } from './fft.js';
import { analyzeSpectrum, cryScore, magnitudesToBytes, rmsFromFloat, rmsToDb } from './cry.js';

class CryProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions || {};
    this.fftSize = o.fftSize || 2048;
    this.everyFrames = Math.max(1, o.everyFrames || 2);
    this.buf = new Float32Array(this.fftSize);
    this.pos = 0;
    this.re = new Float32Array(this.fftSize);
    this.im = new Float32Array(this.fftSize);
    this.win = hannWindow(this.fftSize);
    this.mags = new Float32Array(this.fftSize / 2);
    this.bytes = new Uint8Array(this.fftSize / 2);
    this.frame = 0;
    this.active = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.active = false;
    };
  }

  process(inputs) {
    if (!this.active) return false;
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.pos++] = ch[i];
      if (this.pos === this.fftSize) {
        this.analyze();
        this.pos = 0;
      }
    }
    return true;
  }

  analyze() {
    this.frame++;
    if (this.frame % this.everyFrames !== 0) return;
    const db = rmsToDb(rmsFromFloat(this.buf));
    magnitudeSpectrum(this.buf, this.win, this.re, this.im, this.mags);
    magnitudesToBytes(this.mags, this.bytes);
    const { bandRatio, peakiness } = analyzeSpectrum(this.bytes, sampleRate, this.fftSize);
    const score = cryScore({ db, bandRatio, peakiness });
    this.port.postMessage({ score, db, bandRatio, peakiness });
  }
}

registerProcessor('cry-processor', CryProcessor);
