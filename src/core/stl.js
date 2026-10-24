// STL parsing / writing. Positions are returned as a flat Float32Array (9 floats per triangle).

export function parseSTL(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const view = new DataView(bytes);
  if (bytes.byteLength >= 84) {
    const n = view.getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) return parseBinary(view, n);
  }
  const text = new TextDecoder().decode(bytes);
  if (/^\s*solid[\s\S]*facet/i.test(text)) return parseAscii(text);
  throw new Error('Not a valid STL file (neither binary nor ASCII)');
}

function parseBinary(view, n) {
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12; // skip the normal
    for (let k = 0; k < 9; k++) out[i * 9 + k] = view.getFloat32(o + k * 4, true);
  }
  return out;
}

function parseAscii(text) {
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  const vals = [];
  let m;
  while ((m = re.exec(text))) vals.push(+m[1], +m[2], +m[3]);
  if (vals.length % 9 !== 0) throw new Error('ASCII STL has a vertex count that is not a multiple of 3');
  return Float32Array.from(vals);
}

export function writeBinarySTL(positions, header = 'stl2mujoco') {
  const n = positions.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const view = new DataView(buf);
  for (let i = 0; i < Math.min(80, header.length); i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, n, true);
  for (let i = 0; i < n; i++) {
    const p = i * 9;
    const ax = positions[p + 3] - positions[p], ay = positions[p + 4] - positions[p + 1], az = positions[p + 5] - positions[p + 2];
    const bx = positions[p + 6] - positions[p], by = positions[p + 7] - positions[p + 1], bz = positions[p + 8] - positions[p + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const o = 84 + i * 50;
    view.setFloat32(o, nx / l, true); view.setFloat32(o + 4, ny / l, true); view.setFloat32(o + 8, nz / l, true);
    for (let k = 0; k < 9; k++) view.setFloat32(o + 12 + k * 4, positions[p + k], true);
  }
  return new Uint8Array(buf);
}
