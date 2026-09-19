// Test end-to-end in Chromium con camera/microfono simulati e Firebase finto (vedi
// fake-firebase.js). Richiede Playwright: `npm i -D playwright` oppure una installazione
// globale (usa PLAYWRIGHT_PATH per indicare la cartella del pacchetto).
//   node test/e2e/run.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FAKE = path.join(ROOT, 'test/e2e/fake-firebase.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, path.join(ROOT, 'node_modules/playwright')];
  try {
    candidates.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
  } catch {
    /* npm non disponibile */
  }
  for (const dir of candidates) {
    if (dir && existsSync(path.join(dir, 'index.mjs'))) return import(pathToFileURL(path.join(dir, 'index.mjs')).href);
  }
  throw new Error('Playwright non trovato: npm i -D playwright');
}

function startServer() {
  const server = createServer(async (req, res) => {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const file = path.join(ROOT, urlPath);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

const SHOTS = process.env.E2E_SCREENSHOTS; // cartella in cui salvare gli screenshot (opzionale)
async function shot(page, name) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

const failures = [];
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures.push(msg);
  }
}

async function waitFor(fn, { timeout = 15000, interval = 200, label = 'condizione' } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timeout in attesa di: ${label}`);
}

// Audio finto: tono armonico (450 Hz + armoniche) modulato come un pianto, 6 s in loop.
function writeCryWav(file) {
  const sr = 48000;
  const seconds = 6;
  const n = sr * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.5 * t); // modulazione lenta
    let v = 0;
    for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * 450 * h * t) / h;
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, 0.5 * env * v)) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}
const WAV = path.join(tmpdir(), 'babymonitor-cry.wav');
writeCryWav(WAV);

const { chromium } = await loadPlaywright();
const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}`,
    '--autoplay-policy=no-user-gesture-required', '--allow-insecure-localhost',
  ],
});
const context = await browser.newContext({ permissions: ['camera', 'microphone', 'notifications'] });
await context.route('**/firebasejs/**', (route) => route.fulfill({ path: FAKE, contentType: 'text/javascript' }));
const consoleErrors = [];
const attach = (page, name) => {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${name}] ${m.text()} (${m.location()?.url || ''})`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${name}] pageerror: ${e.message}`));
};

