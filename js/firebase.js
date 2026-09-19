// Wrapper Firebase: caricamento dinamico dell'SDK (così la schermata di configurazione
// funziona anche senza rete), auth e riferimenti Firestore scoperti per utente.

const SDK_VERSION = '10.14.1';
const SDK_BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

export let app = null;
export let auth = null;
export let db = null;
/** Modulo firebase/auth (getAuth, signInWithEmailAndPassword, ...) */
export let A = null;
/** Modulo firebase/firestore (collection, doc, onSnapshot, ...) */
export let S = null;

export async function initFirebase(config) {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${SDK_BASE}/firebase-app.js`),
    import(`${SDK_BASE}/firebase-auth.js`),
    import(`${SDK_BASE}/firebase-firestore.js`),
  ]);
  A = authMod;
  S = fsMod;
  app = appMod.initializeApp(config);
  auth = A.getAuth(app);
  db = S.getFirestore(app);
  return { app, auth, db };
}

export function currentUid() {
  const uid = auth?.currentUser?.uid;
  if (!uid) throw new Error('Utente non autenticato');
  return uid;
}

export function camerasCol() {
  return S.collection(db, 'users', currentUid(), 'cameras');
}

export function cameraDoc(cameraId) {
  return S.doc(db, 'users', currentUid(), 'cameras', cameraId);
}

export function eventsCol(cameraId) {
  return S.collection(cameraDoc(cameraId), 'events');
}

export function callsCol(cameraId) {
  return S.collection(cameraDoc(cameraId), 'calls');
}

const AUTH_ERRORS = {
  'auth/invalid-email': 'Indirizzo email non valido.',
  'auth/missing-password': 'Inserisci la password.',
  'auth/user-not-found': 'Nessun account con questa email.',
  'auth/wrong-password': 'Password errata.',
  'auth/invalid-credential': 'Email o password errati.',
  'auth/email-already-in-use': 'Esiste già un account con questa email.',
  'auth/weak-password': 'Password troppo debole: almeno 6 caratteri.',
  'auth/too-many-requests': 'Troppi tentativi, riprova tra qualche minuto.',
  'auth/network-request-failed': 'Errore di rete: controlla la connessione.',
  'auth/operation-not-allowed': 'Accesso Email/Password non abilitato nella console Firebase.',
  'auth/user-disabled': 'Account disabilitato.',
};

export function authErrorMessage(err) {
  return AUTH_ERRORS[err?.code] || err?.message || 'Errore sconosciuto.';
}

export function tsToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  if (value.seconds != null) return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  return null;
}
