// App controller: owns the project state and actions; the UI lives in src/ui/*.
import { Matrix4 } from 'three';
import { Viewport } from './ui/viewport.js';
import { newProject, addPart, addPrimitive, addNode, removeNode, dropToFloor, copyToClipboard, pasteClipboard, duplicateSubtree } from './core/project.js';
import { parseSTL } from './core/stl.js';
import { saveProjectZip, loadProjectZip, exportMujocoZip } from './core/io.js';
import { addConnector, applyMate } from './core/mates.js';
import { refreshPart } from './core/refresh.js';
import { createAssembler } from './ui/assemble.js';
import { initLibrary, reloadLibrary } from './ui/library-panel.js';
import { openDatasheetDialog } from './ui/datasheet-dialog.js';
import { renderToolbar, unitScale } from './ui/toolbar.js';
import { renderLeft as paintLeft, renderStart, renderGizmoBar } from './ui/left-panel.js';
import { renderInspector } from './ui/inspector.js';
import { h } from './ui/kit.js';

const $ = (s) => document.querySelector(s);
const app = {
  project: newProject('my_robot'), selected: null, leftTab: 'structure', clip: null, importUnit: 'mm', pop: null, refreshReport: null,
  dupOffset: [0, 60, 0], arr: { count: 3, step: [60, 0, 0] },
  open: {}, fold: {}, // remembered open/closed state of inspector sections and "advanced" folds
};
const HINT = '⟲ drag: orbit   ·   right-drag: pan   ·   wheel: zoom   ·   W move   ·   E rotate   ·   M mate   ·   Del delete';
const ctx = { app };

const viewport = new Viewport($('#viewport'), { onPick: (id) => select(id), onEdit: () => {}, onEditEnd: () => renderRight() });
ctx.viewport = viewport;
const node = () => app.project.nodes[app.selected];

/* ------------------------------ rendering ------------------------------ */
const renderLeft = () => { paintLeft(ctx); renderStart(ctx); };
const renderRight = () => renderInspector(ctx);
function renderAll() { renderToolbar(ctx); renderLeft(); renderRight(); renderGizmoBar(ctx); }
let statusTimer = null;
function changed() { viewport.refresh(); clearTimeout(statusTimer); statusTimer = setTimeout(() => renderToolbar(ctx), 400); }
function select(id) { app.selected = id; viewport.select(id); renderLeft(); renderRight(); renderGizmoBar(ctx); }
function structural(keepSel = true) {
  viewport.setProject(app.project);
  if (!keepSel || !app.project.nodes[app.selected]) app.selected = null;
  viewport.select(app.selected); renderAll();
}
function flash(msg) { app.msg = msg; $('#hint').textContent = msg; setTimeout(() => { if (app.msg === msg) $('#hint').textContent = HINT; }, 7000); }
const download = (name, bytes, type = 'application/zip') => { const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type })), download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
function pickFiles(accept, multiple, cb) {
  const i = h('input', { type: 'file', accept, multiple, onchange: () => cb([...i.files]), oncancel: () => cb([]) });
  i.click();
}

/* ------------------------------ actions ------------------------------ */
async function importFiles(files, handles = []) {
  const p = app.project;
  for (const [fi, f] of files.entries()) {
    try {
      const positions = parseSTL(await f.arrayBuffer());
      const name = f.name.replace(/\.stl$/i, '');
      const part = addPart(p, { name, positions, unitScale: unitScale(app.importUnit) });
      part.handle = handles[fi] ?? null; // lets “Refresh” re-read the file without a dialog (Chromium)
      const parent = node()?.id ?? null, first = Object.keys(p.nodes).length === 0;
      const n = addNode(p, { name, parent, partId: part.id, role: first ? 'base-fixed' : 'link', frame: parent ? undefined : { pos: [0, 0, 0], quat: [0, 0, 0, 1] } });
      app.selected = n.id;
      if (!part.stats.watertight) flash(`“${name}” is not a clean closed mesh (${part.stats.openEdges} open / ${part.stats.nonManifoldEdges} non-manifold edges) – consider a measured mass.`);
    } catch (e) { flash(`Could not import ${f.name}: ${e.message}`); }
  }
  structural(true); viewport.frameAll();
}

async function importClick() {
  if (window.showOpenFilePicker) { // keeps file handles so parts can be refreshed from the same file later
    try {
      const hs = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'STL mesh', accept: { 'model/stl': ['.stl'], 'application/octet-stream': ['.stl'] } }] });
      return importFiles(await Promise.all(hs.map((x) => x.getFile())), hs);
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  pickFiles('.stl', true, (fs) => fs.length && importFiles(fs));
}

async function openProject(f) {
  try { app.project = await loadProjectZip(await f.arrayBuffer()); app.selected = null; structural(false); viewport.frameAll(); } catch (e) { flash(e.message); }
}

