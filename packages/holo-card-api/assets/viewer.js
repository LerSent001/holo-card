const canvas = document.querySelector('canvas'),
  card = document.querySelector('.card'),
  front = document.querySelector('.front'),
  back = document.querySelector('.back'),
  status = document.querySelector('.status');
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
  document.title = manifest.name + ' · Holo Card';
  back.querySelector('img').src = manifest.back ?? 'back.png' + query;
  renderer = await factory(canvas, manifest.assets);
  const aspect = manifest.height / manifest.width;
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
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    m.down = true;
    m.px = e.clientX;
    m.py = e.clientY;
    m.moved = false;
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener('pointermove', (e) => {
    if (m.down) {
      const dx = e.clientX - m.px,
        dy = e.clientY - m.py;
      if (Math.abs(dx) + Math.abs(dy) > 2) m.moved = true;
      m.ty += dx * 0.62;
      m.tx = Math.max(-50, Math.min(50, m.tx - dy * 0.3));
      m.px = e.clientX;
      m.py = e.clientY;
    } else if (e.pointerType === 'mouse') {
      m.tx = (-(e.clientY - innerHeight / 2) / innerHeight) * 30;
      m.ty = m.base + ((e.clientX - innerWidth / 2) / innerWidth) * 40;
    }
  });
  card.addEventListener('pointerup', (e) => {
    m.down = false;
    if (card.hasPointerCapture(e.pointerId))
      card.releasePointerCapture(e.pointerId);
    if (!m.moved) flip();
    else m.base = Math.round(m.ty / 180) * 180;
  });
  card.addEventListener('pointercancel', () => {
    m.down = false;
  });
  card.addEventListener('pointerleave', () => {
    if (!m.down) {
      m.tx = 0;
      m.ty = m.base;
    }
  });
  let lastX = 999,
    lastY = 999;
  function frame() {
    const ease = reduced ? 1 : 0.115;
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
      renderer.dispose();
    },
    { once: true },
  );
} catch {
  status.hidden = false;
  status.textContent =
    'Unable to load the card. Refresh the preview link or open the downloaded HTML file.';
}
