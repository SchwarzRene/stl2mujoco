// UI smoke test of the icon-based frontend with real clicks (headless Chromium).
// Usage: npm run build && node server/serve.mjs &   then   NODE_PATH=$(npm root -g) node tests/e2e/ui-smoke.cjs [http://127.0.0.1:4173]
// Needs the 'playwright' package (not a project dependency). Prints PASS/FAIL per check and exits non-zero on failure.
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:4173';
let failed = 0; const ok = (c, m) => { if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const { writeBinarySTL } = await import('../../src/core/stl.js');
  const { extrude, polyShape, rectPoints, circlePath } = await import('../../tools/geom.mjs');
  const plate = (len) => Buffer.from(writeBinarySTL(extrude(polyShape(rectPoints(0, len, -8, 8), [circlePath(4, 0, 2.5), circlePath(len - 4, 0, 2.5)]), 0, 3))).toString('base64');
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; pg.on('pageerror', e => errs.push('PAGEERR ' + e.message)); pg.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await pg.goto(BASE + '/'); await pg.waitForTimeout(600);
  const names = () => pg.evaluate(() => Object.values(window.s2m.app.project.nodes).map(n => n.name));
  // library add
  await pg.click('[data-act="start-library"]'); await pg.waitForSelector('.lib-item:has-text("MG996R")');
  await pg.click('.lib-item:has-text("MG996R")'); await pg.waitForTimeout(1200);
  ok((await names()).length === 2, 'library add creates case + output');
  ok(await pg.locator('#start').innerHTML() === '', 'start screen hidden once a part exists');
  // duplicate button + ctrl+d, apply-to-copies appears
  await pg.click('[data-tip^="Structure"], [data-tip="Robot structure"]'); await pg.waitForTimeout(200);
  await pg.click('[data-tip^="Duplicate"]'); await pg.waitForTimeout(400);
  await pg.keyboard.press('Control+d'); await pg.waitForTimeout(400);
  ok((await names()).length === 6, 'duplicate button and Ctrl+D create copies');
  ok(await pg.locator('[data-tip^="Apply this part"]').count() === 1, 'apply-to-copies icon appears');
  // role icon + joint icon
  await pg.evaluate(() => { const n = Object.values(window.s2m.app.project.nodes)[0]; window.s2m.select(n.id); });
  await pg.click('[data-tip^="Rigid link"]'); const role = await pg.evaluate(() => Object.values(window.s2m.app.project.nodes)[0].role);
  ok(role === 'link', 'role icon sets the role (' + role + ')');
  await pg.evaluate(() => { const n = Object.values(window.s2m.app.project.nodes)[1]; window.s2m.select(n.id); });
  await pg.click('[data-tip^="Slider – moves"]'); ok(await pg.evaluate(() => Object.values(window.s2m.app.project.nodes)[1].joint.type) === 'slide', 'joint type icon works');
  await pg.click('[data-tip^="Hinge – rotates"]');
  // axis chips & limits toggle
  await pg.click('[data-tip="Joint axis (in the joint frame)"] .axis-chip.ax'); ok(await pg.evaluate(() => Object.values(window.s2m.app.project.nodes)[1].joint.axis.join()) === '1,0,0', 'axis X chip');
  await pg.click('[data-tip="Joint axis (in the joint frame)"] .axis-chip.az');
  // status & settings popovers
  await pg.click('[data-act="status"]'); ok(await pg.locator('.pop .issue').count() > 0, 'status chip opens the check list');
  await pg.click('[data-act="settings"]'); ok(await pg.locator('.pop h4:has-text("Settings")').count() === 1, 'settings popover opens');
  await pg.mouse.click(700, 500); await pg.waitForTimeout(200); ok(await pg.locator('.pop').count() === 0, 'click outside closes popovers');
  // gizmo bar
  await pg.click('[data-tip^="Rotate"]'); ok(await pg.evaluate(() => window.s2m.viewport.gizmo.mode) === 'rotate', 'gizmo bar rotate');
  const before = await pg.evaluate(() => window.s2m.viewport.withSubtree); await pg.click('[data-tip^="Take all children"]'); ok(await pg.evaluate(() => window.s2m.viewport.withSubtree) === !before, 'subtree toggle');
  // drag & drop import of an STL
  const stl = plate(40);
  await pg.evaluate(async (b64) => { const f = new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'dropped.stl'); const dt = new DataTransfer(); dt.items.add(f);
    document.querySelector('#viewport').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, stl);
  await pg.waitForTimeout(800); ok((await names()).includes('dropped'), 'drag-and-drop imports an STL');
  // refresh flow
  const longer = plate(60);
  await pg.evaluate((l) => { const { app } = window.s2m; const part = Object.values(app.project.parts).find(p => p.name === 'dropped');
    part.handle = { queryPermission: async () => 'granted', getFile: async () => new File([Uint8Array.from(atob(l), c => c.charCodeAt(0))], 'dropped.stl') };
    const n = Object.values(app.project.nodes).find(n => n.part === part.id); window.s2m.select(n.id); app.open.file = true; window.s2m.ctx.rerender(); }, longer);
  await pg.click('[data-tip^="Reload from the linked file"]'); await pg.waitForTimeout(1000);
  ok(/Refreshed/.test(await pg.locator('#hint').innerText()), 'refresh from linked file reports');
  console.log('errors', JSON.stringify(errs)); if (errs.length || failed) process.exitCode = 1;
  await b.close();
})();
