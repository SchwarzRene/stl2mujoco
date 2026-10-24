// Project (de)serialisation as a zip: project.json + parts/<id>.stl, and MuJoCo package zip.
import JSZip from 'jszip';
import { parseSTL, writeBinarySTL } from './stl.js';
import { meshQuality, bbox } from './mesh.js';
import { buildMJCF } from './mjcf.js';

export async function saveProjectZip(project) {
  const zip = new JSZip();
  const parts = {};
  for (const p of Object.values(project.parts)) {
    const { positions, stats, bbox: _b, ...meta } = p;
    parts[p.id] = meta;
    zip.file(`parts/${p.id}.stl`, writeBinarySTL(positions));
  }
  zip.file('project.json', JSON.stringify({ format: 'stl2mujoco-project', version: 1, name: project.name, settings: project.settings, parts, nodes: project.nodes }, null, 2));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function loadProjectZip(data) {
  const zip = await JSZip.loadAsync(data);
  const f = zip.file('project.json');
  if (!f) throw new Error('Not an stl2mujoco project (project.json missing)');
  const doc = JSON.parse(await f.async('string'));
  if (doc.format !== 'stl2mujoco-project') throw new Error('Unknown project format');
  const project = { name: doc.name, settings: doc.settings, parts: {}, nodes: doc.nodes };
  for (const [id, meta] of Object.entries(doc.parts)) {
    const buf = await zip.file(`parts/${id}.stl`).async('arraybuffer');
    const positions = parseSTL(buf);
    project.parts[id] = { ...meta, positions, stats: meshQuality(positions), bbox: bbox(positions) };
  }
  return project;
}

export async function exportMujocoZip(project, opts) {
  const { files, report, issues, xml } = buildMJCF(project, opts);
  const zip = new JSZip();
  const root = project.name.replace(/[^A-Za-z0-9_-]/g, '_') || 'robot';
  for (const [path, bytes] of Object.entries(files)) zip.file(`${root}/${path}`, bytes);
  return { data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), report, issues, xml };
}
