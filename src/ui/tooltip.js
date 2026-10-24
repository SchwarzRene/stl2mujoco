// One global tooltip for every [data-tip] element. It is positioned fixed on <body>, so side panels with
// overflow:auto cannot clip it, and it is kept inside the window (flips above the element near the bottom edge).
let tip = null, current = null;
const NATIVE = /^(SELECT|INPUT|TEXTAREA)$/; // these also get a native title (see kit.js)

function hide() { if (tip) tip.style.display = 'none'; current = null; }

function show(el) {
  tip ??= Object.assign(document.createElement('div'), { id: 'tip' });
  if (!tip.isConnected) document.body.append(tip);
  current = el;
  tip.textContent = el.getAttribute('data-tip');
  tip.style.display = 'block';
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, m = 8;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(m, Math.min(left, innerWidth - w - m));
  let top = r.bottom + 6;
  if (top + h > innerHeight - m) top = Math.max(m, r.top - h - 6);
  tip.style.left = `${left}px`; tip.style.top = `${top}px`;
}

export function initTooltips() {
  // pointermove (not mouseover) so a tooltip also disappears when its element is re-rendered under the pointer
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el || NATIVE.test(el.tagName) || !el.getAttribute('data-tip')) { if (current) hide(); return; }
    if (el !== current || tip?.textContent !== el.getAttribute('data-tip')) show(el);
  }, true);
  for (const ev of ['pointerdown', 'wheel', 'keydown', 'blur']) addEventListener(ev, hide, true);
  document.addEventListener('pointerleave', hide);
}
