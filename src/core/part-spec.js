// Part spec: the strict, parametric description from which standard parts are generated.
// It is what the headless Claude Code session fills in from a datasheet. The spec is UNTRUSTED input:
// everything is whitelisted, type-checked and range-checked here before any generator runs.

export const CATEGORIES = { Servos: 'servos', Motors: 'motors', Sensors: 'sensors', Brackets: 'brackets', Structure: 'structure', Fasteners: 'fasteners', Other: 'other' };
export const TYPES = ['hobby_servo', 'block_servo', 'block', 'cylinder', 'stl'];

const R = {
  hobby_servo: { L: [5, 200], W: [5, 100], H: [5, 200], earLen: [5, 300], earSpacing: [3, 300], earHole: [0.5, 12], earT: [0.3, 10], earTop: [-150, 0], shaftFromEnd: [0, 100], bossD: [0, 60], bossH: [0, 20], splineD: [1, 30], splineTop: [0.5, 60], outMass: [0, 0.2] },
  block_servo: { W: [5, 200], Hh: [5, 300], D: [5, 200], shaftFromTop: [0, 300], hornD: [3, 80], hornT: [0.5, 30], outMass: [0, 0.2] },
  block: { x: [1, 500], y: [1, 500], z: [0.3, 500] },
  cylinder: { d: [1, 500], h: [0.3, 500], bore: [0, 400] },
  stl: {},
};
const SERVO_TYPES = ['hobby_servo', 'block_servo'];
const str = (v, max = 200) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const vec = (v, n) => Array.isArray(v) && v.length === n && v.every(num);

