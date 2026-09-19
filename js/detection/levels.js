// Livelli condivisi tra rilevazione movimento e pianto: 0 = nulla, 1 = basso, 2 = medio, 3 = alto.

export const MOTION_LABELS = ['Fermo', 'Leggero', 'Moderato', 'Intenso'];
export const CRY_LABELS = ['Silenzio', 'Rumore', 'Lamento', 'Pianto'];
export const LEVEL_NAMES = ['nessuno', 'basso', 'medio', 'alto'];

export const DEFAULT_SETTINGS = Object.freeze({
  /** Sensibilità 1..10 (5 = soglie di base). */
  motionSensitivity: 5,
  crySensitivity: 5,
  /** Soglie base per i livelli 1,2,3: % di pixel cambiati tra due frame. */
  motionThresholds: [1.5, 5, 12],
  /** Soglie base per i livelli 1,2,3: punteggio pianto 0..100. */
  cryThresholds: [20, 45, 70],
  /** Tempo minimo (ms) per cui un livello resta attivo prima di poter scendere. */
  holdMs: 2500,
  /** Livello minimo registrato come evento su Firestore. */
  eventMinLevel: 2,
  /** Intervallo minimo (ms) tra due eventi dello stesso tipo e livello. */
  eventCooldownMs: 20000,
});

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Media mobile esponenziale. Con prev null restituisce next. */
export function ema(prev, next, alpha) {
  if (prev == null || Number.isNaN(prev)) return next;
  return prev + alpha * (next - prev);
}

/** Sensibilità alta → soglie più basse (fattore 5/sensibilità). */
export function scaledThresholds(base, sensitivity) {
  const s = clamp(Number(sensitivity) || 5, 1, 10);
  const factor = 5 / s;
  return base.map((t) => t * factor);
}

export function scoreToLevel(score, thresholds) {
  let level = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (score >= thresholds[i]) level = i + 1;
  }
  return level;
}

/**
 * Mantiene il livello raggiunto per almeno holdMs prima di lasciarlo scendere:
 * evita sfarfallii nell'interfaccia e raffiche di eventi.
 */
export class LevelTracker {
  constructor({ holdMs = DEFAULT_SETTINGS.holdMs } = {}) {
    this.holdMs = holdMs;
    this.level = 0;
    this.peakAt = 0;
  }

  update(rawLevel, now = Date.now()) {
    if (rawLevel >= this.level) {
      this.level = rawLevel;
      this.peakAt = now;
    } else if (now - this.peakAt >= this.holdMs) {
      this.level = rawLevel;
      this.peakAt = now;
    }
    return this.level;
  }

  reset() {
    this.level = 0;
    this.peakAt = 0;
  }
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function thresholdsOr(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  const arr = value.map((v, i) => numberOr(v, fallback[i]));
  for (let i = 1; i < 3; i++) if (arr[i] < arr[i - 1]) return [...fallback];
  return arr;
}

/** Riempie i valori mancanti e limita quelli fuori intervallo. */
export function normalizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    motionSensitivity: clamp(Math.round(numberOr(src.motionSensitivity, DEFAULT_SETTINGS.motionSensitivity)), 1, 10),
    crySensitivity: clamp(Math.round(numberOr(src.crySensitivity, DEFAULT_SETTINGS.crySensitivity)), 1, 10),
    motionThresholds: thresholdsOr(src.motionThresholds, DEFAULT_SETTINGS.motionThresholds),
    cryThresholds: thresholdsOr(src.cryThresholds, DEFAULT_SETTINGS.cryThresholds),
    holdMs: clamp(numberOr(src.holdMs, DEFAULT_SETTINGS.holdMs), 500, 30000),
    eventMinLevel: clamp(Math.round(numberOr(src.eventMinLevel, DEFAULT_SETTINGS.eventMinLevel)), 1, 3),
    eventCooldownMs: clamp(numberOr(src.eventCooldownMs, DEFAULT_SETTINGS.eventCooldownMs), 2000, 600000),
  };
}

export function settingsEqual(a, b) {
  return JSON.stringify(normalizeSettings(a)) === JSON.stringify(normalizeSettings(b));
}

/**
 * Decide se registrare un evento: livello ≥ minimo e (livello salito rispetto all'ultimo
 * evento, oppure cooldown scaduto). Restituisce lo stato aggiornato per il tipo.
 */
export function shouldLogEvent(last, level, now, { eventMinLevel, eventCooldownMs, minGapMs = 3000 }) {
  const prev = last || { level: 0, at: 0 };
  if (level < eventMinLevel) {
    return { log: false, next: { level: 0, at: prev.at } };
  }
  const since = now - prev.at;
  const rose = level > prev.level && (prev.at === 0 || since >= minGapMs);
  const expired = since >= eventCooldownMs;
  if (rose || expired) return { log: true, next: { level, at: now } };
  return { log: false, next: prev.level === 0 ? { level, at: prev.at } : prev };
}
