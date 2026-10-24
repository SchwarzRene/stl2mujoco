// Undo / redo by snapshot + diff. The history keeps a *baseline* snapshot of the project; flush() compares the
// live project with it and, if anything changed, pushes the baseline onto the undo stack. Callers only have to
// call flush() after a burst of edits (the app does it ~300 ms after user activity), so drags, typing and async
// actions (import, refresh) become single steps without instrumenting every edit site.
// Meshes are shared by reference (they are never edited in place), so snapshots are cheap.

let seq = 0;
const ids = new WeakMap();
const meshId = (a) => { let i = ids.get(a); if (i === undefined) ids.set(a, (i = ++seq)); return i; };

function snapshot(project) {
  const parts = Object.values(project.parts);
  const nodesJson = JSON.stringify(project.nodes), settingsJson = JSON.stringify(project.settings);
  const sig = parts.map((p) => `${p.id}:${meshId(p.positions)}:${p.unitScale}:${p.name}`).join('|');
  return { name: project.name, nodesJson, settingsJson, sig, parts: parts.map((p) => ({ obj: p, positions: p.positions, stats: p.stats, bbox: p.bbox })) };
}
// compare the pieces directly: a concatenated key would keep a second full copy of the JSON in every snapshot
const same = (a, b) => a.name === b.name && a.sig === b.sig && a.settingsJson === b.settingsJson && a.nodesJson === b.nodesJson;

function restore(project, s) {
  project.name = s.name;
  project.settings = JSON.parse(s.settingsJson);
  project.nodes = JSON.parse(s.nodesJson);
  project.parts = {};
  for (const { obj, positions, stats, bbox } of s.parts) { obj.positions = positions; obj.stats = stats; obj.bbox = bbox; project.parts[obj.id] = obj; }
}

export class History {
  /** @param getProject function returning the live project (it may be replaced by "open project") */
  constructor(getProject, { limit = 100, onChange = null } = {}) {
    this.getProject = getProject; this.limit = limit; this.onChange = onChange;
    this.reset();
  }
  reset() { this.base = snapshot(this.getProject()); this.undoStack = []; this.redoStack = []; this.onChange?.(); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Record the changes made since the last flush as one undo step. Returns true if there were any. */
  flush() {
    const cur = snapshot(this.getProject());
    if (same(cur, this.base)) return false;
    this.undoStack.push(this.base);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = []; this.base = cur; this.onChange?.();
    return true;
  }
  undo() {
    this.flush(); // capture edits that are still pending
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.base);
    restore(this.getProject(), prev); this.base = prev; this.onChange?.();
    return true;
  }
  redo() {
    this.flush();
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.base);
    restore(this.getProject(), next); this.base = next; this.onChange?.();
    return true;
  }
}
