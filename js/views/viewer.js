// Ruolo visualizzatore: elenco camere, livelli in tempo reale, eventi, video in diretta,
// avvisi locali e regolazione remota della sensibilità.
import { S, camerasCol, cameraDoc, eventsCol, callsCol, tsToMillis } from '../firebase.js';
import { MOTION_LABELS, CRY_LABELS, normalizeSettings, scaledThresholds } from '../detection/levels.js';
import { ViewerStream } from '../rtc.js';
import { getDeviceId, prefs } from '../config.js';
import { $, $$, toast, escapeHtml, formatTime, formatAgo, setLevel, setMeter, levelCardHtml } from '../ui.js';
import { beep, vibrate, notify, requestNotifications, notificationsSupported, unlockAudio, WakeLockKeeper } from '../alerts.js';

const OFFLINE_AFTER_MS = 60000;

const DEFAULT_PREFS = {
  alertMotionLevel: 2,
  alertCryLevel: 2,
  sound: true,
  vibration: true,
  offlineAlert: true,
  keepAwake: false,
};

export function renderViewer(root) {
  const viewerPrefs = { ...DEFAULT_PREFS, ...(prefs.getViewerPrefs() || {}) };

  root.innerHTML = `
  <section class="view viewer-view">
    <div class="card">
      <h3>Camere</h3>
      <div id="cam-list" class="cam-list"><p class="muted">Caricamento…</p></div>
    </div>

    <div id="cam-detail" hidden>
      <div id="alert-banner" class="alert-banner" hidden></div>
      <div class="card">
        <div class="detail-head">
          <h2 id="d-name">—</h2>
          <span id="d-status" class="badge off">offline</span>
        </div>
        <p class="muted small" id="d-seen"></p>
      </div>
      <div class="grid-2">
        ${levelCardHtml('motion', 'Movimento', '🏃')}
        ${levelCardHtml('cry', 'Pianto', '🔊')}
      </div>

      <div class="card">
        <h3>Video in diretta</h3>
        <div class="preview">
          <video id="v-video" autoplay playsinline></video>
          <div id="v-conn" class="badge off">Non connesso</div>
        </div>
        <div class="actions">
          <button id="v-start" class="btn primary big">▶ Avvia video</button>
          <button id="v-stop" class="btn danger big" hidden>■ Ferma video</button>
          <button id="v-mute" class="btn" hidden>🔈 Audio attivo</button>
        </div>
      </div>

      <div class="card">
        <h3>Avvisi su questo dispositivo</h3>
        <div class="row">
          <label class="grow">Movimento da livello
            <select id="p-motion">${levelOptions(MOTION_LABELS)}</select></label>
          <label class="grow">Pianto da livello
            <select id="p-cry">${levelOptions(CRY_LABELS)}</select></label>
        </div>
        <label class="check"><input type="checkbox" id="p-sound"> Suono</label>
        <label class="check"><input type="checkbox" id="p-vibration"> Vibrazione</label>
        <label class="check"><input type="checkbox" id="p-offline"> Avvisa se la camera va offline</label>
        <label class="check"><input type="checkbox" id="p-awake"> Tieni lo schermo acceso</label>
        <div class="actions">
          <button id="p-notify" class="btn">🔔 Abilita notifiche</button>
          <button id="p-test" class="btn">Prova avviso</button>
        </div>
      </div>

      <div class="card">
        <h3>Sensibilità della camera (remoto)</h3>
        <label class="range">Movimento <span id="r-motion-v"></span>
          <input type="range" id="r-motion" min="1" max="10" step="1"></label>
        <label class="range">Pianto <span id="r-cry-v"></span>
          <input type="range" id="r-cry" min="1" max="10" step="1"></label>
        <label>Registra eventi da livello
          <select id="r-minlevel">
            <option value="1">1 · Leggero / Rumore</option>
            <option value="2">2 · Moderato / Lamento</option>
            <option value="3">3 · Intenso / Pianto</option>
          </select>
        </label>
        <div class="actions"><button id="r-save" class="btn primary">Invia alla camera</button></div>
        <p class="muted small" id="r-thresholds"></p>
      </div>

      <div class="card">
        <h3>Eventi</h3>
        <ul id="v-events" class="events"><li class="muted">Nessun evento.</li></ul>
      </div>
    </div>
  </section>`;

  const el = {
    list: $('#cam-list', root),
    detail: $('#cam-detail', root),
    banner: $('#alert-banner', root),
    name: $('#d-name', root),
    status: $('#d-status', root),
    seen: $('#d-seen', root),
    video: $('#v-video', root),
    conn: $('#v-conn', root),
    vStart: $('#v-start', root),
    vStop: $('#v-stop', root),
    vMute: $('#v-mute', root),
    pMotion: $('#p-motion', root),
    pCry: $('#p-cry', root),
    pSound: $('#p-sound', root),
    pVibration: $('#p-vibration', root),
    pOffline: $('#p-offline', root),
    pAwake: $('#p-awake', root),
    pNotify: $('#p-notify', root),
    pTest: $('#p-test', root),
    rMotion: $('#r-motion', root),
    rMotionV: $('#r-motion-v', root),
    rCry: $('#r-cry', root),
    rCryV: $('#r-cry-v', root),
    rMinLevel: $('#r-minlevel', root),
    rSave: $('#r-save', root),
    rThresholds: $('#r-thresholds', root),
    events: $('#v-events', root),
    motion: { bar: $('#motion-bar', root), label: $('#motion-label', root), meter: $('#motion-meter', root), score: $('#motion-score', root), card: $('#motion-card', root) },
    cry: { bar: $('#cry-bar', root), label: $('#cry-label', root), meter: $('#cry-meter', root), score: $('#cry-score', root), card: $('#cry-card', root) },
  };

  const state = {
    cameras: new Map(),
    selectedId: prefs.getSelectedCamera(),
    unsubList: null,
    unsubDoc: null,
    unsubEvents: null,
    stream: null,
    lastAlert: { motion: 0, cry: 0 },
    wasOnline: null,
    staleTimer: null,
    bannerTimer: null,
    remoteSettings: null,
    remoteDirty: false,
    wakeLock: new WakeLockKeeper(),
  };

  // ----- preferenze avvisi -----
  function applyPrefsToUi() {
    el.pMotion.value = String(viewerPrefs.alertMotionLevel);
    el.pCry.value = String(viewerPrefs.alertCryLevel);
    el.pSound.checked = !!viewerPrefs.sound;
    el.pVibration.checked = !!viewerPrefs.vibration;
    el.pOffline.checked = !!viewerPrefs.offlineAlert;
    el.pAwake.checked = !!viewerPrefs.keepAwake;
    el.pNotify.hidden = !notificationsSupported();
    if (notificationsSupported() && Notification.permission === 'granted') el.pNotify.textContent = '🔔 Notifiche attive';
    if (viewerPrefs.keepAwake) state.wakeLock.request();
    else state.wakeLock.release();
  }
  function savePrefs() {
    viewerPrefs.alertMotionLevel = Number(el.pMotion.value);
    viewerPrefs.alertCryLevel = Number(el.pCry.value);
    viewerPrefs.sound = el.pSound.checked;
    viewerPrefs.vibration = el.pVibration.checked;
    viewerPrefs.offlineAlert = el.pOffline.checked;
    viewerPrefs.keepAwake = el.pAwake.checked;
    prefs.setViewerPrefs(viewerPrefs);
    applyPrefsToUi();
  }
  [el.pMotion, el.pCry, el.pSound, el.pVibration, el.pOffline, el.pAwake].forEach((i) => i.addEventListener('change', savePrefs));
  el.pNotify.addEventListener('click', async () => {
    const res = await requestNotifications();
    if (res === 'granted') toast('Notifiche abilitate', 'ok');
    else toast('Notifiche non abilitate', 'error');
    applyPrefsToUi();
  });
  el.pTest.addEventListener('click', () => fireAlert('cry', 3, 'Prova avviso', true));
  applyPrefsToUi();

  // ----- avvisi -----
  function fireAlert(type, level, message, force = false) {
    if (!force && level <= state.lastAlert[type]) return;
    state.lastAlert[type] = level;
    const title = type === 'cry' ? `Pianto: ${CRY_LABELS[level]}` : type === 'motion' ? `Movimento: ${MOTION_LABELS[level]}` : 'Baby Monitor';
    showBanner(`${title} · ${message}`, level >= 3 ? 'danger' : 'warn');
    if (viewerPrefs.sound) {
      if (type === 'cry') beep({ count: 3, freq: 988, duration: 0.18, gap: 0.09 });
      else if (type === 'motion') beep({ count: 2, freq: 740 });
      else beep({ count: 4, freq: 440, duration: 0.25, gap: 0.12 });
    }
    if (viewerPrefs.vibration) vibrate(type === 'cry' ? [300, 100, 300, 100, 300] : [200, 100, 200]);
    notify(title, message);
  }

  function showBanner(text, kind) {
    el.banner.textContent = text;
    el.banner.className = `alert-banner ${kind}`;
    el.banner.hidden = false;
    if (state.bannerTimer) clearTimeout(state.bannerTimer);
    state.bannerTimer = setTimeout(() => {
      el.banner.hidden = true;
    }, 15000);
  }

  // ----- elenco camere -----
  function isOnline(data, now = Date.now()) {
    const seen = tsToMillis(data.lastSeen);
    return data.status === 'online' && data.monitoring !== false && seen != null && now - seen < OFFLINE_AFTER_MS;
  }

  function renderList() {
    const cams = Array.from(state.cameras.entries());
    if (!cams.length) {
      el.list.innerHTML = '<p class="muted">Nessuna camera registrata. Apri l\'app su un altro dispositivo con lo stesso account e scegli "Camera".</p>';
      return;
    }
    const now = Date.now();
    el.list.innerHTML = cams.map(([id, d]) => {
      const online = isOnline(d, now);
      return `<button class="cam-item ${id === state.selectedId ? 'selected' : ''}" data-id="${escapeHtml(id)}">
        <span class="cam-dot ${online ? 'on' : 'off'}" aria-hidden="true"></span>
        <span class="cam-name">${escapeHtml(d.name || 'Camera')}</span>
        <span class="cam-meta muted">${online ? 'online' : `offline · ${formatAgo(tsToMillis(d.lastSeen), now)}`}</span>
        <span class="chips">
          <span class="chip" data-level="${online ? d.motion?.level || 0 : 0}">🏃 ${MOTION_LABELS[online ? d.motion?.level || 0 : 0]}</span>
          <span class="chip" data-level="${online ? d.cry?.level || 0 : 0}">🔊 ${CRY_LABELS[online ? d.cry?.level || 0 : 0]}</span>
        </span>
      </button>`;
    }).join('');
    $$('.cam-item', el.list).forEach((b) => b.addEventListener('click', () => selectCamera(b.dataset.id)));
  }

  state.unsubList = S.onSnapshot(camerasCol(), (snap) => {
    state.cameras.clear();
    snap.forEach((d) => state.cameras.set(d.id, d.data()));
    renderList();
    if (state.selectedId && state.cameras.has(state.selectedId)) {
      if (!state.unsubDoc) selectCamera(state.selectedId);
    } else if (!state.selectedId && state.cameras.size === 1) {
      selectCamera(state.cameras.keys().next().value);
    }
  }, (err) => toast(`Errore Firestore: ${err.message}`, 'error', 6000));

  // ----- dettaglio -----
  function selectCamera(id) {
    if (state.selectedId !== id) stopStream();
    state.selectedId = id;
    prefs.setSelectedCamera(id);
    state.lastAlert = { motion: 0, cry: 0 };
    state.wasOnline = null;
    state.remoteDirty = false;
    renderList();
    el.detail.hidden = false;
    state.unsubDoc?.();
    state.unsubEvents?.();
    state.unsubDoc = S.onSnapshot(cameraDoc(id), (snap) => {
      if (!snap.exists()) {
        el.name.textContent = 'Camera rimossa';
        return;
      }
      updateDetail(snap.data());
    });
    state.unsubEvents = S.onSnapshot(
      S.query(eventsCol(id), S.orderBy('tsLocal', 'desc'), S.limit(50)),
      (snap) => renderEvents(snap.docs.map((d) => d.data())),
      (err) => console.error(err),
    );
    if (state.staleTimer) clearInterval(state.staleTimer);
    state.staleTimer = setInterval(() => {
      const d = state.cameras.get(state.selectedId);
      if (d) updateDetail(d);
      renderList();
    }, 10000);
  }

  function updateDetail(d) {
    const now = Date.now();
    const online = isOnline(d, now);
    el.name.textContent = d.name || 'Camera';
    el.status.textContent = online ? 'online' : 'offline';
    el.status.className = `badge ${online ? 'on' : 'off'}`;
    el.seen.textContent = `Ultimo segnale: ${formatAgo(tsToMillis(d.lastSeen), now)}`;

    const motion = online ? d.motion || { score: 0, level: 0 } : { score: 0, level: 0 };
    const cry = online ? d.cry || { score: 0, level: 0 } : { score: 0, level: 0 };
    const settings = normalizeSettings(d.settings);
    const mThr = scaledThresholds(settings.motionThresholds, settings.motionSensitivity);

    setLevel(el.motion.bar, el.motion.label, motion.level, MOTION_LABELS);
    el.motion.card.dataset.level = motion.level;
    setMeter(el.motion.meter, Math.min(100, ((motion.score || 0) / mThr[2]) * 75));
    el.motion.score.textContent = `${Number(motion.score || 0).toFixed(1)} % pixel in movimento`;

    setLevel(el.cry.bar, el.cry.label, cry.level, CRY_LABELS);
    el.cry.card.dataset.level = cry.level;
    setMeter(el.cry.meter, cry.score || 0);
    el.cry.score.textContent = `punteggio ${Math.round(cry.score || 0)}`;

    if (online) {
      if (motion.level >= viewerPrefs.alertMotionLevel) fireAlert('motion', motion.level, `${d.name || 'Camera'} · ${formatTime(now)}`);
      else if (motion.level < viewerPrefs.alertMotionLevel) state.lastAlert.motion = 0;
      if (cry.level >= viewerPrefs.alertCryLevel) fireAlert('cry', cry.level, `${d.name || 'Camera'} · ${formatTime(now)}`);
      else if (cry.level < viewerPrefs.alertCryLevel) state.lastAlert.cry = 0;
    }

    if (state.wasOnline === true && !online && viewerPrefs.offlineAlert) {
      fireAlert('offline', 3, `${d.name || 'Camera'} non risponde più`, true);
    } else if (state.wasOnline === false && online) {
      showBanner(`${d.name || 'Camera'} è di nuovo online`, 'ok');
    }
    state.wasOnline = online;

    if (!state.remoteDirty && JSON.stringify(settings) !== JSON.stringify(state.remoteSettings)) {
      state.remoteSettings = settings;
      el.rMotion.value = settings.motionSensitivity;
      el.rCry.value = settings.crySensitivity;
      el.rMinLevel.value = String(settings.eventMinLevel);
      updateRemoteLabels();
    }
    el.vStart.disabled = !online;
  }

  function renderEvents(events) {
    if (!events.length) {
      el.events.innerHTML = '<li class="muted">Nessun evento.</li>';
      return;
    }
    el.events.innerHTML = events.map((e) => (
      `<li data-level="${e.level}"><span class="ev-time">${formatTime(tsToMillis(e.ts) || e.tsLocal)}</span>
        <span class="ev-type">${e.type === 'motion' ? '🏃 Movimento' : '🔊 Pianto'}</span>
        <span class="ev-label">${escapeHtml(e.label || '')} (liv. ${e.level})</span></li>`
    )).join('');
  }

  // ----- sensibilità remota -----
  function updateRemoteLabels() {
    el.rMotionV.textContent = el.rMotion.value;
    el.rCryV.textContent = el.rCry.value;
    const base = state.remoteSettings || normalizeSettings(null);
    const mt = scaledThresholds(base.motionThresholds, el.rMotion.value).map((t) => t.toFixed(1));
    const ct = scaledThresholds(base.cryThresholds, el.rCry.value).map((t) => t.toFixed(0));
    el.rThresholds.textContent = `Soglie movimento (% pixel): ${mt.join(' / ')} · soglie pianto (punteggio): ${ct.join(' / ')}`;
  }
  [el.rMotion, el.rCry, el.rMinLevel].forEach((i) => i.addEventListener('input', () => {
    state.remoteDirty = true;
    updateRemoteLabels();
  }));
  el.rSave.addEventListener('click', async () => {
    if (!state.selectedId) return;
    const settings = normalizeSettings({
      ...(state.remoteSettings || {}),
      motionSensitivity: el.rMotion.value,
      crySensitivity: el.rCry.value,
      eventMinLevel: el.rMinLevel.value,
    });
    try {
      await S.setDoc(cameraDoc(state.selectedId), { settings }, { merge: true });
      state.remoteSettings = settings;
      state.remoteDirty = false;
      toast('Impostazioni inviate alla camera', 'ok');
    } catch (err) {
      toast(`Invio fallito: ${err.message}`, 'error');
    }
  });
  updateRemoteLabels();

  // ----- video -----
  const CONN_LABELS = {
    idle: ['Non connesso', 'off'],
    requesting: ['Richiesta inviata…', 'wait'],
    connecting: ['Connessione…', 'wait'],
    connected: ['In diretta', 'on'],
    disconnected: ['Segnale perso…', 'wait'],
    error: ['Errore', 'off'],
  };
  function setConn(status, message) {
    const [label, cls] = CONN_LABELS[status] || CONN_LABELS.idle;
    el.conn.textContent = label;
    el.conn.className = `badge ${cls}`;
    const active = status !== 'idle' && status !== 'error';
    el.vStart.hidden = active;
    el.vStop.hidden = !active;
    el.vMute.hidden = status !== 'connected';
    if (status === 'error' && message) toast(message, 'error', 6000);
    if (status === 'error' || status === 'idle') state.stream = null;
  }

  async function startStream() {
    if (!state.selectedId || state.stream) return;
    unlockAudio();
    el.video.muted = false;
    state.stream = new ViewerStream({
      callsRef: callsCol(state.selectedId),
      videoEl: el.video,
      viewerId: getDeviceId(),
      onStatus: setConn,
    });
    try {
      await state.stream.start();
    } catch (err) {
      setConn('error', err.message);
    }
  }
  function stopStream() {
    state.stream?.stop();
    state.stream = null;
    setConn('idle');
  }
  el.vStart.addEventListener('click', startStream);
  el.vStop.addEventListener('click', stopStream);
  el.vMute.addEventListener('click', () => {
    el.video.muted = !el.video.muted;
    el.vMute.textContent = el.video.muted ? '🔇 Audio disattivato' : '🔈 Audio attivo';
  });

  if (state.selectedId && !state.cameras.has(state.selectedId)) {
    // Verrà selezionata appena arriva l'elenco.
  }

  return () => {
    stopStream();
    state.unsubList?.();
    state.unsubDoc?.();
    state.unsubEvents?.();
    if (state.staleTimer) clearInterval(state.staleTimer);
    if (state.bannerTimer) clearTimeout(state.bannerTimer);
    state.wakeLock.destroy();
  };
}

function levelOptions(labels) {
  return [1, 2, 3].map((l) => `<option value="${l}">${l} · ${labels[l]}</option>`).join('');
}
