// Sostituto in memoria dell'SDK Firebase per i test end-to-end (servito al posto di
// firebase-app.js / firebase-auth.js / firebase-firestore.js). Le scritture vengono
// propagate alle altre schede dello stesso browser via BroadcastChannel, così camera e
// visualizzatore possono dialogare (WebRTC compreso) senza un progetto Firebase reale.

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fake-firestore') : null;
const store = new Map(); // path documento -> dati
const listeners = new Set();
let seq = 0;

const SERVER_TS = '__serverTimestamp__';

function randomId() {
  return Math.random().toString(36).slice(2, 12) + (seq++).toString(36);
}

function nowTs() {
  const ms = Date.now();
  return { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 };
}

function resolveValues(value) {
  if (value && typeof value === 'object') {
    if (value[SERVER_TS]) return nowTs();
    if (Array.isArray(value)) return value.map(resolveValues);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValues(v);
    return out;
  }
  return value;
}

function deepMerge(base, patch) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && v.seconds === undefined
      && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function applyOp(op, broadcast) {
  if (op.type === 'set') {
    const prev = store.get(op.path);
    store.set(op.path, op.merge && prev ? deepMerge(prev, op.data) : op.data);
  } else if (op.type === 'delete') {
    store.delete(op.path);
  }
  if (broadcast && channel) channel.postMessage(op);
  for (const l of Array.from(listeners)) l(op.path);
}

if (channel) {
  channel.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'sync-request') {
      channel.postMessage({ type: 'sync-response', entries: Array.from(store.entries()) });
    } else if (msg.type === 'sync-response') {
      for (const [path, data] of msg.entries) {
        if (!store.has(path)) applyOp({ type: 'set', path, data }, false);
      }
    } else {
      applyOp(msg, false);
    }
  };
  // Una scheda appena aperta chiede alle altre lo stato corrente.
  channel.postMessage({ type: 'sync-request' });
}

if (typeof window !== 'undefined') {
  window.__fakeFirestore = {
    store,
    get: (path) => store.get(path),
    list: (prefix) => Array.from(store.entries()).filter(([p]) => p.startsWith(prefix)),
  };
}

// ----- app -----
export function initializeApp(config) {
  return { name: '[DEFAULT]', options: config };
}

// ----- auth -----
const AUTH_KEY = 'fake-auth-user';
const auth = { currentUser: null, listeners: new Set() };
try {
  const saved = localStorage.getItem(AUTH_KEY);
  if (saved) auth.currentUser = JSON.parse(saved);
} catch {
  /* ignora */
}

function setUser(user) {
  auth.currentUser = user;
  try {
    if (user) localStorage.setItem(AUTH_KEY, JSON.stringify(user));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignora */
  }
  for (const cb of auth.listeners) cb(user);
}

export function getAuth() {
  return auth;
}
export function onAuthStateChanged(_auth, cb) {
  auth.listeners.add(cb);
  setTimeout(() => cb(auth.currentUser), 0);
  return () => auth.listeners.delete(cb);
}
export async function signInWithEmailAndPassword(_auth, email, password) {
  if (!email.includes('@')) throw Object.assign(new Error('bad email'), { code: 'auth/invalid-email' });
  if (password === 'wrong') throw Object.assign(new Error('bad'), { code: 'auth/invalid-credential' });
  setUser({ uid: 'uid-' + email.replace(/\W/g, ''), email });
  return { user: auth.currentUser };
}
export async function createUserWithEmailAndPassword(_auth, email, password) {
  if (password.length < 6) throw Object.assign(new Error('weak'), { code: 'auth/weak-password' });
  return signInWithEmailAndPassword(_auth, email, password);
}
export async function sendPasswordResetEmail() {}
export async function signOut() {
  setUser(null);
}

// ----- firestore -----
class DocRef {
  constructor(path) {
    this.path = path;
    this.id = path.split('/').pop();
    this.type = 'document';
  }
}
class ColRef {
  constructor(path) {
    this.path = path;
    this.id = path.split('/').pop();
    this.type = 'collection';
  }
}

function joinPath(parent, segs) {
  const base = parent && typeof parent === 'object' && 'path' in parent ? parent.path : '';
  return [base, ...segs].filter(Boolean).join('/');
}

export function getFirestore() {
  return { type: 'firestore' };
}
export function collection(parent, ...segs) {
  return new ColRef(joinPath(parent, segs));
}
export function doc(parent, ...segs) {
  if (parent instanceof ColRef && segs.length === 0) return new DocRef(parent.path + '/' + randomId());
  return new DocRef(joinPath(parent, segs));
}
export function serverTimestamp() {
  return { [SERVER_TS]: true };
}

