const canvas = document.querySelector('canvas'),
  card = document.querySelector('.card'),
  front = document.querySelector('.front'),
  back = document.querySelector('.back'),
  status = document.querySelector('.status');
const immersiveButton = document.querySelector('#immersive');
function setImmersive(active) {
  document.body.classList.toggle('immersive', active);
  immersiveButton.setAttribute('aria-pressed', String(active));
  immersiveButton.setAttribute('aria-label', active ? 'Exit immersive mode' : 'Enter immersive mode');
  immersiveButton.title = active ? 'Exit immersive mode' : 'Immersive mode';
}
immersiveButton.addEventListener('click', () => setImmersive(!document.body.classList.contains('immersive')));
document.addEventListener('keydown', e => { if (e.key === 'Escape') setImmersive(false); });
let renderer, raf;
let depth = 0, contourBrightness = 0.15, dirty = true;
for (const input of document.querySelectorAll(".controls input")) {
  input.addEventListener("input", () => {
    if(input.id === "depth") depth = Number(input.value);
    else contourBrightness = Number(input.value);
    document.querySelector(`output[for="${input.id}"]`).value = (input.id === "depth" && Number(input.value) > 0 ? "+" : "") + Number(input.value).toFixed(2) + "×";
    dirty = true;
  });
}
try {
  const query = location.search;
  const factory =
    globalThis.HOLO_CREATE_RENDERER ??
    (await import('./renderer.js' + query)).createCardRenderer;
  const manifest =
    globalThis.HOLO_MANIFEST ??
    (await fetch('manifest.json' + query).then((r) => {
      if (!r.ok) throw new Error('Preview expired');
      return r.json();
    }));
  const mobileButton = document.querySelector('#mobile');
  if (manifest.previewUrl && manifest.previewQr) {
    const url = new URL(manifest.previewUrl);
    if (url.protocol === 'https:') {
      mobileButton.hidden = false;
      document.querySelector('#mobile-qr').src = manifest.previewQr;
      document.querySelector('#mobile-link').href = url.href;
      mobileButton.addEventListener('click', () => document.querySelector('#mobile-dialog').showModal());
    }
  }
  document.title = manifest.name + ' · Holo Card';
  back.querySelector('img').src = manifest.back ?? 'back.png' + query;
  renderer = await factory(canvas, manifest.assets);
  const aspect = manifest.height / manifest.width;
  card.style.setProperty('--card-aspect', aspect);
  card.style.aspectRatio = `1 / ${aspect}`;
  card.style.width = `min(79vw,440px,calc(74svh / ${aspect}))`;
  status.hidden = true;
  const m = {
    x: -5,
    y: -12,
    tx: -5,
    ty: -12,
    base: 0,
    down: false,
    px: 0,
    py: 0,
    moved: false,
    pointer: null,
    startX: 0, startY: 0,
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionButton = document.querySelector('#motion');
  const resetButton = document.querySelector('#reset');
  const hint = document.querySelector('#motion-hint');
  let motionEnabled = false, origin = null, sensorX = 0, sensorY = 0, sensorTimer, orientationSeen = false;
  const wrap = v => ((v + 180) % 360 + 360) % 360 - 180;
  const clamp = v => Math.max(-28, Math.min(28, v));
  function calibrate() {
    origin = null;
    sensorX = sensorY = 0;
    m.tx = 0; m.ty = m.base;
  }
  function stopMotion(message = 'Drag to rotate · Tap to flip') {
    motionEnabled = false;
    clearTimeout(sensorTimer);
    removeEventListener('deviceorientation', onOrientation);
    removeEventListener('devicemotion', onMotion);
    motionButton.textContent = 'Enable motion';
    motionButton.setAttribute('aria-pressed', 'false');
    hint.textContent = message;
  }
  function onOrientation(e) {
    if (!motionEnabled || document.hidden || !Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return;
    orientationSeen = true;
    clearTimeout(sensorTimer);
    if (!origin) origin = { beta: e.beta, gamma: e.gamma };
    const b = wrap(e.beta - origin.beta), g = wrap(e.gamma - origin.gamma);
    const a = (screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI / 180;
    sensorX = clamp(-(b * Math.cos(a) + g * Math.sin(a)) * 0.85);
    sensorY = clamp((g * Math.cos(a) - b * Math.sin(a)) * 0.85);
    hint.textContent = 'Motion active · Tilt your phone · Drag anytime';
  }
  function onMotion(e) {
    if (orientationSeen || !motionEnabled || document.hidden) return;
    const g = e.accelerationIncludingGravity;
    if (!g || ![g.x, g.y, g.z].every(Number.isFinite) || Math.hypot(g.x, g.y, g.z) < 1) return;
    // Gravity provides stable relative tilt when orientation events are unavailable.
    onOrientation({ beta: Math.atan2(-g.y, Math.hypot(g.x, g.z)) * 180 / Math.PI,
                    gamma: Math.atan2(g.x, -g.z) * 180 / Math.PI });
    orientationSeen = false;
  }
  motionButton.addEventListener('click', async () => {
    if (motionEnabled) { stopMotion(); return; }
    if (!isSecureContext) { hint.textContent = 'Open the HTTPS preview link to enable motion. Drag is available.'; return; }
    if (!globalThis.DeviceOrientationEvent && !globalThis.DeviceMotionEvent) { hint.textContent = 'Motion is unavailable on this device. Drag to rotate.'; return; }
    motionButton.disabled = true;
    try {
      // Start both requests synchronously within the tap, before awaiting either.
      const requests = [globalThis.DeviceOrientationEvent, globalThis.DeviceMotionEvent]
        .filter(Boolean).map(api => typeof api.requestPermission === 'function'
          ? api.requestPermission() : Promise.resolve('granted'));
      const permissions = await Promise.allSettled(requests);
      if (!permissions.some(result => result.status === 'fulfilled' && result.value === 'granted')) {
        hint.textContent = 'Motion permission was not granted. Allow Motion & Orientation in Safari settings, then reload. Drag still works.';
        return;
      }
      orientationSeen = false;
      calibrate();
      motionEnabled = true;
      motionButton.textContent = 'Disable motion';
      motionButton.setAttribute('aria-pressed', 'true');
      hint.textContent = 'Hold comfortably, then tilt your phone…';
      addEventListener('deviceorientation', onOrientation);
      addEventListener('devicemotion', onMotion);
      sensorTimer = setTimeout(() => stopMotion('No sensor data. Open in Safari or Chrome directly, allow Motion & Orientation, then retry. Drag still works.'), 5000);
    } catch {
      stopMotion('Motion could not start. Check browser permissions, or drag.');
    } finally { motionButton.disabled = false; }
  });
  resetButton.addEventListener('click', calibrate);
  screen.orientation?.addEventListener('change', calibrate);
  addEventListener('orientationchange', calibrate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) calibrate(); });

  const flip = () => {
    m.base += 180;
    m.tx = 0;
    m.ty = m.base;
  };
  card.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flip();
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      if (e.key === 'ArrowLeft') m.ty -= 8;
      if (e.key === 'ArrowRight') m.ty += 8;
      if (e.key === 'ArrowUp') m.tx = Math.min(45, m.tx + 8);
      if (e.key === 'ArrowDown') m.tx = Math.max(-45, m.tx - 8);
    }
  });
  card.addEventListener('pointerdown', (e) => {
    if (m.pointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    m.pointer = e.pointerId;
    m.startX = e.clientX; m.startY = e.clientY;
    m.down = true;
    m.px = e.clientX;
    m.py = e.clientY;
    m.moved = false;
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener('pointermove', (e) => {
    if (m.down && m.pointer === e.pointerId) {
      const dx = e.clientX - m.px,
        dy = e.clientY - m.py;
      if (Math.hypot(e.clientX - m.startX, e.clientY - m.startY) > 5) m.moved = true;
      m.ty += dx * 0.62;
      m.tx = Math.max(-50, Math.min(50, m.tx - dy * 0.3));
      m.px = e.clientX;
      m.py = e.clientY;
    } else if (!m.down && !motionEnabled && e.pointerType === 'mouse') {
      m.tx = (-(e.clientY - innerHeight / 2) / innerHeight) * 30;
      m.ty = m.base + ((e.clientX - innerWidth / 2) / innerWidth) * 40;
    }
  });
  card.addEventListener('pointerup', (e) => {
    if (m.pointer !== e.pointerId) return;
    m.pointer = null;
    m.down = false;
    if (card.hasPointerCapture(e.pointerId))
      card.releasePointerCapture(e.pointerId);
    if (!m.moved) flip();
    else m.base = Math.round(m.ty / 180) * 180;
  });
  const cancelDrag = () => { m.pointer = null; m.down = false; m.base = Math.round(m.ty / 180) * 180; };
  card.addEventListener('pointercancel', cancelDrag);
  card.addEventListener('lostpointercapture', () => { if (m.down) cancelDrag(); });
  card.addEventListener('pointerleave', () => {
    if (!m.down && !motionEnabled) {
      m.tx = 0;
      m.ty = m.base;
    }
  });
  let lastX = 999,
    lastY = 999;
  function frame() {
    if (motionEnabled && !m.down) { m.tx = sensorX; m.ty = m.base + sensorY; }
    const ease = motionEnabled ? 0.115 : reduced ? 1 : 0.115;
    m.x += (m.tx - m.x) * ease;
    m.y += (m.ty - m.y) * ease;
    card.style.transform = `rotateX(${m.x}deg) rotateY(${m.y}deg)`;
    const visible =
      Math.cos((m.y * Math.PI) / 180) * Math.cos((m.x * Math.PI) / 180) > 0.001;
    front.style.visibility = visible ? 'visible' : 'hidden';
    back.style.visibility = visible ? 'hidden' : 'visible';
    if (
      !document.hidden &&
      visible &&
      (dirty || Math.abs(m.x - lastX) > 0.015 || Math.abs(m.y - lastY) > 0.015)
    ) {
      renderer.draw(m.x, m.y, 1, depth, contourBrightness);
      dirty = false;
      lastX = m.x;
      lastY = m.y;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  addEventListener(
    'pagehide',
    () => {
      cancelAnimationFrame(raf);
      stopMotion();
      renderer.dispose();
    },
    { once: true },
  );
} catch {
  status.hidden = false;
  status.textContent =
    'Unable to load the card. Refresh the preview link or open the downloaded HTML file.';
}