async function refreshFromFile(partId) {
  const part = app.project.parts[partId];
  try {
    let file;
    if (part.handle) {
      if ((await part.handle.queryPermission?.({ mode: 'read' })) !== 'granted') await part.handle.requestPermission?.({ mode: 'read' });
      file = await part.handle.getFile();
    } else file = (await new Promise((res) => pickFiles('.stl', false, res)))[0];
    if (!file) return;
    const rep = refreshPart(app.project, partId, parseSTL(await file.arrayBuffer()));
    app.refreshReport = rep; app.open.file = true;
    const bad = rep.items.filter((i) => i.status === 'unmatched').length;
    flash(`Refreshed “${part.name}”: ${rep.items.length - bad}/${rep.items.length} connectors found again, ${rep.resnapped.length} mates re-snapped${bad ? `, ${bad} NOT found` : ''}.`);
    structural(true);
  } catch (e) { flash(`Refresh failed: ${e.message}`); }
}

function addPrimitiveNode(kind) {
  const p = app.project, part = addPrimitive(p, kind, kind === 'box' ? [0.05, 0.05, 0.05] : [0.02, 0.05]);
  const first = !Object.keys(p.nodes).length, parent = node()?.id ?? null;
  app.selected = addNode(p, { name: part.name, parent, partId: part.id, role: first ? 'base-fixed' : 'link' }).id;
  structural(true); if (first) viewport.frameAll();
}

async function doExport() {
  try {
    const res = await exportMujocoZip(app.project);
    download(`${app.project.name}_mujoco.zip`, res.data);
    const mass = res.report.reduce((s, r) => s + r.mass, 0);
    flash(`Exported ${res.report.length} bodies, ${mass.toFixed(3)} kg. Unzip, then: python -m mujoco.viewer --mjcf=<folder>/model.xml`);
  } catch (e) { flash(e.message.split('\n')[0]); app.pop = 'status'; renderToolbar(ctx); }
}

function afterPaste(made) {
  viewport.withSubtree = true; // so the copy can be dragged as a whole
  app.selected = made[0].id; structural(true); flash(`Created “${made[0].name}” (${made.length} parts).`);
}
const off = () => new Matrix4().makeTranslation(...app.dupOffset.map((v) => v / 1000));
const act = {
  import: importClick,
  mate: () => assembler.start(),
  addPrimitive: addPrimitiveNode,
  dropFloor: () => { const s = dropToFloor(app.project); changed(); renderRight(); flash(`Moved the robot ${(s * 1000).toFixed(1)} mm so it rests on the floor.`); },
  open: () => pickFiles('.zip', false, ([f]) => f && openProject(f)),
  save: async () => download(`${app.project.name}.s2m.zip`, await saveProjectZip(app.project)),
  export: doExport,
  copy: () => { if (!node()) return; app.clip = copyToClipboard(app.project, app.selected); flash(`Copied “${app.clip.name}” with all children.`); renderRight(); },
  paste: (asChild) => { if (!app.clip) return; try { afterPaste(pasteClipboard(app.project, app.clip, { parent: asChild ? app.selected : undefined, M: off() })); } catch (e) { flash(e.message); } },
  duplicate: () => { if (node()) afterPaste(duplicateSubtree(app.project, app.selected, { offset: app.dupOffset.map((v) => v / 1000) })); },
  refreshFile: refreshFromFile,
  openDatasheet: () => openDatasheetDialog({ app, flash, onAdded: onLibraryAdded, reloadLibrary }),
};
Object.assign(ctx, { flash, select, structural, changed, act, renderLeft, rerender: renderRight, onLibraryAdded });
function onLibraryAdded(nodes) { app.selected = nodes[0].id; app.leftTab = 'library'; structural(true); viewport.frameAll(); }

const assembler = createAssembler({ app, viewport, el: $('#assemble'), flash, refresh: () => { renderLeft(); renderRight(); renderToolbar(ctx); renderGizmoBar(ctx); } });

/* ------------------------------ input ------------------------------ */
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (assembler.active) assembler.stop(true); if (app.pop) { app.pop = null; renderToolbar(ctx); } }
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') act.copy();
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') act.paste(false);
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); act.duplicate(); }
  if (e.ctrlKey || e.metaKey) return;
  if (e.key === 'w') { viewport.setMode('translate'); renderGizmoBar(ctx); }
  if (e.key === 'e') { viewport.setMode('rotate'); renderGizmoBar(ctx); }
  if (e.key === 'm') act.mate();
  if (e.key === 'Delete' && node()) { removeNode(app.project, app.selected); app.selected = null; structural(false); }
});
addEventListener('click', () => { if (app.pop) { app.pop = null; renderToolbar(ctx); } });

const vp = $('#viewport');
vp.addEventListener('dragover', (e) => { e.preventDefault(); vp.classList.add('dragover'); });
vp.addEventListener('dragleave', () => vp.classList.remove('dragover'));
vp.addEventListener('drop', (e) => {
  e.preventDefault(); vp.classList.remove('dragover');
  const files = [...e.dataTransfer.files], stls = files.filter((f) => /\.stl$/i.test(f.name)), zip = files.find((f) => /\.zip$/i.test(f.name));
  if (stls.length) importFiles(stls); else if (zip) openProject(zip);
});

$('#hint').textContent = HINT;
structural(false); initLibrary(renderLeft);
window.s2m = { app, viewport, importFiles, structural, select, assembler, ctx, core: { addConnector, applyMate } }; // handy for debugging / tests
