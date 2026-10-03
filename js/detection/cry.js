// Rilevazione pianto: volume (RMS) + energia nella banda tipica del pianto infantile
// (300–3000 Hz) + "picchi" armonici. Il punteggio 0..100 viene poi mappato a livelli.
import { clamp, ema } from './levels.js';

export const CRY_BAND = Object.freeze({ low: 300, high: 3000, minHz: 80, maxHz: 8000 });

/** RMS 0..1 da dati time-domain a 8 bit (centrati su 128). */
export function rmsFromTimeDomain(timeData) {
  if (!timeData || !timeData.length) return 0;
  let sum = 0;
  for (let i = 0; i < timeData.length; i++) {
    const x = (timeData[i] - 128) / 128;
    sum += x * x;
  }
  return Math.sqrt(sum / timeData.length);
}

export function rmsToDb(rms) {
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}

/** RMS 0..1 da campioni float (-1..1). */
export function rmsFromFloat(samples) {
  if (!samples || !samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * Converte ampiezze lineari (1 = fondo scala) in valori 0..255 su scala dB, come fa
 * AnalyserNode.getByteFrequencyData (minDecibels -100, maxDecibels -30).
 */
export function magnitudesToBytes(mags, out, minDb = -100, maxDb = -30) {
  const o = out && out.length === mags.length ? out : new Uint8Array(mags.length);
  const span = maxDb - minDb;
  for (let i = 0; i < mags.length; i++) {
    const db = mags[i] > 0 ? 20 * Math.log10(mags[i]) : -200;
    o[i] = clamp(Math.round(((db - minDb) / span) * 255), 0, 255);
  }
  return o;
}

/**
 * Analizza lo spettro (getByteFrequencyData, 0..255).
 * bandRatio: quota di energia nella banda del pianto; peakiness: quanto lo spettro in banda
 * è "a picchi" (armonico) rispetto a un rumore uniforme.
 */
export function analyzeSpectrum(freqData, sampleRate, fftSize, band = CRY_BAND) {
  const binHz = sampleRate / fftSize;
  let total = 0;
  let inBand = 0;
  let bandMax = 0;
  let bandSum = 0;
  let bandCount = 0;
  for (let i = 0; i < freqData.length; i++) {
    const hz = i * binHz;
    if (hz < band.minHz || hz > band.maxHz) continue;
    const v = freqData[i] / 255;
    const e = v * v;
    total += e;
    if (hz >= band.low && hz <= band.high) {
      inBand += e;
      bandSum += v;
      bandCount++;
      if (v > bandMax) bandMax = v;
    }
  }
  const bandRatio = total > 0 ? inBand / total : 0;
  const bandMean = bandCount ? bandSum / bandCount : 0;
  const peakiness = bandMean > 0 ? clamp((bandMax / bandMean - 1) / 3, 0, 1) : 0;
  return { bandRatio, peakiness, total };
}

/** Punteggio 0..100: volume normalizzato × somiglianza a un pianto. */
export function cryScore({ db, bandRatio, peakiness }, { minDb = -60, maxDb = -12 } = {}) {
  const loud = clamp((db - minDb) / (maxDb - minDb), 0, 1);
  const cryLike = clamp(0.6 * bandRatio + 0.4 * peakiness, 0, 1);
  return 100 * loud * (0.35 + 0.65 * cryLike);
}

/**
 * Analizza in tempo reale l'audio di un MediaStream.
 * Usa un AudioWorklet (gira sul thread audio: continua anche con la scheda in background o
 * lo schermo spento su Android); se non disponibile ripiega su AnalyserNode + timer.
 * onUpdate({ score, smoothed, db, bandRatio, peakiness }).
 */
export class CryDetector {
  constructor(stream, { intervalMs = 100, alpha = 0.35, fftSize = 2048, useWorklet = true, onUpdate = () => {} } = {}) {
    this.stream = stream;
    this.intervalMs = intervalMs;
    this.alpha = alpha;
    this.fftSize = fftSize;
    this.useWorklet = useWorklet;
    this.onUpdate = onUpdate;
    this.ctx = null;
    this.source = null;
    this.analyser = null;
    this.worklet = null;
    this.timer = null;
    this.smoothed = null;
    this.freqData = null;
    this.timeData = null;
    this.engine = null;
  }

  async start() {
    if (this.timer || this.worklet) return;
    if (!this.stream.getAudioTracks().length) throw new Error('Nessuna traccia audio disponibile');
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.smoothed = null;
    if (this.useWorklet && this.ctx.audioWorklet) {
      try {
        await this.startWorklet();
        return;
      } catch (err) {
        console.warn('AudioWorklet non disponibile, uso AnalyserNode', err);
      }
    }
    this.startAnalyser();
  }

  async startWorklet() {
    await this.ctx.audioWorklet.addModule(new URL('./cry-worklet.js', import.meta.url));
    const everyFrames = Math.max(1, Math.round((this.intervalMs / 1000) * this.ctx.sampleRate / this.fftSize));
    this.worklet = new AudioWorkletNode(this.ctx, 'cry-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { fftSize: this.fftSize, everyFrames },
    });
    this.worklet.port.onmessage = (e) => this.handle(e.data);
    this.source.connect(this.worklet);
    // L'uscita è silenziosa: il collegamento alla destinazione serve solo a tenere attivo il nodo.
    this.worklet.connect(this.ctx.destination);
    this.engine = 'worklet';
  }

  startAnalyser() {
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.6;
    this.source.connect(this.analyser);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.engine = 'analyser';
  }

  tick() {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);
    const db = rmsToDb(rmsFromTimeDomain(this.timeData));
    const { bandRatio, peakiness } = analyzeSpectrum(this.freqData, this.ctx.sampleRate, this.fftSize);
    this.handle({ score: cryScore({ db, bandRatio, peakiness }), db, bandRatio, peakiness });
  }

  handle({ score, db, bandRatio, peakiness }) {
    this.smoothed = ema(this.smoothed, score, this.alpha);
    this.onUpdate({ score, smoothed: this.smoothed, db, bandRatio, peakiness });
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.worklet?.port.postMessage('stop');
      this.worklet?.disconnect();
    } catch {
      /* ignora */
    }
    this.worklet = null;
    try {
      this.source?.disconnect();
    } catch {
      /* ignora */
    }
    try {
      await this.ctx?.close();
    } catch {
      /* ignora */
    }
    this.ctx = null;
    this.source = null;
    this.analyser = null;
    this.smoothed = null;
  }
}