export function validateSpec(raw, { stlFiles = [] } = {}) {
  const errors = [], err = (m) => errors.push(m);
  const s = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['spec must be a JSON object'] };
  s.schema = 1;
  s.id = str(raw.id, 60).toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,59}$/.test(s.id)) err('id must match [a-z][a-z0-9_]{1,59}');
  s.name = str(raw.name, 80).trim(); if (!s.name) err('name is required');
  s.category = Object.hasOwn(CATEGORIES, raw.category) ? raw.category : 'Other';
  s.description = str(raw.description, 600);
  s.type = raw.type;
  if (!TYPES.includes(s.type)) err(`type must be one of ${TYPES.join(', ')}`);
  s.color = /^#[0-9a-fA-F]{6}$/.test(raw.color ?? '') ? raw.color : '#6b7280';
  // ---- params
  const p = {}, rawP = raw.params && typeof raw.params === 'object' ? raw.params : {};
  for (const [k, [lo, hi]] of Object.entries(R[s.type] ?? {})) {
    const v = rawP[k];
    if (v === undefined) { if (!['bore', 'outMass', 'bossD', 'bossH'].includes(k) && s.type !== 'stl') err(`params.${k} is required`); continue; }
    if (!num(v) || v < lo || v > hi) err(`params.${k} must be a number in [${lo}, ${hi}] (got ${JSON.stringify(v)})`); else p[k] = v;
  }
  if (s.type === 'hobby_servo' && !errors.length) {
    if (p.shaftFromEnd >= p.L) err('params.shaftFromEnd must be smaller than L');
    if (p.earTop - p.earT <= -p.H) err('the ear must lie inside the case height (earTop - earT > -H)');
    if (p.earHole >= p.earSpacing) err('earHole must be smaller than earSpacing');
    if (p.splineTop <= (p.bossH ?? 0)) err('splineTop must be above bossH');
  }
  if (s.type === 'block_servo' && !errors.length && p.shaftFromTop > p.Hh) err('shaftFromTop must be inside the body');
  if (s.type === 'cylinder' && p.bore !== undefined && p.bore >= p.d) err('bore must be smaller than d');
  if (s.type === 'stl') {
    const f = str(rawP.file, 100);
    if (!f || !stlFiles.includes(f)) err(`params.file must name an uploaded STL (${stlFiles.join(', ') || 'none uploaded'})`); else p.file = f;
    p.units = ['mm', 'cm', 'm'].includes(rawP.units) ? rawP.units : 'mm';
  }
  // holes (block / cylinder-less parts): vertical through holes
  if (s.type === 'block') {
    p.holes = [];
    for (const h of Array.isArray(rawP.holes) ? rawP.holes.slice(0, 64) : []) {
      if (!num(h?.x) || !num(h?.y) || !num(h?.d) || h.d <= 0.2 || h.d >= Math.min(p.x ?? 0, p.y ?? 0)) { err('each hole needs numeric x, y (from the centre) and a sensible d'); break; }
      if (Math.abs(h.x) + h.d / 2 >= (p.x ?? 0) / 2 || Math.abs(h.y) + h.d / 2 >= (p.y ?? 0) / 2) { err('a hole lies outside the block'); break; }
      p.holes.push({ x: h.x, y: h.y, d: h.d });
    }
  }
  s.params = p;
  // ---- mass
  if (num(raw.mass_kg) && raw.mass_kg > 0 && raw.mass_kg <= 20) s.mass_kg = raw.mass_kg;
  else if (num(raw.density_kg_m3) && raw.density_kg_m3 > 50 && raw.density_kg_m3 < 25000) s.density_kg_m3 = raw.density_kg_m3;
  else err('mass_kg (0 < m ≤ 20) or density_kg_m3 is required');
  if (s.mass_kg !== undefined && SERVO_TYPES.includes(s.type) && p.outMass !== undefined && p.outMass >= s.mass_kg) err('outMass must be smaller than the total mass');
  // ---- servo block
  if (SERVO_TYPES.includes(s.type)) {
    const sv = raw.servo ?? {}, volts = {};
    for (const [v, d] of Object.entries(sv.voltages ?? {}).slice(0, 8)) {
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(v)) { err(`servo voltage key "${v}" must look like "6.0"`); continue; }
      if (!num(d?.stall_torque) || d.stall_torque < 0.001 || d.stall_torque > 100) err(`servo.voltages.${v}.stall_torque must be in [0.001, 100] N·m`);
      else if (!num(d?.noload_speed) || d.noload_speed < 0.1 || d.noload_speed > 100) err(`servo.voltages.${v}.noload_speed must be in [0.1, 100] rad/s`);
      else volts[v] = { stall_torque: d.stall_torque, noload_speed: d.noload_speed };
    }
    if (!Object.keys(volts).length) err('servo.voltages needs at least one voltage with stall_torque (N·m) and noload_speed (rad/s)');
    const dv = String(sv.defaultVoltage ?? Object.keys(volts)[0]);
    const rng = vec(sv.range_deg, 2) && sv.range_deg[0] < sv.range_deg[1] && sv.range_deg[0] >= -720 && sv.range_deg[1] <= 720 ? sv.range_deg : null;
    if (!rng) err('servo.range_deg must be [min, max] in degrees');
    s.servo = {
      name: s.name, range_deg: rng ?? [-90, 90], defaultVoltage: volts[dv] ? dv : Object.keys(volts)[0], voltages: volts,
      armature: num(sv.armature) && sv.armature >= 0 && sv.armature < 1 ? sv.armature : 0.005,
      frictionloss_frac: num(sv.frictionloss_frac) && sv.frictionloss_frac >= 0 && sv.frictionloss_frac < 0.5 ? sv.frictionloss_frac : 0.03,
      kp_sat_rad: num(sv.kp_sat_rad) && sv.kp_sat_rad >= 0.01 && sv.kp_sat_rad <= 1 ? sv.kp_sat_rad : 0.1,
    };
  }
  // ---- connectors
  s.connectors = [];
  for (const c of Array.isArray(raw.connectors) ? raw.connectors.slice(0, 64) : []) {
    if (!vec(c?.pos_mm, 3) || !vec(c?.normal, 3) || Math.hypot(...c.normal) < 1e-6 || c.pos_mm.some((v) => Math.abs(v) > 1000)) { err('every connector needs pos_mm [x,y,z] (mm) and a non-zero normal [x,y,z]'); break; }
    const name = str(c.name, 40).replace(/[^A-Za-z0-9_]/g, '_');
    if (!name) { err('every connector needs a name'); break; }
    s.connectors.push({ name, pos_mm: c.pos_mm, normal: c.normal, ...(c.note ? { note: str(c.note, 120) } : {}) });
  }
  // ---- provenance
  s.dims_status = {};
  for (const [k, v] of Object.entries(raw.dims_status ?? {}).slice(0, 20)) s.dims_status[str(k, 40).replace(/[^A-Za-z0-9_ ]/g, '_')] = str(v, 120);
  s.sources = [];
  for (const src of Array.isArray(raw.sources) ? raw.sources.slice(0, 10) : []) {
    const title = str(src?.title, 120); if (!title) continue;
    let url; try { const u = new URL(String(src.url)); if (['http:', 'https:'].includes(u.protocol)) url = u.href; } catch { /* no url */ }
    s.sources.push(url ? { title, url } : { title });
  }
  return { ok: errors.length === 0, errors, spec: s };
}
