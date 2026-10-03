// Livello di batteria del dispositivo (Battery Status API: Chrome/Edge/Android; non disponibile
// su Safari/iOS e Firefox, dove si mostra "n/d").

export const LOW_BATTERY = 15;

export function batterySupported() {
  return typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function';
}

/** Normalizza l'oggetto BatteryManager (o un dato remoto) in { level: 0..100, charging }. */
export function normalizeBattery(b) {
  if (!b || typeof b !== 'object') return null;
  const raw = Number(b.level);
  if (!Number.isFinite(raw)) return null;
  const level = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
  return { level: Math.max(0, Math.min(100, level)), charging: !!b.charging };
}

export function batteryIcon(b) {
  if (!b) return '🔋';
  if (b.charging) return '⚡';
  return b.level <= 20 ? '🪫' : '🔋';
}

export function batteryLabel(b) {
  if (!b) return '🔋 n/d';
  return `${batteryIcon(b)} ${b.level}%`;
}

export function isLowBattery(b, threshold = LOW_BATTERY) {
  return !!b && !b.charging && b.level <= threshold;
}

/**
 * Osserva la batteria locale: cb({ level, charging }) subito e a ogni variazione, cb(null) se
 * non supportata. Restituisce una funzione per smettere di osservare.
 */
export async function watchBattery(cb) {
  if (!batterySupported()) {
    cb(null);
    return () => {};
  }
  try {
    const manager = await navigator.getBattery();
    const emit = () => cb(normalizeBattery(manager));
    manager.addEventListener('levelchange', emit);
    manager.addEventListener('chargingchange', emit);
    emit();
    return () => {
      manager.removeEventListener('levelchange', emit);
      manager.removeEventListener('chargingchange', emit);
    };
  } catch {
    cb(null);
    return () => {};
  }
}
