import { describe, it, expect } from 'vitest';
import { newProject, addPrimitive, addNode, duplicateSubtree, mirrorSubtree, removeNode, subtreeIds } from '../src/core/project.js';
import { addPart } from '../src/core/project.js';
import { refreshPart } from '../src/core/refresh.js';
import { addConnector } from '../src/core/mates.js';
import { History } from '../src/core/history.js';
import { extrude, polyShape, rectPoints, circlePath } from '../tools/geom.mjs';

function robot() {
  const p = newProject('h');
  const base = addNode(p, { name: 'base', partId: addPrimitive(p, 'box', [0.1, 0.1, 0.02]).id, role: 'base' });
  const arm = addNode(p, { name: 'arm', parent: base.id, partId: addPrimitive(p, 'cylinder', [0.01, 0.1]).id, role: 'servo' });
  return { p, base, arm };
}
const count = (p) => Object.keys(p.nodes).length;

describe('undo / redo history', () => {
  it('reports no change when nothing changed, and nothing to undo', () => {
    const { p } = robot(); const h = new History(() => p);
    expect(h.flush()).toBe(false); expect(h.canUndo).toBe(false); expect(h.undo()).toBe(false); expect(h.redo()).toBe(false);
  });

  it('undoes and redoes a duplicate exactly', () => {
    const { p, base } = robot(); const h = new History(() => p);
    const before = JSON.stringify(p.nodes);
    duplicateSubtree(p, base.id, { offset: [0.2, 0, 0] });
    expect(count(p)).toBe(4);
    expect(h.undo()).toBe(true);
    expect(count(p)).toBe(2); expect(JSON.stringify(p.nodes)).toBe(before);
    const afterDup = (h.redo(), JSON.stringify(p.nodes));
    expect(count(p)).toBe(4);
    expect(h.undo() && h.redo()).toBe(true); expect(JSON.stringify(p.nodes)).toBe(afterDup);
  });

  it('groups a burst of edits into one step and a new edit clears redo', () => {
    const { p, arm } = robot(); const h = new History(() => p);
    arm.name = 'a'; arm.joint.damping = 3; p.settings.timestep = 0.001; arm.partPose.pos[0] = 0.5;   // one burst
    expect(h.flush()).toBe(true); expect(h.undoStack.length).toBe(1);
    h.undo();
    const arm2 = Object.values(p.nodes).find((n) => n.role === 'servo'); // nodes are fresh objects after a restore
    expect(arm2.name).toBe('arm'); expect(arm2.partPose.pos[0]).not.toBe(0.5); expect(arm2.joint.damping).not.toBe(3); expect(p.settings.timestep).toBe(0.002);
    expect(h.canRedo).toBe(true);
    arm2.name = 'other'; h.flush(); expect(h.canRedo).toBe(false);
  });

  it('undo captures edits that were not flushed yet', () => {
    const { p, base } = robot(); const h = new History(() => p);
    removeNode(p, base.id);                      // no flush() before undo
    expect(count(p)).toBe(0);
    expect(h.undo()).toBe(true); expect(count(p)).toBe(2);
  });

  it('undoes a mirror (which adds meshes) and brings the mesh back on redo', () => {
    const { p, base } = robot(); const h = new History(() => p);
    const parts0 = Object.keys(p.parts).length;
    const made = mirrorSubtree(p, base.id, 1);
    const mirroredPart = p.parts[made[0].part];
    expect(Object.keys(p.parts).length).toBeGreaterThan(parts0);
    h.undo(); expect(Object.keys(p.parts).length).toBe(parts0); expect(count(p)).toBe(2);
    h.redo(); expect(p.parts[mirroredPart.id]).toBe(mirroredPart); expect(count(p)).toBe(4);
  });

  it('undoes a part refresh (mesh and connectors) and redoes it', () => {
    const p = newProject('r');
    const plate = (len) => extrude(polyShape(rectPoints(0, len, -8, 8), [circlePath(4, 0, 2.5), circlePath(len - 4, 0, 2.5)]), 0, 3);
    const part = addPart(p, { name: 'bar', positions: plate(40), unitScale: 0.001 });
    const n = addNode(p, { name: 'bar', partId: part.id });
    addConnector(n, { name: 'hole_right', pos: [0.036, 0, 0.003], normal: [0, 0, 1] });
    const h = new History(() => p); const oldPos = part.positions;
    refreshPart(p, part.id, plate(60));
    expect(part.positions).not.toBe(oldPos);
    h.undo();
    expect(part.positions).toBe(oldPos);                                         // the very same mesh object
    expect(Object.values(p.nodes)[0].connectors[0].pos[0]).toBeCloseTo(0.036, 9);
    h.redo(); expect(Object.values(p.nodes)[0].connectors[0].pos[0]).toBeCloseTo(0.056, 6);
  });

  it('keeps at most `limit` steps and reset() clears everything', () => {
    const { p, arm } = robot(); const h = new History(() => p, { limit: 5 });
    for (let i = 1; i <= 8; i++) { Object.values(p.nodes).find((n) => n.role === 'servo').name = `n${i}`; h.flush(); }
    expect(h.undoStack.length).toBe(5);
    h.reset(); expect(h.canUndo).toBe(false); expect(h.canRedo).toBe(false); void arm;
  });

  it('follows a replaced project object ("open project")', () => {
    let { p } = robot(); const h = new History(() => p);
    p = newProject('other'); h.reset();
    addNode(p, { name: 'x', partId: addPrimitive(p, 'box', [0.1, 0.1, 0.1]).id });
    expect(h.flush()).toBe(true); h.undo(); expect(count(p)).toBe(0);
    void subtreeIds;
  });
});
