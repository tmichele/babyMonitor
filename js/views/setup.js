import {
  loadFirebaseConfig, hasWindowFirebaseConfig, parseFirebaseConfigInput, saveFirebaseConfig,
  clearFirebaseConfig, loadIceServers, parseIceServersInput, saveIceServers, DEFAULT_ICE_SERVERS,
} from '../config.js';
import { $, toast, escapeHtml } from '../ui.js';

export function renderSetup(root, { error = null } = {}) {
  const existing = loadFirebaseConfig();
  const fromFile = hasWindowFirebaseConfig();
  const ice = loadIceServers();
  root.innerHTML = `
  <section class="view narrow">
    <div class="card">
      <h2>Configurazione Firebase</h2>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <p class="muted">Camera e visualizzatore comunicano tramite un progetto Firebase tuo (Auth + Firestore).
      Nella <a href="https://console.firebase.google.com/" target="_blank" rel="noopener">console Firebase</a>:
      crea un progetto, abilita <b>Authentication → Email/Password</b>, crea un database <b>Firestore</b>
      e incolla qui la configurazione dell'app web (Impostazioni progetto → Le tue app → Configurazione SDK).</p>
      ${fromFile ? '<p class="ok">Configurazione caricata da <code>firebase-config.js</code>.</p>' : ''}
      <label>Configurazione app web (JSON o snippet JavaScript)
        <textarea id="cfg-input" rows="9" spellcheck="false" placeholder='{ "apiKey": "...", "authDomain": "...", "projectId": "...", "appId": "..." }'>${existing && !fromFile ? escapeHtml(JSON.stringify(existing, null, 2)) : ''}</textarea>
      </label>
      <details ${ice !== DEFAULT_ICE_SERVERS ? 'open' : ''}>
        <summary>Server ICE / TURN per il video (opzionale)</summary>
        <p class="muted">Di default si usano i server STUN di Google. Se camera e visualizzatore sono su reti diverse
        e il video non si connette, aggiungi un server TURN.</p>
        <textarea id="ice-input" rows="4" spellcheck="false">${escapeHtml(JSON.stringify(ice, null, 2))}</textarea>
      </details>
      <div class="actions">
        ${error ? '<button id="cfg-retry" class="btn primary">Riprova</button>' : ''}
        <button id="cfg-save" class="btn ${error ? '' : 'primary'}">Salva e continua</button>
        ${existing ? '<button id="cfg-clear" class="btn">Rimuovi configurazione salvata</button>' : ''}
      </div>
    </div>
  </section>`;

  $('#cfg-save', root).addEventListener('click', () => {
    try {
      const iceText = $('#ice-input', root).value;
      const iceList = parseIceServersInput(iceText);
      saveIceServers(iceList && JSON.stringify(iceList) !== JSON.stringify(DEFAULT_ICE_SERVERS) ? iceList : null);
      if (!fromFile) {
        const cfg = parseFirebaseConfigInput($('#cfg-input', root).value);
        saveFirebaseConfig(cfg);
      }
      toast('Configurazione salvata', 'ok');
      location.hash = '#/';
      location.reload();
    } catch (err) {
      toast(err.message, 'error', 6000);
    }
  });
  $('#cfg-retry', root)?.addEventListener('click', () => {
    location.hash = '#/';
    location.reload();
  });
  $('#cfg-clear', root)?.addEventListener('click', () => {
    clearFirebaseConfig();
    saveIceServers(null);
    location.reload();
  });
}
