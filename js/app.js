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
import { watchBattery, batteryLabel, batterySupported } from './battery.js';

const appEl = $('#app');
const topRight = $('#topbar-right');
const topbar = $('.topbar');
let view = null; // { cleanup, onRoute } della vista montata
let viewKey = null;
let user; // undefined = stato auth non ancora noto
let firebaseReady = false;
let initError = null;
let battery = null; // batteria di questo dispositivo

function unmount() {
  if (view?.cleanup) {
    try {
      view.cleanup();
    } catch (err) {
      console.error(err);
    }
  }
  view = null;
  viewKey = null;
}

/** Monta la vista `key`; se è già montata la lascia com'è (le sottopagine cambiano senza smontare). */
function mount(key, renderFn, sub = '', opts) {
  if (viewKey !== key) {
    unmount();
    appEl.innerHTML = '';
    const result = renderFn(appEl, opts);
    view = typeof result === 'function' ? { cleanup: result } : (result || {});
    viewKey = key;
    window.scrollTo(0, 0);
  }
  view.onRoute?.(sub);
}

function renderLoading(root) {
  root.innerHTML = '<section class="view narrow"><div class="card center"><div class="spinner"></div><p class="muted">Connessione a Firebase…</p></div></section>';
}

function parseRoute() {
  const [main = '', sub = ''] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  return { main, sub };
}
function currentRoute() {
  return parseRoute().main;
}

function renderTopbar() {
  const { main: route, sub } = parseRoute();
  const roleBadge = route === 'camera' ? '<span class="badge role">📷 Camera</span>'
    : route === 'viewer' ? '<span class="badge role">📱 Visualizzatore</span>' : '';
  const navIcon = (key, icon, label) => {
    const active = sub === key;
    return `<a class="icon-btn ${active ? 'active' : ''}" id="nav-${key}" href="#/${route}${active ? '' : `/${key}`}" title="${label}" aria-label="${label}" aria-pressed="${active}">${icon}</a>`;
  };
  const nav = user && (route === 'camera' || route === 'viewer')
    ? navIcon('events', '🕒', 'Eventi') + navIcon('settings', '⚙️', 'Impostazioni')
    : '';
  const batteryBadge = batterySupported()
    ? `<span class="badge battery ${battery && !battery.charging && battery.level <= 20 ? 'low' : ''}" id="topbar-battery" title="Batteria di questo dispositivo">${batteryLabel(battery)}</span>`
    : '';
  topRight.innerHTML = user
    ? `${roleBadge}${batteryBadge}${nav}<span class="user muted" title="${escapeHtml(user.email || '')}">${escapeHtml(user.email || '')}</span>
       <button id="btn-logout" class="btn small">Esci</button>`
    : (firebaseReady ? batteryBadge : '<a class="btn small" href="#/setup">Configura</a>');
  $('#btn-logout', topRight)?.addEventListener('click', async () => {
    if (route === 'camera' && !confirm('Uscendo il monitoraggio si ferma. Continuare?')) return;
    await A.signOut(auth);
    location.hash = '#/';
  });
}

function route() {
  const { main: r, sub } = parseRoute();
  renderTopbar();
  if (r === 'setup' || !firebaseReady) return mount('setup', renderSetup, '', { error: initError });
  if (user === undefined) return mount('loading', renderLoading);
  if (!user) return mount('auth', renderAuth);
  if (r === 'camera') return mount('camera', renderCamera, sub);
  if (r === 'viewer') return mount('viewer', renderViewer, sub);
  return mount('home', renderHome);
}

async function boot() {
  const config = loadFirebaseConfig();
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  registerServiceWorker();
  // Altezza della barra, usata dalle sottopagine per posizionarsi sotto di essa.
  const setTopbarHeight = () => document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
  setTopbarHeight();
  if ('ResizeObserver' in window) new ResizeObserver(setTopbarHeight).observe(topbar);
  watchBattery((b) => {
    battery = b;
    renderTopbar();
  });

  if (!config) {
    route();
    window.addEventListener('hashchange', route);
    return;
  }
  mount('loading', renderLoading);
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
      unmount(); // cambio utente: la vista va ricostruita
      if (!u && wasKnown && currentRoute() !== '') location.hash = '#/';
      route();
    });
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