try {
  console.log('1. Configurazione e accesso');
  const cam = await context.newPage();
  attach(cam, 'camera');
  await cam.goto(base + '#/');
  await cam.waitForSelector('#cfg-input');
  check(true, 'schermata di configurazione mostrata senza config');
  await shot(cam, '01-setup');
  await cam.fill('#cfg-input', 'const firebaseConfig = { apiKey: "k", projectId: "p", appId: "a" };');
  await cam.click('#cfg-save');
  await cam.waitForSelector('#auth-form');
  check(true, 'dopo il salvataggio compare il login');
  await shot(cam, '02-login');
  await cam.fill('#auth-email', 'mamma@example.com');
  await cam.fill('#auth-pass', 'segreta1');
  await cam.click('#auth-register');
  await cam.waitForSelector('.role-card');
  check(true, 'registrazione → schermata ruoli');
  await shot(cam, '03-home');

  console.log('2. Camera');
  await cam.click('a[href="#/camera"]');
  await cam.waitForSelector('#cam-start');
  await cam.fill('#cam-name', 'Cameretta');
  await cam.dispatchEvent('#cam-name', 'change');
  await cam.click('#cam-start');
  await waitFor(() => cam.$eval('#cam-status', (e) => e.textContent === 'In ascolto'), { label: 'stato In ascolto' });
  check(true, 'monitoraggio avviato');
  const camDoc = await waitFor(() => cam.evaluate(() => {
    const entries = window.__fakeFirestore.list('users/').filter(([p]) => /^users\/[^/]+\/cameras\/[^/]+$/.test(p));
    return entries.length ? entries[0][1] : null;
  }), { label: 'documento camera' });
  check(camDoc.name === 'Cameretta', `documento camera pubblicato con nome (${camDoc.name})`);
  check(camDoc.status === 'online' && camDoc.monitoring === true, 'stato online');
  check(camDoc.settings && camDoc.settings.motionSensitivity === 5, 'impostazioni pubblicate');
  await waitFor(() => cam.$eval('#motion-score', (e) => /pixel/.test(e.textContent)), { label: 'punteggio movimento' });
  await waitFor(() => cam.$eval('#cry-score', (e) => /punteggio/.test(e.textContent)), { label: 'punteggio pianto' });
  check(true, 'rilevatori movimento e pianto attivi');
  await waitFor(() => cam.$eval('#cry-label', (e) => Number(e.dataset.level) >= 1), { label: 'livello pianto ≥ 1 con il tono armonico' });
  check(true, 'il tono armonico simulato viene classificato almeno come Rumore');
  const motionText = await cam.$eval('#motion-score', (e) => e.textContent);
  const cryText = await cam.$eval('#cry-score', (e) => e.textContent);
  const cryLabel = await cam.$eval('#cry-label', (e) => e.textContent);
  console.log(`    movimento: ${motionText} | pianto: ${cryLabel} · ${cryText}`);
  await shot(cam, '04-camera');

  console.log('3. Visualizzatore');
  const view = await context.newPage();
  attach(view, 'viewer');
  await view.goto(base + '#/viewer');
  await view.waitForSelector('.cam-item');
  check(await view.$eval('.cam-name', (e) => e.textContent) === 'Cameretta', 'camera elencata');
  await waitFor(() => view.$eval('#d-status', (e) => e.textContent === 'online'), { label: 'camera online nel dettaglio' });
  check(true, 'dettaglio camera online (selezione automatica)');
  await waitFor(() => view.$eval('#cry-score', (e) => /punteggio \d+/.test(e.textContent)), { label: 'livelli sincronizzati' });
  check(true, 'livelli ricevuti dal visualizzatore');

  console.log('4. Sensibilità remota');
  await view.fill('#r-motion', '8');
  await view.dispatchEvent('#r-motion', 'input');
  await view.click('#r-save');
  await waitFor(() => cam.$eval('#set-motion', (e) => e.value === '8'), { label: 'sensibilità applicata sulla camera' });
  check(true, 'la camera applica la sensibilità inviata dal visualizzatore');

  console.log('5. Video WebRTC');
  await view.click('#v-start');
  await waitFor(() => view.$eval('#v-conn', (e) => e.textContent === 'In diretta'), { timeout: 30000, label: 'video in diretta' });
  check(true, 'connessione WebRTC stabilita');
  const dims = await waitFor(() => view.$eval('#v-video', (v) => (v.videoWidth > 0 ? [v.videoWidth, v.videoHeight] : null)), { label: 'frame video' });
  check(dims[0] > 0, `il visualizzatore riceve video ${dims[0]}x${dims[1]}`);
  await shot(view, '05-viewer-live');
  await waitFor(() => cam.$eval('#cam-viewers', (e) => !e.hidden && /1 in visione/.test(e.textContent)), { label: 'contatore visualizzatori' });
  check(true, 'la camera conta 1 visualizzatore');
  await view.click('#v-stop');
  await waitFor(() => view.$eval('#v-conn', (e) => e.textContent === 'Non connesso'), { label: 'video fermato' });
  await waitFor(() => cam.evaluate(() => window.__fakeFirestore.list('users/').filter(([p]) => /\/calls\//.test(p)).length === 0), { label: 'pulizia chiamata' });
  check(true, 'chiamata chiusa e documenti di segnalazione rimossi');

  console.log('6. Eventi e stop');
  const eventCount = await cam.evaluate(() => window.__fakeFirestore.list('users/').filter(([p]) => /\/events\//.test(p)).length);
  console.log(`    eventi registrati con il video finto: ${eventCount}`);
  await cam.click('#cam-stop');
  await waitFor(() => view.$eval('#d-status', (e) => e.textContent === 'offline'), { label: 'camera offline sul visualizzatore' });
  check(true, 'lo stop della camera risulta offline sul visualizzatore');
  check(await view.$eval('#v-start', (b) => b.disabled), 'con camera offline il pulsante video è disabilitato');

  console.log('7. Logout');
  await cam.once('dialog', (d) => d.accept());
  await cam.click('#btn-logout');
  await cam.waitForSelector('#auth-form');
  check(true, 'logout riporta al login');
} catch (err) {
  failures.push(err.message);
  console.log(`  ✗ ${err.message}`);
} finally {
  await browser.close();
  server.close();
}

const ignorable = /stun|ICE|firebase-config\.js|net::ERR|navigator\.vibrate/i;
const realErrors = consoleErrors.filter((e) => !ignorable.test(e));
if (realErrors.length) {
  console.log('Errori console:');
  realErrors.forEach((e) => console.log('  ' + e));
  failures.push('errori in console');
}
console.log(failures.length ? `\nFALLITI: ${failures.length}` : '\nTutti i controlli superati');
process.exit(failures.length ? 1 : 0);
