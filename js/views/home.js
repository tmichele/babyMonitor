import { getDeviceId, getDeviceName } from '../config.js';
import { escapeHtml } from '../ui.js';

export function renderHome(root) {
  root.innerHTML = `
  <section class="view narrow">
    <div class="card">
      <h2>Come vuoi usare questo dispositivo?</h2>
      <div class="role-grid">
        <a class="role-card" href="#/camera">
          <span class="role-icon" aria-hidden="true">📷</span>
          <strong>Camera</strong>
          <span class="muted">Lascialo vicino al bambino: riprende, rileva movimento e pianto e trasmette agli altri dispositivi.</span>
        </a>
        <a class="role-card" href="#/viewer">
          <span class="role-icon" aria-hidden="true">📱</span>
          <strong>Visualizzatore</strong>
          <span class="muted">Mostra i livelli in tempo reale, gli eventi, il video in diretta e avvisa con suono e notifiche.</span>
        </a>
      </div>
      <p class="muted small">Questo dispositivo: <b>${escapeHtml(getDeviceName())}</b> · id <code>${escapeHtml(getDeviceId().slice(0, 8))}</code></p>
      <p class="muted small">Suggerimento: apri l'app da HTTPS e tieni la scheda in primo piano sul dispositivo camera; lo schermo resta acceso automaticamente.</p>
    </div>
  </section>`;
}
