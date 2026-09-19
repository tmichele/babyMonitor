// Piccoli helper DOM senza dipendenze.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function toast(message, type = 'info', ms = 3500) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/** Throttle con chiamata iniziale immediata e chiamata finale garantita. */
export function throttle(fn, wait) {
  let last = 0;
  let timer = null;
  let pending = null;
  const invoke = () => {
    last = Date.now();
    timer = null;
    const args = pending;
    pending = null;
    fn(...args);
  };
  const wrapped = (...args) => {
    pending = args;
    const remaining = wait - (Date.now() - last);
    if (remaining <= 0) {
      if (timer) clearTimeout(timer);
      invoke();
    } else if (!timer) {
      timer = setTimeout(invoke, remaining);
    }
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return wrapped;
}

export function formatTime(ms) {
  if (!ms) return '--:--:--';
  return new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatAgo(ms, now = Date.now()) {
  if (!ms) return 'mai';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return 'adesso';
  if (s < 60) return `${s} s fa`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h fa`;
  return new Date(ms).toLocaleDateString('it-IT');
}

export function levelBarHtml(id) {
  return `<div class="level-bar" id="${id}" data-level="0" role="meter" aria-valuemin="0" aria-valuemax="3" aria-valuenow="0">
    <span class="seg" data-seg="1"></span><span class="seg" data-seg="2"></span><span class="seg" data-seg="3"></span>
  </div>`;
}

export function setLevel(barEl, labelEl, level, labels) {
  const lv = Math.max(0, Math.min(3, Number(level) || 0));
  if (barEl) {
    barEl.dataset.level = String(lv);
    barEl.setAttribute('aria-valuenow', String(lv));
    $$('.seg', barEl).forEach((seg) => seg.classList.toggle('on', Number(seg.dataset.seg) <= lv));
  }
  if (labelEl) {
    labelEl.textContent = labels[lv];
    labelEl.dataset.level = String(lv);
  }
}

export function setMeter(el, pct) {
  if (!el) return;
  el.style.width = `${Math.max(0, Math.min(100, Number(pct) || 0))}%`;
}

export function levelCardHtml(prefix, title, icon) {
  return `<div class="card level-card" id="${prefix}-card" data-level="0">
    <div class="level-head"><span class="level-icon" aria-hidden="true">${icon}</span><h3>${title}</h3></div>
    <div class="level-label" id="${prefix}-label" data-level="0">—</div>
    ${levelBarHtml(`${prefix}-bar`)}
    <div class="meter"><div class="meter-fill" id="${prefix}-meter"></div></div>
    <small class="muted" id="${prefix}-score">—</small>
  </div>`;
}
