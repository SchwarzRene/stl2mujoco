// Icon set: 24×24 line icons (stroke = currentColor) so they follow the theme. Names are used with icon('name').
const P = (d) => `<path d="${d}"/>`;
const C = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const R = (x, y, w, h, r = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;

const ICONS = {
  // actions
  import: P('M12 3v12m0 0l-4-4m4 4l4-4') + P('M4 17v3h16v-3'),
  export: P('M12 15V3m0 0L8 7m4-4l4 4') + P('M4 17v3h16v-3'),
  mate: P('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1') + P('M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'),
  box: P('M12 3l8 4.5v9L12 21l-8-4.5v-9z') + P('M12 12l8-4.5M12 12v9M12 12L4 7.5'),
  cylinder: '<ellipse cx="12" cy="6" rx="7" ry="3"/>' + P('M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6'),
  floor: P('M12 3v12m0 0l-4-4m4 4l4-4') + P('M4 20h16'),
  open: P('M3 18V6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v2') + P('M3 18l3-8h16l-3 8z'),
  save: P('M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z') + P('M7 3v6h8V3M7 21v-7h10v7'),
  sliders: P('M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1') + C(15, 6, 2) + C(9, 12, 2) + C(17, 18, 2),
  library: R(3, 3, 7, 7) + R(14, 3, 7, 7) + R(3, 14, 7, 7) + R(14, 14, 7, 7),
  tree: R(4, 3, 6, 4) + R(13, 10, 7, 4) + R(13, 17, 7, 4) + P('M7 7v12h6M7 12h6'),
  sparkles: P('M11 3l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z') + P('M19 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'),
  search: C(11, 11, 6) + P('M20 20l-4.5-4.5'),
  plus: P('M12 5v14M5 12h14'),
  close: P('M6 6l12 12M18 6L6 18'),
  check: P('M5 12.5l4.5 4.5L19 7'),
  warning: P('M12 3.5l9.5 16.5h-19z') + P('M12 10v4.5M12 17.5v.4'),
  error: C(12, 12, 9) + P('M9 9l6 6M15 9l-6 6'),
  info: C(12, 12, 9) + P('M12 11v5M12 7.6v.4'),
  chevron: P('M9 6l6 6-6 6'),
  undo: P('M9 14L4 9l5-5') + P('M4 9h10a6 6 0 0 1 0 12h-3'),
  redo: P('M15 14l5-5-5-5') + P('M20 9H10a6 6 0 0 0 0 12h3'),
  refresh: P('M20 11a8 8 0 0 0-14.5-4M4 5v4h4') + P('M4 13a8 8 0 0 0 14.5 4M20 19v-4h-4'),
  trash: P('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
  flip: P('M7 4L4 7l3 3M4 7h13M17 20l3-3-3-3M20 17H7'),
  play: P('M7 5v14l11-7z'),
  // gizmo
  move: P('M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3'),
  rotate: P('M20 12a8 8 0 1 1-2.5-5.8') + P('M20 4v5h-5'),
  partOnly: P('M12 4l7 4v8l-7 4-7-4V8z'),
  frameOnly: P('M5 19V5M5 19h14M5 5l-2 3M5 5l2 3M19 19l-3-2M19 19l-3 2') + C(5, 19, 1.2),
  both: P('M12 4l7 4v8l-7 4-7-4V8z') + P('M12 12v8M12 12l7-4M12 12L5 8'),
  subtree: C(6, 5, 2) + C(18, 12, 2) + C(18, 19, 2) + P('M6 7v12h10M6 12h10'),
  // copy / array
  copy: R(8, 8, 12, 12, 2) + P('M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2'),
  paste: R(6, 5, 12, 16, 2) + P('M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1'),
  duplicate: R(8, 8, 12, 12, 2) + P('M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2M14 11v6M11 14h6'),
  arrayLinear: R(2.5, 9, 5, 6) + R(9.5, 9, 5, 6) + R(16.5, 9, 5, 6),
  arrayCircular: C(12, 5, 2) + C(19, 12, 2) + C(12, 19, 2) + C(5, 12, 2),
  mirror: P('M12 3v18') + P('M8 7L3 17h5zM16 7l5 10h-5z'),
  applyAll: P('M5 12.5l4.5 4.5L19 7') + P('M3 20h18'),
  // roles / joints
  link: R(2.5, 9, 7, 6) + R(14.5, 9, 7, 6) + P('M9.5 12h5'),
  baseFixed: C(12, 5, 2) + P('M12 7v14M5 14a7 7 0 0 0 14 0M8.5 11h7'),
  baseFree: R(8, 8, 8, 8, 1.5) + P('M12 2v4M12 18v4M2 12h4M18 12h4'),
  servo: R(2.5, 8, 13, 8, 1.5) + C(18.5, 12, 3) + C(18.5, 12, 0.6),
  motor: P('M13 3L5 14h6l-1 7 8-11h-6z'),
  wheel: C(12, 12, 8.5) + C(12, 12, 2) + P('M12 3.5V10M12 14v6.5M3.5 12H10M14 12h6.5'),
  slider: P('M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4'),
  hinge: C(12, 12, 2.5) + P('M12 3a9 9 0 0 1 9 9M12 21a9 9 0 0 1-9-9'),
  ball: C(12, 12, 8.5) + '<ellipse cx="12" cy="12" rx="8.5" ry="3"/>',
  // details
  mass: P('M6 9h12l2 11H4z') + C(12, 5.5, 2.5),
  connector: C(12, 12, 3) + P('M12 2v5M12 17v5M2 12h5M17 12h5'),
  limits: P('M4 18a8 8 0 0 1 16 0') + P('M12 18l5-6'),
  shield: P('M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z'),
  shieldOff: P('M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z') + P('M5 5l14 14'),
  actuator: P('M3 12h4l2-5 4 10 2-5h6'),
  position: C(12, 12, 8) + P('M12 12l4-4M12 4v2M20 12h-2M4 12h2'),
  velocity: P('M4 17a8 8 0 0 1 16 0') + P('M12 17l4-7'),
  file: P('M6 3h8l5 5v13H6z') + P('M14 3v5h5'),
  fastener: P('M6 4h12v4H6z') + P('M9 8v12h6V8') + P('M9 12h6M9 16h6'),
  gripper: P('M6 4v7a6 6 0 0 0 12 0V4') + P('M12 17v4'),
  chip: R(6, 6, 12, 12, 2) + P('M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3'),
  vertex: R(5, 5, 14, 14, 1) + '<circle cx="5" cy="5" r="2.2" fill="currentColor"/>',
  edge: P('M4 18L20 6') + '<circle cx="12" cy="12" r="2.2" fill="currentColor"/>',
  eye: P('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z') + C(12, 12, 3),
};

export function icon(name, size = 18) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('width', size); el.setAttribute('height', size);
  el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor'); el.setAttribute('stroke-width', '1.8');
  el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round'); el.setAttribute('aria-hidden', 'true');
  el.innerHTML = ICONS[name] ?? ICONS.info;
  return el;
}
export const ICON_NAMES = Object.keys(ICONS);
