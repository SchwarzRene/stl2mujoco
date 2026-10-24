import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { poseToMatrix, matrixToPose, applyWorldTransform, children, roots } from '../core/project.js';
import { connectorLocalMatrix } from '../core/mates.js';
import { snap } from '../core/features.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // CAD / MuJoCo convention: Z up

export class Viewport {
  constructor(el, { onPick, onEdit, onEditEnd, onSurface, onMarker }) {
    this.el = el; this.onPick = onPick; this.onEdit = onEdit; this.onEditEnd = onEditEnd; this.onSurface = onSurface; this.onMarker = onMarker;
    this.pickMode = false; this.showAllConnectors = false; this.snapMode = 'auto'; this.markers = {}; this.activeConnectors = new Set();
    this.project = null; this.selected = null; this.preview = {};
    this.target = 'both'; this.withSubtree = false;
    this.objs = {}; this.geoms = {};
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); el.prepend(r.domElement);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x14171c);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.005, 50); this.camera.up.set(0, 0, 1); this.camera.position.set(0.5, -0.6, 0.4);
    this.orbit = new OrbitControls(this.camera, r.domElement); this.orbit.target.set(0, 0, 0.05); this.orbit.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1, -1, 2); this.scene.add(sun);
    const grid = new THREE.GridHelper(2, 40, 0x44556a, 0x2a3442); grid.rotation.x = Math.PI / 2; this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(0.1));
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.proxy = new THREE.Object3D(); this.scene.add(this.proxy);
    this.gizmo = new TransformControls(this.camera, r.domElement); this.scene.add(this.gizmo.getHelper());
    this.gizmo.setSize(0.8); this.gizmo.setTranslationSnap(null);
    this.gizmo.addEventListener('dragging-changed', (e) => { this.orbit.enabled = !e.value; if (!e.value) { this.onEditEnd?.(); } });
    this.gizmo.addEventListener('objectChange', () => this.#gizmoMoved());
    this.last = new THREE.Matrix4();
    this.ray = new THREE.Raycaster();
    let down = null;
    r.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    r.domElement.addEventListener('pointerup', (e) => {
      if (!down || this.gizmo.dragging || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      if (this.pickMode) this.#pickSurface(e, false); else this.#pick(e);
    });
    let pending = false;
    r.domElement.addEventListener('pointermove', (e) => {
      if (!this.pickMode || pending || e.buttons) return;
      pending = true; requestAnimationFrame(() => { pending = false; this.#pickSurface(e, true); });
    });
    this.preview3d = new THREE.Group(); this.preview3d.visible = false; this.scene.add(this.preview3d);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false }));
    dot.renderOrder = 30; this.preview3d.add(dot);
    this.previewArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.025, 0xffd23f, 0.007, 0.005);
    this.previewArrow.line.material.depthTest = false; this.previewArrow.cone.material.depthTest = false; this.previewArrow.renderOrder = 30; this.preview3d.add(this.previewArrow);
    this.previewRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide, depthTest: false }));
    this.previewRing.renderOrder = 30; this.preview3d.add(this.previewRing);
    new ResizeObserver(() => this.resize()).observe(el); this.resize();
    r.setAnimationLoop(() => { this.orbit.update(); r.render(this.scene, this.camera); });
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setSize(w, h); this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix();
  }

  setMode(mode) { this.gizmo.setMode(mode); }
  setSpace(space) { this.gizmo.setSpace(space); }

  /** Rebuild scene objects after structural changes. */
  setProject(project) {
    this.project = project;
    for (const o of Object.values(this.objs)) {
      this.root.remove(o.group);
      if (o.mesh) { this.root.remove(o.mesh); o.mesh.material.dispose(); }
    }
    const live = new Set(Object.values(project.nodes).map((n) => n.part));
    for (const [id, g] of Object.entries(this.geoms)) if (!live.has(id)) { g.g.dispose(); delete this.geoms[id]; }
    this.objs = {};
    for (const m of Object.values(this.markers)) this.root.remove(m.group);
    this.markers = {};
    for (const n of Object.values(project.nodes)) {
      const part = project.parts[n.part];
      const group = new THREE.Group(); // frame helper, positioned at node display frame
      const axes = new THREE.AxesHelper(0.04); axes.renderOrder = 10; axes.material.depthTest = false; group.add(axes);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.06, 0xffd23f, 0.012, 0.008);
      arrow.line.material.depthTest = false; arrow.cone.material.depthTest = false; arrow.renderOrder = 11; group.add(arrow);
      let mesh = null;
      if (part) {
        if (!this.geoms[part.id] || this.geoms[part.id].src !== part.positions) {
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3)); g.computeVertexNormals();
          this.geoms[part.id] = { g, src: part.positions };
        }
        mesh = new THREE.Mesh(this.geoms[part.id].g, new THREE.MeshStandardMaterial({ color: n.color, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide }));
        mesh.matrixAutoUpdate = false; mesh.userData.node = n.id; this.root.add(mesh);
      }
      group.matrixAutoUpdate = false; this.root.add(group);
      this.objs[n.id] = { group, mesh, arrow, axes };
    }
    this.refresh();
  }

  #display() {
    const D = {}, p = this.project;
    const visit = (n, pd, pf) => {
      const F = poseToMatrix(n.frame);
      const M = pd ? pd.clone().multiply(pf.clone().invert()).multiply(F) : F.clone();
      const q = this.preview[n.id] || 0;
      const a = new THREE.Vector3(...n.joint.axis).normalize();
      if (q && n.joint.type === 'hinge') M.multiply(new THREE.Matrix4().makeRotationAxis(a, q));
      if (q && n.joint.type === 'slide') M.multiply(new THREE.Matrix4().makeTranslation(a.x * q, a.y * q, a.z * q));
      D[n.id] = M;
      for (const c of children(p, n.id)) visit(c, M, F);
    };
    for (const r of roots(p)) visit(r, null, null);
    return D;
  }

  get previewing() { return Object.values(this.preview).some((v) => Math.abs(v) > 1e-9); }

  refresh() {
    if (!this.project) return;
    const D = this.#display();
    for (const n of Object.values(this.project.nodes)) {
      const o = this.objs[n.id]; if (!o) continue;
      const M = D[n.id] ?? poseToMatrix(n.frame);
      o.group.matrix.copy(M); o.group.matrixWorldNeedsUpdate = true;
      const j = n.joint, hasAxis = j.type === 'hinge' || j.type === 'slide';
      o.arrow.visible = hasAxis; if (hasAxis) o.arrow.setDirection(new THREE.Vector3(...j.axis).normalize());
      if (o.mesh) {
        const part = this.project.parts[n.part], s = part.unitScale;
        o.mesh.matrix.copy(M).multiply(poseToMatrix(n.frame).invert()).multiply(poseToMatrix(n.partPose)).multiply(new THREE.Matrix4().makeScale(s, s, s));
        o.mesh.matrixWorldNeedsUpdate = true; o.mesh.material.color.set(n.color);
        o.mesh.material.emissive.set(n.id === this.selected ? 0x16324f : 0x000000);
      }
      o.axes.visible = n.id === this.selected || !o.mesh;
      this.#updateMarkers(n, D[n.id] ?? poseToMatrix(n.frame));
    }
    this.#attachGizmo();
  }

  #updateMarkers(n, M) {
    const show = this.showAllConnectors || n.id === this.selected;
    const base = M.clone().multiply(poseToMatrix(n.frame).invert()).multiply(poseToMatrix(n.partPose));
    for (const c of n.connectors ?? []) {
      let m = this.markers[c.id];
      if (!m) {
        const group = new THREE.Group(); group.matrixAutoUpdate = false;
        const axes = new THREE.AxesHelper(0.014); axes.material.depthTest = false; axes.renderOrder = 20; group.add(axes);
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 12, 8), new THREE.MeshBasicMaterial({ color: 0x35e0a1, depthTest: false })); sphere.renderOrder = 21; group.add(sphere);
        const hit = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); hit.userData.connector = { node: n.id, id: c.id }; group.add(hit);
        this.root.add(group); m = this.markers[c.id] = { group, sphere, hit };
      }
      m.group.visible = show;
      m.group.matrix.copy(base).multiply(connectorLocalMatrix(c)); m.group.matrixWorldNeedsUpdate = true;
      m.sphere.material.color.set(this.activeConnectors.has(c.id) ? 0xff6b6b : 0x35e0a1);
    }
  }

  setPickMode(on, { showAll = on } = {}) { this.pickMode = on; this.showAllConnectors = showAll; if (!on) this.preview3d.visible = false; this.refresh(); }
  highlightConnectors(ids) { this.activeConnectors = new Set(ids); this.refresh(); }

  #pickSurface(e, hover) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hits = Object.values(this.markers).filter((m) => m.group.visible).map((m) => m.hit);
    const mh = this.ray.intersectObjects(hits, false)[0];
    if (mh) { this.preview3d.visible = false; if (!hover) this.onMarker?.(mh.object.userData.connector); return; }
    const meshes = Object.values(this.objs).map((o) => o.mesh).filter(Boolean);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    if (!hit) { this.preview3d.visible = false; return; }
    const part = this.project.parts[this.project.nodes[hit.object.userData.node].part];
    hit.object.updateMatrixWorld(true);
    const local = hit.object.worldToLocal(hit.point.clone()).toArray();
    const s = snap(part.positions, hit.faceIndex, local, this.snapMode);
    const wp = hit.object.localToWorld(new THREE.Vector3(...s.pos));
    const wn = new THREE.Vector3(...s.normal).transformDirection(hit.object.matrixWorld).normalize();
    this.preview3d.position.copy(wp); this.preview3d.visible = true;
    this.previewArrow.setDirection(wn);
    this.previewRing.visible = s.kind === 'circle';
    if (s.kind === 'circle') { const r = s.radius * part.unitScale; this.previewRing.scale.setScalar(r); this.previewRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wn); }
    this.snapKind = s.kind;
    if (!hover) this.onSurface?.({ node: hit.object.userData.node, snap: s });
  }

  select(id) { this.selected = id; this.refresh(); }

  #attachGizmo() {
    if (this.gizmo.dragging) return; // keep the proxy stable while dragging
    const n = this.project?.nodes[this.selected];
    if (!n || this.previewing) { this.gizmo.detach(); return; }
    const pose = this.target === 'part' ? n.partPose : n.frame;
    if (this.target === 'part' && !n.part) { this.gizmo.detach(); return; }
    const m = poseToMatrix(pose);
    m.decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
    this.proxy.updateMatrix(); this.last.copy(this.proxy.matrix);
    this.gizmo.attach(this.proxy);
  }

  #gizmoMoved() {
    this.proxy.updateMatrix();
    const now = this.proxy.matrix.clone();
    const delta = now.clone().multiply(this.last.clone().invert());
    this.last.copy(now);
    const t = this.target;
    applyWorldTransform(this.project, this.selected, delta, {
      subtree: this.withSubtree && t !== 'part', frame: t !== 'part', part: t !== 'frame',
    });
    this.refresh();
    this.onEdit?.();
  }

  #pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const meshes = Object.values(this.objs).map((o) => o.mesh).filter(Boolean);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    this.onPick?.(hit ? hit.object.userData.node : null);
  }

  frameAll() {
    const box = new THREE.Box3();
    for (const o of Object.values(this.objs)) if (o.mesh) { o.mesh.updateMatrixWorld(true); box.expandByObject(o.mesh); }
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length();
    this.orbit.target.copy(c);
    this.camera.position.copy(c).add(new THREE.Vector3(0.8, -1, 0.6).normalize().multiplyScalar(s * 1.4));
    this.camera.near = s / 500; this.camera.far = s * 50; this.camera.updateProjectionMatrix();
  }
}
