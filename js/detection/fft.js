// FFT radix-2 in place (Cooley-Tukey). Usata dall'AudioWorklet, dove AnalyserNode non esiste.

/** Trasforma in place re/im (lunghezza potenza di 2). */
export function fft(re, im) {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error('fft: la lunghezza deve essere una potenza di 2');
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tRe = re[b] * curRe - im[b] * curIm;
        const tIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

export function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

/**
 * Spettro di ampiezza normalizzato (1 = sinusoide a fondo scala) di `samples` finestrati con `win`.
 * Scrive in `mags` (lunghezza n/2) e restituisce mags.
 */
export function magnitudeSpectrum(samples, win, re, im, mags) {
  const n = samples.length;
  let winSum = 0;
  for (let i = 0; i < n; i++) {
    re[i] = samples[i] * win[i];
    im[i] = 0;
    winSum += win[i];
  }
  fft(re, im);
  const half = n >> 1;
  const norm = winSum > 0 ? 2 / winSum : 0;
  for (let k = 0; k < half; k++) mags[k] = Math.hypot(re[k], im[k]) * norm;
  return mags;
}
