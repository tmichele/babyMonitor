// Rilevazione movimento: confronto di frame ridotti in scala di grigi.
import { ema } from './levels.js';

/** Converte RGBA in luminanza 0..255 (pesi BT.601 interi). */
export function toGrayscale(rgba, width, height, out) {
  const n = width * height;
  const gray = out && out.length === n ? out : new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return gray;
}

/**
 * Confronta due frame in scala di grigi.
 * @returns {{score:number, changedFraction:number, meanDelta:number}} score = % pixel cambiati.
 */
export function compareFrames(prev, curr, pixelDelta = 28, mask = null) {
  const n = Math.min(prev.length, curr.length);
  let changed = 0;
  let sumDelta = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(curr[i] - prev[i]);
    const hit = d >= pixelDelta;
    if (hit) {
      changed++;
      sumDelta += d;
    }
    if (mask) mask[i] = hit ? 1 : 0;
  }
  const fraction = n ? changed / n : 0;
  return { score: fraction * 100, changedFraction: fraction, meanDelta: changed ? sumDelta / changed : 0 };
}

/**
 * Campiona un <video> a bassa risoluzione e calcola il punteggio di movimento.
 * onUpdate({ score, smoothed, meanDelta }) viene chiamato a ogni frame analizzato.
 */
export class MotionDetector {
  constructor(video, {
    width = 64,
    height = 48,
    fps = 8,
    pixelDelta = 28,
    alpha = 0.5,
    overlay = null,
    onUpdate = () => {},
  } = {}) {
    this.video = video;
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.pixelDelta = pixelDelta;
    this.alpha = alpha;
    this.overlay = overlay;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.prev = null;
    this.curr = null;
    this.mask = new Uint8Array(width * height);
    this.smoothed = null;
    this.canvas = null;
    this.ctx = null;
    this.overlayCtx = null;
    this.overlayImage = null;
  }

  start() {
    if (this.timer) return;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (this.overlay) {
      this.overlay.width = this.width;
      this.overlay.height = this.height;
      this.overlayCtx = this.overlay.getContext('2d');
      this.overlayImage = this.overlayCtx.createImageData(this.width, this.height);
    }
    this.prev = null;
    this.smoothed = null;
    this.timer = setInterval(() => this.tick(), Math.round(1000 / this.fps));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.prev = null;
    this.smoothed = null;
    if (this.overlayCtx) this.overlayCtx.clearRect(0, 0, this.width, this.height);
  }

  tick() {
    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) return;
    try {
      this.ctx.drawImage(v, 0, 0, this.width, this.height);
    } catch {
      return;
    }
    const img = this.ctx.getImageData(0, 0, this.width, this.height);
    this.curr = toGrayscale(img.data, this.width, this.height, this.curr);
    if (this.prev) {
      const result = compareFrames(this.prev, this.curr, this.pixelDelta, this.mask);
      this.smoothed = ema(this.smoothed, result.score, this.alpha);
      this.drawOverlay();
      this.onUpdate({ score: result.score, smoothed: this.smoothed, meanDelta: result.meanDelta });
    }
    const swap = this.prev;
    this.prev = this.curr;
    this.curr = swap;
  }

  drawOverlay() {
    if (!this.overlayCtx) return;
    const data = this.overlayImage.data;
    const mask = this.mask;
    for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
      data[j] = 255;
      data[j + 1] = 64;
      data[j + 2] = 64;
      data[j + 3] = mask[i] ? 150 : 0;
    }
    this.overlayCtx.putImageData(this.overlayImage, 0, 0);
  }
}
