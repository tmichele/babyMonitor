// Configurazione locale: config Firebase, identità del dispositivo, preferenze salvate nel browser.

const KEYS = {
  firebaseConfig: 'babymonitor.firebaseConfig',
  iceServers: 'babymonitor.iceServers',
  deviceId: 'babymonitor.deviceId',
  deviceName: 'babymonitor.deviceName',
  cameraSettings: 'babymonitor.cameraSettings',
  viewerPrefs: 'babymonitor.viewerPrefs',
  selectedCamera: 'babymonitor.selectedCamera',
  videoSource: 'babymonitor.videoSource',
};

const REQUIRED_FIELDS = ['apiKey', 'projectId', 'appId'];

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readJson(key, fallback = null) {
  const ls = storage();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  const ls = storage();
  if (!ls) return;
  try {
    if (value === null || value === undefined) ls.removeItem(key);
    else ls.setItem(key, JSON.stringify(value));
  } catch {
    /* quota o modalità privata: ignora */
  }
}

export function isValidFirebaseConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  return REQUIRED_FIELDS.every(
    (k) => typeof cfg[k] === 'string' && cfg[k].trim() !== '' && !cfg[k].startsWith('YOUR_'),
  );
}

/**
 * Accetta sia JSON puro sia lo snippet JS mostrato dalla console Firebase
 * (`const firebaseConfig = { apiKey: "...", ... };`). Restituisce l'oggetto o lancia un errore.
 */
export function parseFirebaseConfigInput(text) {
  const src = String(text || '').trim();
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('Configurazione non riconosciuta: manca un oggetto { ... }.');
  let body = src.slice(start, end + 1);
  // Trasforma lo snippet JS in JSON: chiavi non quotate, apici singoli, virgole finali, commenti.
  body = body
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, s) => `"${s.replace(/"/g, '\\"')}"`)
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1');
  let cfg;
  try {
    cfg = JSON.parse(body);
  } catch {
    throw new Error('Configurazione non valida: controlla la sintassi.');
  }
  if (!isValidFirebaseConfig(cfg)) {
    throw new Error(`Configurazione incompleta: servono almeno ${REQUIRED_FIELDS.join(', ')}.`);
  }
  return cfg;
}

export function loadFirebaseConfig() {
  const fromWindow = globalThis.FIREBASE_CONFIG;
  if (isValidFirebaseConfig(fromWindow)) return fromWindow;
  const stored = readJson(KEYS.firebaseConfig);
  return isValidFirebaseConfig(stored) ? stored : null;
}

export function hasWindowFirebaseConfig() {
  return isValidFirebaseConfig(globalThis.FIREBASE_CONFIG);
}

export function saveFirebaseConfig(cfg) {
  writeJson(KEYS.firebaseConfig, cfg);
}

export function clearFirebaseConfig() {
  writeJson(KEYS.firebaseConfig, null);
}

export const DEFAULT_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

export function parseIceServersInput(text) {
  const src = String(text || '').trim();
  if (!src) return null;
  const parsed = JSON.parse(src);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (!list.every((s) => s && typeof s === 'object' && s.urls)) {
    throw new Error('Ogni server ICE deve avere il campo "urls".');
  }
  return list;
}

export function loadIceServers() {
  if (Array.isArray(globalThis.ICE_SERVERS) && globalThis.ICE_SERVERS.length) return globalThis.ICE_SERVERS;
  const stored = readJson(KEYS.iceServers);
  return Array.isArray(stored) && stored.length ? stored : DEFAULT_ICE_SERVERS;
}

export function saveIceServers(list) {
  writeJson(KEYS.iceServers, list);
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function getDeviceId() {
  let id = readJson(KEYS.deviceId);
  if (!id) {
    id = randomId();
    writeJson(KEYS.deviceId, id);
  }
  return id;
}

export function getDeviceName() {
  return readJson(KEYS.deviceName) || defaultDeviceName();
}

export function setDeviceName(name) {
  writeJson(KEYS.deviceName, String(name || '').trim() || null);
}

function defaultDeviceName() {
  const ua = globalThis.navigator?.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'PC Windows';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Camera';
}

export const prefs = {
  getCameraSettings: () => readJson(KEYS.cameraSettings, null),
  setCameraSettings: (s) => writeJson(KEYS.cameraSettings, s),
  getViewerPrefs: () => readJson(KEYS.viewerPrefs, null),
  setViewerPrefs: (p) => writeJson(KEYS.viewerPrefs, p),
  getSelectedCamera: () => readJson(KEYS.selectedCamera, null),
  setSelectedCamera: (id) => writeJson(KEYS.selectedCamera, id),
  getVideoSource: () => readJson(KEYS.videoSource, null),
  setVideoSource: (id) => writeJson(KEYS.videoSource, id),
};
