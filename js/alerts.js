// Avvisi locali sul dispositivo visualizzatore: suono, vibrazione, notifiche di sistema.

let audioCtx = null;
let swRegistration = null;

export function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

export function beep({ count = 2, freq = 880, duration = 0.16, gap = 0.1, volume = 0.5 } = {}) {
  const ctx = unlockAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  for (let i = 0; i < count; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain).connect(ctx.destination);
    const start = t0 + i * (duration + gap);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }
}

export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* non supportato */
  }
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || swRegistration) return swRegistration;
  try {
    swRegistration = await navigator.serviceWorker.register('sw.js');
  } catch {
    swRegistration = null;
  }
  return swRegistration;
}

export function notificationsSupported() {
  return 'Notification' in window;
}

export async function requestNotifications() {
  if (!notificationsSupported()) return 'unsupported';
  await registerServiceWorker();
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export async function notify(title, body) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const opts = { body, tag: 'babymonitor', renotify: true, icon: 'icons/icon.svg' };
  try {
    const reg = swRegistration || (await registerServiceWorker());
    if (reg?.showNotification) {
      await reg.showNotification(title, opts);
      return;
    }
  } catch {
    /* fallback sotto */
  }
  try {
    new Notification(title, opts);
  } catch {
    /* alcune piattaforme non permettono Notification() dalla pagina */
  }
}

export class WakeLockKeeper {
  constructor() {
    this.lock = null;
    this.wanted = false;
    this.onVisibility = () => {
      if (this.wanted && document.visibilityState === 'visible') this.request();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  async request() {
    this.wanted = true;
    if (!('wakeLock' in navigator)) return false;
    try {
      if (this.lock && !this.lock.released) return true;
      this.lock = await navigator.wakeLock.request('screen');
      this.lock.addEventListener('release', () => {
        this.lock = null;
      });
      return true;
    } catch {
      return false;
    }
  }

  async release() {
    this.wanted = false;
    try {
      await this.lock?.release();
    } catch {
      /* ignora */
    }
    this.lock = null;
  }

  destroy() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.release();
  }
}
