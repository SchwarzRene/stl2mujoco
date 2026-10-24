// Reads the *assembly structure* (not the B-rep geometry) of an AP203/AP214 STEP file: which part is
// placed where. Geometry is expected to come from separate STL files; this only recovers the placements.
//
//   const asm = parseStepAssembly(text);   // { unitScale, root, occurrences }
//   occurrence = { id, path, name, product, parent, local, world }   (row-major 4×4, translations in metres)

const IDENT = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export const mul = (a, b) => {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
};

/** Inverse of a rigid transform (rotation + translation). */
export const invRigid = (m) => {
  const r = IDENT();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 4 + j] = m[j * 4 + i];
  for (let i = 0; i < 3; i++) r[i * 4 + 3] = -(r[i * 4] * m[3] + r[i * 4 + 1] * m[7] + r[i * 4 + 2] * m[11]);
  return r;
};

/** Splits "a,b,(c,d),'e,f'" at top-level commas. */
const splitArgs = (s) => {
  const out = []; let depth = 0, cur = '', q = false;
  for (const ch of s) {
    if (ch === "'") q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && depth === 0 && ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
};
const str = (a) => (a && a.startsWith("'") ? a.slice(1, -1) : a);
const nums = (a) => a.replace(/[()]/g, '').split(',').map(Number);

export function parseStepEntities(text) {
  const data = text.slice(text.indexOf('DATA;') + 5, text.lastIndexOf('ENDSEC;'));
  const clean = data.replace(/\/\*[\s\S]*?\*\//g, '');
  const ents = new Map();
  for (const stmt of clean.split(';')) {
    const m = stmt.replace(/\s+/g, ' ').trim().match(/^#(\d+)\s*=\s*([\s\S]*)$/);
    if (!m) continue;
    const body = m[2];
    if (body.startsWith('(')) { // complex entity: (NAME(args)NAME(args)…)
      const parts = {};
      for (const p of body.slice(1, -1).matchAll(/([A-Z0-9_]+)\s*\(((?:[^()']|'[^']*'|\((?:[^()']|'[^']*'|\([^()]*\))*\))*)\)/g)) parts[p[1]] = splitArgs(p[2]);
      ents.set(+m[1], { type: 'COMPLEX', parts });
    } else {
      const p = body.match(/^([A-Z0-9_]+)\s*\(([\s\S]*)\)\s*$/);
      if (p) ents.set(+m[1], { type: p[1], args: splitArgs(p[2]) });
    }
  }
  return ents;
}

const ref = (a) => +a.slice(1);

export function parseStepAssembly(text) {
  const E = parseStepEntities(text);
  const get = (a) => E.get(ref(a));
  const ofType = (t) => [...E.entries()].filter(([, e]) => e.type === t);

  // length unit: millimetres unless a conversion factor says otherwise
  let unitScale = 0.001;
  for (const [, e] of E) {
    if (e.type !== 'COMPLEX' || !e.parts.LENGTH_UNIT) continue;
    const prefix = e.parts.SI_UNIT && e.parts.SI_UNIT[0];
    unitScale = prefix === '.MILLI.' ? 0.001 : prefix === '.CENTI.' ? 0.01 : prefix === '$' ? 1 : unitScale;
  }

  const placement = (a) => { // AXIS2_PLACEMENT_3D → 4×4
    const e = get(a);
    const o = nums(get(e.args[1]).args[1]);
    const z = e.args[2] === '$' ? [0, 0, 1] : nums(get(e.args[2]).args[1]);
    const xr = e.args[3] === '$' ? [1, 0, 0] : nums(get(e.args[3]).args[1]);
    const d = z[0] * xr[0] + z[1] * xr[1] + z[2] * xr[2];
    let x = xr.map((v, i) => v - d * z[i]);
    const nx = Math.hypot(...x); x = x.map((v) => v / nx);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [x[0], y[0], z[0], o[0] * unitScale, x[1], y[1], z[1], o[1] * unitScale, x[2], y[2], z[2], o[2] * unitScale, 0, 0, 0, 1];
  };

  const productOfDefinition = (pdId) => {
    const pd = E.get(pdId);
    const pdf = get(pd.args[2]);
    return str(get(pdf.args[2]).args[0]);
  };

  // transform of each NAUO: product_definition_shape → CONTEXT_DEPENDENT_SHAPE_REPRESENTATION → rep relationship
  const nauoOfPds = new Map();
  for (const [id, e] of ofType('PRODUCT_DEFINITION_SHAPE')) nauoOfPds.set(id, ref(e.args[2]));
  const local = new Map();
  for (const [, e] of ofType('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION')) {
    const nauo = nauoOfPds.get(ref(e.args[1]));
    const rel = get(e.args[0]);
    const idt = get(rel.parts.REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION[0]);
    // ITEM_DEFINED_TRANSFORMATION(name, desc, from, to): maps the child's frame `from` onto the parent's frame `to`
    local.set(nauo, mul(placement(idt.args[3]), invRigid(placement(idt.args[2]))));
  }

  const children = new Map();
  const isChild = new Set();
  for (const [id, e] of ofType('NEXT_ASSEMBLY_USAGE_OCCURRENCE')) {
    const parentPd = ref(e.args[3]), childPd = ref(e.args[4]);
    isChild.add(childPd);
    if (!children.has(parentPd)) children.set(parentPd, []);
    children.get(parentPd).push({ id, childPd, name: str(e.args[1]) });
  }
  const rootPd = [...children.keys()].find((pd) => !isChild.has(pd));

  const occurrences = [];
  const walk = (pd, parentPath, parentWorld) => {
    for (const { id, childPd, name } of children.get(pd) || []) {
      const l = local.get(id) || IDENT();
      const world = mul(parentWorld, l);
      const path = [...parentPath, name];
      occurrences.push({ id, path, name, product: productOfDefinition(childPd), parent: parentPath.join('/') || null, local: l, world, leaf: !children.has(childPd) });
      walk(childPd, path, world);
    }
  };
  walk(rootPd, [], IDENT());
  return { unitScale, root: productOfDefinition(rootPd), occurrences };
}
