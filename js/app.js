// Bootstrap: configurazione → Firebase → auth → router hash-based.
import { loadFirebaseConfig } from './config.js';
import { initFirebase, auth, A } from './firebase.js';
import { renderSetup } from './views/setup.js';
import { renderAuth } from './views/auth.js';
import { renderHome } from './views/home.js';
import { renderCamera } from './views/camera.js';
import { renderViewer } from './views/viewer.js';
import { $, toast, escapeHtml } from './ui.js';
import { unlockAudio, registerServiceWorker } from './alerts.js';

const appEl = $('#app');
const topRight = $('#topbar-right');
let cleanup = null;
let user; // undefined = stato auth non ancora noto
let firebaseReady = false;
let initError = null;

function mount(renderFn, opts) {
  if (cleanup) {
    try {
      cleanup();
    } catch (err) {
      console.error(err);
    }
  }
  cleanup = null;
  appEl.innerHTML = '';
  const result = renderFn(appEl, opts);
  cleanup = typeof result === 'function' ? result : null;
  window.scrollTo(0, 0);
}

function renderLoading(root) {
  root.innerHTML = '<section class="view narrow"><div class="card center"><div class="spinner"></div><p class="muted">Connessione a Firebase…</p></div></section>';
}

function currentRoute() {
  return location.hash.replace(/^#\/?/, '').split('?')[0];
}

function renderTopbar() {
  const route = currentRoute();
  const roleBadge = route === 'camera' ? '<span class="badge role">📷 Camera</span>'
    : route === 'viewer' ? '<span class="badge role">📱 Visualizzatore</span>' : '';
  topRight.innerHTML = user
    ? `${roleBadge}<span class="user muted" title="${escapeHtml(user.email || '')}">${escapeHtml(user.email || '')}</span>
       <button id="btn-logout" class="btn small">Esci</button>`
    : (firebaseReady ? '' : '<a class="btn small" href="#/setup">Configura</a>');
  $('#btn-logout', topRight)?.addEventListener('click', async () => {
    if (route === 'camera' && !confirm('Uscendo il monitoraggio si ferma. Continuare?')) return;
    await A.signOut(auth);
    location.hash = '#/';
  });
}

function route() {
  const r = currentRoute();
  renderTopbar();
  if (r === 'setup' || !firebaseReady) return mount(renderSetup, { error: initError });
  if (user === undefined) return mount(renderLoading);
  if (!user) return mount(renderAuth);
  if (r === 'camera') return mount(renderCamera);
  if (r === 'viewer') return mount(renderViewer);
  return mount(renderHome);
}

async function boot() {
  const config = loadFirebaseConfig();
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  registerServiceWorker();

  if (!config) {
    route();
    window.addEventListener('hashchange', route);
    return;
  }
  mount(renderLoading);
  try {
    await initFirebase(config);
    firebaseReady = true;
  } catch (err) {
    console.error(err);
    // La configurazione salvata resta: l'errore è quasi sempre di rete, non di configurazione.
    initError = `Inizializzazione Firebase fallita: ${err.message}. Controlla la connessione e riprova.`;
    toast(initError, 'error', 8000);
  }
  if (firebaseReady) {
    A.onAuthStateChanged(auth, (u) => {
      const wasKnown = user !== undefined;
      user = u;
      if (!u && wasKnown && currentRoute() !== '') location.hash = '#/';
      route();
    });
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