function clone(data) {
  return JSON.parse(JSON.stringify(resolveValues(data)));
}

export async function setDoc(ref, data, opts) {
  applyOp({ type: 'set', path: ref.path, data: clone(data), merge: !!opts?.merge }, true);
}
export async function updateDoc(ref, data) {
  if (!store.has(ref.path)) throw new Error(`No document to update: ${ref.path}`);
  applyOp({ type: 'set', path: ref.path, data: clone(data), merge: true }, true);
}
export async function addDoc(col, data) {
  const ref = doc(col);
  await setDoc(ref, data);
  return ref;
}
export async function deleteDoc(ref) {
  applyOp({ type: 'delete', path: ref.path }, true);
}

export function query(col, ...constraints) {
  return { col, constraints };
}
export function where(field, op, value) {
  return { type: 'where', field, op, value };
}
export function orderBy(field, dir = 'asc') {
  return { type: 'orderBy', field, dir };
}
export function limit(n) {
  return { type: 'limit', n };
}

function getField(data, field) {
  return field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
}

function matches(target) {
  const col = target instanceof ColRef ? target : target.col;
  const constraints = target instanceof ColRef ? [] : target.constraints;
  let docs = [];
  for (const [path, data] of store.entries()) {
    if (path.slice(0, path.lastIndexOf('/')) !== col.path) continue;
    docs.push({ path, data });
  }
  for (const c of constraints) {
    if (c.type === 'where') {
      docs = docs.filter(({ data }) => {
        const v = getField(data, c.field);
        if (c.op === '==') return v === c.value;
        if (c.op === '!=') return v !== c.value;
        if (c.op === '>') return v > c.value;
        if (c.op === '>=') return v >= c.value;
        if (c.op === '<') return v < c.value;
        if (c.op === '<=') return v <= c.value;
        return true;
      });
    }
  }
  for (const c of constraints) {
    if (c.type === 'orderBy') {
      const m = c.dir === 'desc' ? -1 : 1;
      docs.sort((a, b) => {
        const va = getField(a.data, c.field);
        const vb = getField(b.data, c.field);
        return va < vb ? -m : va > vb ? m : 0;
      });
    }
  }
  for (const c of constraints) if (c.type === 'limit') docs = docs.slice(0, c.n);
  return docs;
}

function docSnap(path, data) {
  return {
    id: path.split('/').pop(),
    ref: new DocRef(path),
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))),
    metadata: { hasPendingWrites: false, fromCache: false },
  };
}

function querySnap(docs, changes) {
  const snaps = docs.map(({ path, data }) => docSnap(path, data));
  return {
    docs: snaps,
    size: snaps.length,
    empty: snaps.length === 0,
    forEach: (fn) => snaps.forEach(fn),
    docChanges: () => changes,
  };
}

export async function getDocs(target) {
  const docs = matches(target);
  return querySnap(docs, docs.map(({ path, data }) => ({ type: 'added', doc: docSnap(path, data) })));
}

export function onSnapshot(target, next, error) {
  if (target instanceof DocRef) {
    const emit = () => {
      try {
        next(docSnap(target.path, store.get(target.path)));
      } catch (err) {
        console.error(err);
      }
    };
    const l = (path) => {
      if (path === target.path) emit();
    };
    listeners.add(l);
    setTimeout(emit, 0);
    return () => listeners.delete(l);
  }
  const col = target instanceof ColRef ? target : target.col;
  let prev = new Map();
  const emit = () => {
    const docs = matches(target);
    const changes = [];
    const nextMap = new Map();
    for (const { path, data } of docs) {
      const json = JSON.stringify(data);
      nextMap.set(path, json);
      if (!prev.has(path)) changes.push({ type: 'added', doc: docSnap(path, data) });
      else if (prev.get(path) !== json) changes.push({ type: 'modified', doc: docSnap(path, data) });
    }
    for (const path of prev.keys()) {
      if (!nextMap.has(path)) changes.push({ type: 'removed', doc: docSnap(path, undefined) });
    }
    const first = prev.size === 0 && !emit.done;
    emit.done = true;
    prev = nextMap;
    if (!changes.length && !first) return;
    try {
      next(querySnap(docs, changes));
    } catch (err) {
      if (error) error(err);
      else console.error(err);
    }
  };
  const l = (path) => {
    if (path.startsWith(col.path + '/')) emit();
  };
  listeners.add(l);
  setTimeout(emit, 0);
  return () => listeners.delete(l);
}
