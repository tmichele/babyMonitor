// Zoom (pizzico, doppio tocco, rotellina, pulsanti) e schermo intero per un contenitore video.
// La parte di calcolo è pura e testabile; attachZoom/attachFullscreen collegano il DOM.

export const ZOOM = Object.freeze({ min: 1, max: 5, step: 1.5, doubleTap: 2.5 });

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Limita lo spostamento così che il contenuto ingrandito copra sempre il contenitore.
 * A scala 1 lo spostamento è sempre 0.
 */
export function clampOffset(offset, scale, size) {
  const overflow = size * (scale - 1);
  return clamp(offset, -overflow, 0) || 0; // evita -0
}

/**
 * Nuova trasformazione quando si zooma di `factor` attorno al punto (cx, cy) del contenitore.
 * Il punto sotto il dito/cursore resta fermo.
 */
export function zoomAround(state, factor, cx, cy, box, limits = ZOOM) {
  const scale = clamp(state.scale * factor, limits.min, limits.max);
  const ratio = scale / state.scale;
  const x = cx - (cx - state.x) * ratio;
  const y = cy - (cy - state.y) * ratio;
  return {
    scale,
    x: clampOffset(x, scale, box.width),
    y: clampOffset(y, scale, box.height),
  };
}

export function pan(state, dx, dy, box) {
  return {
    scale: state.scale,
    x: clampOffset(state.x + dx, state.scale, box.width),
    y: clampOffset(state.y + dy, state.scale, box.height),
  };
}

export const IDENTITY = Object.freeze({ scale: 1, x: 0, y: 0 });

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Collega zoom e pan a `target` (il <video>) dentro `container`.
 * Restituisce { zoomIn, zoomOut, reset, getScale, destroy }.
 */
export function attachZoom(container, target, { onChange = () => {}, limits = ZOOM } = {}) {
  let state = { ...IDENTITY };
  const pointers = new Map();
  let pinchStart = null;
  let lastTap = 0;
  let moved = false;

  const box = () => container.getBoundingClientRect();
  const local = (e, b = box()) => ({ x: e.clientX - b.left, y: e.clientY - b.top });

  function apply(next) {
    state = next;
    target.style.transform = state.scale === 1 ? '' : `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    container.classList.toggle('zoomed', state.scale > 1);
    onChange(state.scale);
  }

  function zoomBy(factor, center) {
    const b = box();
    const c = center || { x: b.width / 2, y: b.height / 2 };
    apply(zoomAround(state, factor, c.x, c.y, b, limits));
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest?.('button, .zoom-controls')) return; // i pulsanti restano cliccabili
    pointers.set(e.pointerId, local(e));
    moved = false;
    container.setPointerCapture?.(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinchStart = { dist: dist(a, b), scale: state.scale };
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const cur = local(e);
    pointers.set(e.pointerId, cur);
    if (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) > 2) moved = true;
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = Array.from(pointers.values());
      const d = dist(a, b);
      if (pinchStart.dist > 0) {
        const targetScale = clamp(pinchStart.scale * (d / pinchStart.dist), limits.min, limits.max);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        apply(zoomAround(state, targetScale / state.scale, mid.x, mid.y, box(), limits));
      }
      e.preventDefault();
    } else if (pointers.size === 1 && state.scale > 1) {
      apply(pan(state, cur.x - prev.x, cur.y - prev.y, box()));
      e.preventDefault();
    }
  }

  function onPointerUp(e) {
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (wasSingle && !moved && e.type === 'pointerup') {
      const now = Date.now();
      if (now - lastTap < 320) {
        const c = local(e);
        if (state.scale > 1) apply({ ...IDENTITY });
        else zoomBy(limits.doubleTap, c);
        lastTap = 0;
      } else {
        lastTap = now;
      }
    }
  }

  function onWheel(e) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, local(e));
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('wheel', onWheel, { passive: false });
  container.classList.add('zoomable');

  return {
    zoomIn: () => zoomBy(limits.step),
    zoomOut: () => zoomBy(1 / limits.step),
    reset: () => apply({ ...IDENTITY }),
    getScale: () => state.scale,
    destroy() {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('wheel', onWheel);
      container.classList.remove('zoomable', 'zoomed');
      target.style.transform = '';
    },
  };
}

/**
 * Schermo intero per `container`: usa l'API Fullscreen dove c'è, altrimenti (iPhone) un
 * ripiego CSS a tutto schermo. Restituisce { toggle, isActive, destroy }.
 */
export function attachFullscreen(container, { onChange = () => {} } = {}) {
  const native = !!(container.requestFullscreen || container.webkitRequestFullscreen);
  let fallbackActive = false;

  const isActive = () => fallbackActive
    || document.fullscreenElement === container
    || document.webkitFullscreenElement === container;

  function notify() {
    container.classList.toggle('fs-active', isActive());
    onChange(isActive());
  }

  async function enter() {
    if (native) {
      try {
        await (container.requestFullscreen?.() || container.webkitRequestFullscreen?.());
        try {
          await screen.orientation?.lock?.('landscape');
        } catch {
          /* non consentito: ignora */
        }
        return;
      } catch {
        /* ripiego sotto */
      }
    }
    fallbackActive = true;
    container.classList.add('fs-fallback');
    document.body.classList.add('fs-open');
    notify();
  }

  async function exit() {
    if (fallbackActive) {
      fallbackActive = false;
      container.classList.remove('fs-fallback');
      document.body.classList.remove('fs-open');
      notify();
      return;
    }
    try {
      screen.orientation?.unlock?.();
    } catch {
      /* ignora */
    }
    try {
      await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
    } catch {
      /* ignora */
    }
  }

  const onFsChange = () => notify();
  const onKey = (e) => {
    if (e.key === 'Escape' && fallbackActive) exit();
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('keydown', onKey);

  return {
    toggle: () => (isActive() ? exit() : enter()),
    isActive,
    destroy() {
      if (isActive()) exit();
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      document.removeEventListener('keydown', onKey);
    },
  };
}
