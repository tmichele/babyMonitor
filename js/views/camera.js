// Ruolo camera: cattura audio/video, rileva movimento e pianto, pubblica stato ed eventi,
// trasmette il video ai visualizzatori che lo richiedono.
import { S, cameraDoc, eventsCol, callsCol } from '../firebase.js';
import { MotionDetector } from '../detection/motion.js';
import { CryDetector } from '../detection/cry.js';
import {
  MOTION_LABELS, CRY_LABELS, LevelTracker, scoreToLevel, scaledThresholds,
  normalizeSettings, settingsEqual, shouldLogEvent, DEFAULT_SETTINGS,
} from '../detection/levels.js';
import { CameraStreamer } from '../rtc.js';
import { getDeviceId, getDeviceName, setDeviceName, prefs } from '../config.js';
import { $, toast, throttle, escapeHtml, formatTime, setLevel, setMeter, levelCardHtml } from '../ui.js';
import { WakeLockKeeper } from '../alerts.js';

const HEARTBEAT_MS = 20000;
const STATE_PUBLISH_MS = 1500;

function randomSessionId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function renderCamera(root) {
  const cameraId = getDeviceId();
  let settings = normalizeSettings(prefs.getCameraSettings());

  root.innerHTML = `
  <section class="view camera-view">
    <div class="card">
      <div class="row">
        <label class="grow">Nome camera <input id="cam-name" maxlength="40" value="${escapeHtml(getDeviceName())}"></label>
        <label class="grow">Videocamera <select id="cam-source"><option value="">Predefinita (posteriore)</option></select></label>
      </div>
      <div class="preview">
        <video id="cam-video" autoplay muted playsinline></video>
        <canvas id="cam-overlay" class="overlay"></canvas>
        <div id="cam-status" class="badge off">Non attiva</div>
        <div id="cam-viewers" class="badge viewers" hidden></div>
      </div>
      <div class="actions">
        <button id="cam-start" class="btn primary big">▶ Avvia monitoraggio</button>
        <button id="cam-stop" class="btn danger big" hidden>■ Ferma</button>
        <button id="cam-dark" class="btn" hidden>🌙 Schermo scuro</button>
      </div>
      <p class="muted small">Il monitoraggio continua solo con questa scheda in primo piano. Lo schermo viene tenuto acceso; usa "Schermo scuro" di notte.</p>
    </div>

    <div class="grid-2">
      ${levelCardHtml('motion', 'Movimento', '🏃')}
      ${levelCardHtml('cry', 'Pianto', '🔊')}
    </div>

    <div class="card">
      <h3>Sensibilità</h3>
      <label class="range">Movimento <span id="set-motion-v"></span>
        <input type="range" id="set-motion" min="1" max="10" step="1"></label>
      <label class="range">Pianto <span id="set-cry-v"></span>
        <input type="range" id="set-cry" min="1" max="10" step="1"></label>
      <label>Registra eventi da livello
        <select id="set-minlevel">
          <option value="1">1 · Leggero / Rumore</option>
          <option value="2">2 · Moderato / Lamento</option>
          <option value="3">3 · Intenso / Pianto</option>
        </select>
      </label>
      <p class="muted small">Le impostazioni si possono cambiare anche dal visualizzatore.</p>
      <p class="muted small" id="cam-thresholds"></p>
    </div>

    <div class="card">
      <h3>Eventi recenti</h3>
      <ul id="cam-events" class="events"><li class="muted">Nessun evento.</li></ul>
    </div>
  </section>
  <div id="dark-screen" class="dark-screen" hidden>
    <div class="dark-content">
      <div class="dark-levels"><span id="dark-motion">Fermo</span> · <span id="dark-cry">Silenzio</span></div>
      <p>Tocca per riaccendere lo schermo</p>
    </div>
  </div>`;

  const el = {
    name: $('#cam-name', root),
    source: $('#cam-source', root),
    video: $('#cam-video', root),
    overlay: $('#cam-overlay', root),
    status: $('#cam-status', root),
    viewers: $('#cam-viewers', root),
    start: $('#cam-start', root),
    stop: $('#cam-stop', root),
    dark: $('#cam-dark', root),
    darkScreen: $('#dark-screen', root),
    darkMotion: $('#dark-motion', root),
    darkCry: $('#dark-cry', root),
    events: $('#cam-events', root),
    setMotion: $('#set-motion', root),
    setMotionV: $('#set-motion-v', root),
    setCry: $('#set-cry', root),
    setCryV: $('#set-cry-v', root),
    setMinLevel: $('#set-minlevel', root),
    thresholds: $('#cam-thresholds', root),
    motion: { bar: $('#motion-bar', root), label: $('#motion-label', root), meter: $('#motion-meter', root), score: $('#motion-score', root), card: $('#motion-card', root) },
    cry: { bar: $('#cry-bar', root), label: $('#cry-label', root), meter: $('#cry-meter', root), score: $('#cry-score', root), card: $('#cry-card', root) },
  };

  const state = {
    running: false,
    sessionId: null,
    stream: null,
    motionDet: null,
    cryDet: null,
    streamer: null,
    heartbeat: null,
    unsubDoc: null,
    motionTracker: new LevelTracker({ holdMs: settings.holdMs }),
    cryTracker: new LevelTracker({ holdMs: settings.holdMs }),
    motion: { score: 0, level: 0 },
    cry: { score: 0, level: 0 },
    lastEvent: { motion: null, cry: null },
    localEvents: [],
    wakeLock: new WakeLockKeeper(),
  };

  const docRef = () => cameraDoc(cameraId);

  // ----- impostazioni -----
  function applySettingsToUi() {
    el.setMotion.value = settings.motionSensitivity;
    el.setMotionV.textContent = settings.motionSensitivity;
    el.setCry.value = settings.crySensitivity;
    el.setCryV.textContent = settings.crySensitivity;
    el.setMinLevel.value = String(settings.eventMinLevel);
    state.motionTracker.holdMs = settings.holdMs;
    state.cryTracker.holdMs = settings.holdMs;
    const mt = scaledThresholds(settings.motionThresholds, settings.motionSensitivity).map((t) => t.toFixed(1));
    const ct = scaledThresholds(settings.cryThresholds, settings.crySensitivity).map((t) => t.toFixed(0));
    el.thresholds.textContent = `Soglie movimento (% pixel): ${mt.join(' / ')} · soglie pianto (punteggio): ${ct.join(' / ')}`;
  }

  const persistSettings = throttle(async () => {
    prefs.setCameraSettings(settings);
    if (!state.running) return;
    try {
      await S.setDoc(docRef(), { settings }, { merge: true });
    } catch (err) {
      console.error(err);
    }
  }, 600);

  function onSettingsInput() {
    settings = normalizeSettings({
      ...settings,
      motionSensitivity: el.setMotion.value,
      crySensitivity: el.setCry.value,
      eventMinLevel: el.setMinLevel.value,
    });
    applySettingsToUi();
    persistSettings();
  }
  el.setMotion.addEventListener('input', onSettingsInput);
  el.setCry.addEventListener('input', onSettingsInput);
  el.setMinLevel.addEventListener('change', onSettingsInput);
  applySettingsToUi();

  el.name.addEventListener('change', () => {
    setDeviceName(el.name.value);
    el.name.value = getDeviceName();
    if (state.running) S.setDoc(docRef(), { name: getDeviceName() }, { merge: true }).catch(() => {});
  });

  // ----- sorgenti video -----
  async function refreshSources() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const current = prefs.getVideoSource() || '';
      const videos = devices.filter((d) => d.kind === 'videoinput');
      el.source.innerHTML = '<option value="">Predefinita (posteriore)</option>' + videos.map((d, i) => (
        `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || `Videocamera ${i + 1}`)}</option>`
      )).join('');
      el.source.value = videos.some((d) => d.deviceId === current) ? current : '';
    } catch {
      /* ignora */
    }
  }
  el.source.addEventListener('change', async () => {
    prefs.setVideoSource(el.source.value || null);
    if (state.running) {
      try {
        await switchStream();
      } catch (err) {
        toast(`Impossibile cambiare videocamera: ${err.message}`, 'error');
      }
    }
  });
  refreshSources();

  function mediaConstraints() {
    const deviceId = prefs.getVideoSource();
    return {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } }
        : { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    };
  }

  async function openStream() {
    try {
      return await navigator.mediaDevices.getUserMedia(mediaConstraints());
    } catch (err) {
      if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') {
        prefs.setVideoSource(null);
        return navigator.mediaDevices.getUserMedia({ video: true, audio: mediaConstraints().audio });
      }
      throw err;
    }
  }

  async function switchStream() {
    const next = await openStream();
    const old = state.stream;
    state.stream = next;
    el.video.srcObject = next;
    state.streamer?.replaceStream(next);
    await restartCryDetector();
    old?.getTracks().forEach((t) => t.stop());
  }

  // ----- rilevazione -----
  function onMotion({ smoothed }) {
    const thr = scaledThresholds(settings.motionThresholds, settings.motionSensitivity);
    const level = state.motionTracker.update(scoreToLevel(smoothed, thr));
    const changed = level !== state.motion.level;
    state.motion = { score: Math.round(smoothed * 10) / 10, level };
    setLevel(el.motion.bar, el.motion.label, level, MOTION_LABELS);
    el.motion.card.dataset.level = level;
    setMeter(el.motion.meter, Math.min(100, (smoothed / thr[2]) * 75));
    el.motion.score.textContent = `${state.motion.score.toFixed(1)} % pixel in movimento`;
    el.darkMotion.textContent = MOTION_LABELS[level];
    maybeLogEvent('motion', level, state.motion.score);
    if (changed) publishStateNow();
    else publishState();
  }

  function onCry({ smoothed, db, bandRatio }) {
    const thr = scaledThresholds(settings.cryThresholds, settings.crySensitivity);
    const level = state.cryTracker.update(scoreToLevel(smoothed, thr));
    const changed = level !== state.cry.level;
    state.cry = { score: Math.round(smoothed), level };
    setLevel(el.cry.bar, el.cry.label, level, CRY_LABELS);
    el.cry.card.dataset.level = level;
    setMeter(el.cry.meter, smoothed);
    el.cry.score.textContent = `punteggio ${state.cry.score} · ${db > -99 ? db.toFixed(0) : '-∞'} dB · banda ${(bandRatio * 100).toFixed(0)} %`;
    el.darkCry.textContent = CRY_LABELS[level];
    maybeLogEvent('cry', level, state.cry.score);
    if (changed) publishStateNow();
    else publishState();
  }

  async function restartCryDetector() {
    await state.cryDet?.stop();
    state.cryDet = new CryDetector(state.stream, { onUpdate: onCry });
    try {
      await state.cryDet.start();
    } catch (err) {
      toast(`Audio non disponibile: ${err.message}`, 'error');
    }
  }

  // ----- Firestore -----
  function baseDoc() {
    return {
      name: getDeviceName(),
      deviceId: cameraId,
      sessionId: state.sessionId,
      status: 'online',
      monitoring: true,
      settings,
      lastSeen: S.serverTimestamp(),
      userAgent: navigator.userAgent.slice(0, 120),
    };
  }

  const publishState = throttle(() => publishStateNow(), STATE_PUBLISH_MS);
  async function publishStateNow() {
    if (!state.running) return;
    try {
      await S.setDoc(docRef(), {
        motion: state.motion,
        cry: state.cry,
        lastSeen: S.serverTimestamp(),
        updatedAt: Date.now(),
      }, { merge: true });
    } catch (err) {
      console.error('Pubblicazione stato fallita', err);
    }
  }

  async function maybeLogEvent(type, level, score) {
    const now = Date.now();
    const { log, next } = shouldLogEvent(state.lastEvent[type], level, now, settings);
    state.lastEvent[type] = next;
    if (!log) return;
    const label = type === 'motion' ? MOTION_LABELS[level] : CRY_LABELS[level];
    addLocalEvent({ type, level, label, at: now });
    try {
      await S.addDoc(eventsCol(cameraId), { type, level, score, label, ts: S.serverTimestamp(), tsLocal: now });
    } catch (err) {
      console.error('Evento non registrato', err);
    }
  }

  function addLocalEvent(ev) {
    state.localEvents.unshift(ev);
    state.localEvents = state.localEvents.slice(0, 20);
    el.events.innerHTML = state.localEvents.map((e) => (
      `<li data-level="${e.level}"><span class="ev-time">${formatTime(e.at)}</span>
        <span class="ev-type">${e.type === 'motion' ? '🏃 Movimento' : '🔊 Pianto'}</span>
        <span class="ev-label">${escapeHtml(e.label)} (liv. ${e.level})</span></li>`
    )).join('');
  }

  function listenRemoteSettings() {
    state.unsubDoc = S.onSnapshot(docRef(), (snap) => {
      if (snap.metadata.hasPendingWrites || !snap.exists()) return;
      const data = snap.data();
      if (data.sessionId && data.sessionId !== state.sessionId) {
        // Un'altra scheda/dispositivo ha avviato il monitoraggio con lo stesso id: questa si ferma
        // per non rispondere due volte alle richieste video.
        stop({ takenOver: true });
        toast('Monitoraggio avviato in un\'altra scheda: questa è stata fermata.', 'error', 8000);
        return;
      }
      const remote = data.settings;
      if (remote && !settingsEqual(remote, settings)) {
        settings = normalizeSettings(remote);
        prefs.setCameraSettings(settings);
        applySettingsToUi();
        toast('Sensibilità aggiornata dal visualizzatore', 'info');
      }
    }, (err) => console.error(err));
  }

  // ----- avvio / stop -----
  async function start() {
    if (state.running) return;
    el.start.disabled = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia non disponibile: serve HTTPS o localhost.');
      state.stream = await openStream();
      el.video.srcObject = state.stream;
      await el.video.play().catch(() => {});
      await refreshSources();

      state.running = true;
      state.sessionId = randomSessionId();
      state.motionTracker.reset();
      state.cryTracker.reset();
      state.lastEvent = { motion: null, cry: null };

      state.motionDet = new MotionDetector(el.video, { overlay: el.overlay, onUpdate: onMotion });
      state.motionDet.start();
      await restartCryDetector();

      await S.setDoc(docRef(), baseDoc(), { merge: true });
      state.heartbeat = setInterval(() => {
        S.setDoc(docRef(), { status: 'online', monitoring: true, lastSeen: S.serverTimestamp() }, { merge: true }).catch(() => {});
      }, HEARTBEAT_MS);
      listenRemoteSettings();

      state.streamer = new CameraStreamer({
        stream: state.stream,
        callsRef: callsCol(cameraId),
        sessionId: state.sessionId,
        onViewersChange: ({ connected, total }) => {
          el.viewers.hidden = total === 0;
          el.viewers.textContent = connected ? `👁 ${connected} in visione` : '⏳ connessione…';
        },
      });
      await state.streamer.start();
      state.wakeLock.request();

      el.status.textContent = 'In ascolto';
      el.status.className = 'badge on';
      el.start.hidden = true;
      el.stop.hidden = false;
      el.dark.hidden = false;
      toast('Monitoraggio avviato', 'ok');
    } catch (err) {
      console.error(err);
      toast(`Impossibile avviare: ${err.message}`, 'error', 6000);
      await stop();
    } finally {
      el.start.disabled = false;
    }
  }

  async function stop({ unmount = false, takenOver = false } = {}) {
    const wasRunning = state.running;
    state.running = false;
    publishState.cancel();
    persistSettings.cancel();
    if (state.heartbeat) clearInterval(state.heartbeat);
    state.heartbeat = null;
    state.unsubDoc?.();
    state.unsubDoc = null;
    state.motionDet?.stop();
    state.motionDet = null;
    await state.cryDet?.stop();
    state.cryDet = null;
    if (takenOver) state.streamer?.stopLocal?.();
    else await state.streamer?.stop();
    state.streamer = null;
    state.stream?.getTracks().forEach((t) => t.stop());
    state.stream = null;
    el.video.srcObject = null;
    state.wakeLock.release();
    if (wasRunning && !takenOver) {
      try {
        await S.setDoc(docRef(), {
          status: 'offline', monitoring: false, lastSeen: S.serverTimestamp(),
          motion: { score: 0, level: 0 }, cry: { score: 0, level: 0 },
        }, { merge: true });
      } catch {
        /* offline */
      }
    }
    if (unmount) return;
    state.motion = { score: 0, level: 0 };
    state.cry = { score: 0, level: 0 };
    setLevel(el.motion.bar, el.motion.label, 0, MOTION_LABELS);
    setLevel(el.cry.bar, el.cry.label, 0, CRY_LABELS);
    el.motion.card.dataset.level = 0;
    el.cry.card.dataset.level = 0;
    setMeter(el.motion.meter, 0);
    setMeter(el.cry.meter, 0);
    el.status.textContent = 'Non attiva';
    el.status.className = 'badge off';
    el.viewers.hidden = true;
    el.start.hidden = false;
    el.stop.hidden = true;
    el.dark.hidden = true;
    el.darkScreen.hidden = true;
  }

  el.start.addEventListener('click', start);
  el.stop.addEventListener('click', () => stop());
  el.dark.addEventListener('click', () => {
    el.darkScreen.hidden = false;
  });
  el.darkScreen.addEventListener('click', () => {
    el.darkScreen.hidden = true;
  });

  const onBeforeUnload = (e) => {
    if (!state.running) return;
    e.preventDefault();
    e.returnValue = '';
  };
  const onPageHide = () => {
    if (!state.running) return;
    S.setDoc(docRef(), { status: 'offline', monitoring: false }, { merge: true }).catch(() => {});
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', onPageHide);

  setLevel(el.motion.bar, el.motion.label, 0, MOTION_LABELS);
  setLevel(el.cry.bar, el.cry.label, 0, CRY_LABELS);

  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
    state.wakeLock.destroy();
    stop({ unmount: true });
  };
}

export { DEFAULT_SETTINGS };
