// End-to-end check of the Mate workflow with real mouse clicks (headless Chromium).
// Usage: npm run build && npx vite preview --port 4173 &   then   node tests/e2e/mate-flow.cjs out.png
// Needs the 'playwright' package (not a project dependency): NODE_PATH=$(npm root -g) node tests/e2e/mate-flow.cjs out.png
const { chromium } = require('playwright');
const SCREEN = (x, y, z) => `(() => { const v = window.s2m.viewport; const w = new (v.camera.position.constructor)(${x}, ${y}, ${z}); const r = v.renderer.domElement.getBoundingClientRect(); const p = w.project(v.camera); return [r.left + (p.x+1)/2*r.width, r.top + (1-p.y)/2*r.height]; })()`;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push('PAGEERR ' + e.message)); pg.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await pg.goto('http://localhost:4173/');
  await pg.click('text=＋ Box'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const n = Object.values(window.s2m.app.project.nodes)[0]; n.name = 'plate'; window.s2m.select(null); });
  await pg.click('text=Parts library'); await pg.waitForSelector('.lib-item:has-text("MG996R")');
  await pg.click('.lib-item:has-text("MG996R")'); await pg.waitForTimeout(1500);
  await pg.evaluate(() => { const {viewport} = window.s2m; viewport.camera.position.set(0.16,-0.22,0.14); viewport.orbit.target.set(0.05,0,0); });
  await pg.click('text=⚙ Mate parts'); await pg.waitForTimeout(500);
  const m1 = await pg.evaluate(`(() => { const v = window.s2m.viewport; const n = Object.values(window.s2m.app.project.nodes).find(n => n.name.includes('/ case')); const c = n.connectors.find(c => c.name === 'ear_hole_1_top'); const m = v.markers[c.id]; m.group.updateMatrixWorld(true); const w = new (v.camera.position.constructor)().setFromMatrixPosition(m.group.matrixWorld); const r = v.renderer.domElement.getBoundingClientRect(); const p = w.project(v.camera); return [r.left + (p.x+1)/2*r.width, r.top + (1-p.y)/2*r.height]; })()`);
  console.log('marker screen', m1.map(Math.round));
  await pg.mouse.move(m1[0], m1[1]); await pg.mouse.click(m1[0], m1[1]); await pg.waitForTimeout(500);
  const f = await pg.evaluate(SCREEN(0.012, 0.012, 0.025));
  await pg.mouse.move(f[0], f[1]); await pg.waitForTimeout(400); await pg.mouse.click(f[0], f[1]); await pg.waitForTimeout(1500);
  const info = await pg.evaluate(() => { const p = window.s2m.app.project; return Object.values(p.nodes).map(n => ({ name: n.name, parent: p.nodes[n.parent]?.name, joint: n.joint.type, pos: n.partPose.pos.map(v => +(v*1000).toFixed(1)), conns: n.connectors.length })); });
  console.log(JSON.stringify(info));
  console.log('card:', await pg.evaluate(() => document.querySelector('#assemble').innerText.slice(0, 260).replace(/\n/g, ' | ')));
  await pg.screenshot({ path: process.argv[2] });
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
