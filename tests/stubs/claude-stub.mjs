#!/usr/bin/env node
// Stand-in for the `claude` CLI used by the API tests. Behaviour via STUB_MODE: ok | bad-then-fix | always-bad | fail
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
const a = process.argv.slice(2);
if (a.includes('--version')) { console.log('0.0.0-stub (Claude Code)'); process.exit(0); }
const arg = (n) => a[a.indexOf(n) + 1];
const prompt = arg('-p');
const fail = (m) => { console.log(JSON.stringify({ type: 'result', is_error: true, result: m })); process.exit(1); };
// safety contract of the runner
if (arg('--tools') !== 'Read,Write,Glob') fail('tools not restricted');
const dis = a.slice(a.indexOf('--disallowedTools') + 1, a.indexOf('--strict-mcp-config'));
for (const t of ['Bash', 'WebFetch', 'WebSearch']) if (!dis.includes(t)) fail(`${t} not disallowed`);
if (!existsSync('input/SCHEMA.md') || !existsSync('out')) fail('wrong working directory');
const mode = process.env.STUB_MODE ?? 'ok';
if (mode === 'fail') fail('simulated failure');
const good = {
  schema: 1, id: 'servo_stub_s1', name: 'Stub S1 servo', category: 'Servos', description: 'from stub', type: 'hobby_servo', color: '#445566',
  params: { L: 32, W: 15, H: 30, earLen: 45, earSpacing: 40, earHole: 3.5, earT: 2, earTop: -6, shaftFromEnd: 8, bossD: 10, bossH: 2, splineD: 4.5, splineTop: 5 },
  mass_kg: 0.03, servo: { range_deg: [-90, 90], defaultVoltage: '6.0', voltages: { '6.0': { stall_torque: 0.5, noload_speed: 8 } } },
  dims_status: { overall_size: 'datasheet', hole_pattern: 'estimate – verify' }, sources: [{ title: 'Stub datasheet', url: 'https://example.com/ds.pdf' }, { title: 'bad link', url: 'javascript:alert(1)' }],
};
const bad = { ...good, params: { ...good.params, L: -3 } };
const second = prompt.includes('failed validation');
writeFileSync('out/spec.json', JSON.stringify(mode === 'always-bad' || (mode === 'bad-then-fix' && !second) ? bad : good));
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: `${process.cwd()}/input/datasheet.txt` } }, { type: 'text', text: 'Extracted a 32x15x30 servo.' }] } }));
console.log(JSON.stringify({ type: 'result', is_error: false, result: 'Extracted a servo; hole pattern is an estimate.', total_cost_usd: 0.01 }));
