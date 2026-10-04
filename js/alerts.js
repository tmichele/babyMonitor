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

/** 'unsupported' | 'granted' | 'denied' | 'default' */
export function notificationState() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** True se l'app è aperta come PWA installata (schermata Home). */
export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
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

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/**
 * Mostra una notifica di sistema. Usa il service worker ATTIVO (navigator.serviceWorker.ready):
 * la registrazione appena creata può non esserlo ancora e su Android `new Notification()` non
 * esiste. Restituisce 'shown' | 'unsupported' | 'denied' | 'default' | 'failed'.
 */
export async function notify(title, body, { level = 2 } = {}) {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'granted') return Notification.permission;
  const opts = {
    body,
    tag: 'babymonitor',
    renotify: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    vibrate: level >= 3 ? [300, 100, 300, 100, 300] : [200, 100, 200],
    requireInteraction: level >= 3,
    timestamp: Date.now(),
  };
  if ('serviceWorker' in navigator) {
    try {
      registerServiceWorker();
      const reg = await withTimeout(navigator.serviceWorker.ready, 4000);
      if (reg?.showNotification) {
        await reg.showNotification(title, opts);
        return 'shown';
      }
    } catch (err) {
      console.warn('Notifica via service worker fallita', err);
    }
  }
  try {
    new Notification(title, opts);
    return 'shown';
  } catch (err) {
    console.warn('Notification() non disponibile', err);
    return 'failed';
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
