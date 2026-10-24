// Small UI toolkit: DOM helper, icon buttons, segmented groups, collapsible sections, number fields.
import { icon } from './icons.js';

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  // ::after tooltips cannot be drawn on replaced elements, so give those the native title as well
  if (props?.['data-tip'] && /^(select|input|textarea)$/.test(tag)) el.setAttribute('title', String(props['data-tip']).replace(/\n/g, ' – '));
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

/** Icon button. `tip` is the tooltip (also the accessible label). opts: on, primary, danger, label, disabled, act, size */
export function ib(name, tip, onclick, { on = false, primary = false, danger = false, label = '', disabled = false, act = '', size = 18 } = {}) {
  const b = h('button', { class: `ib${on ? ' on' : ''}${primary ? ' primary' : ''}${danger ? ' danger' : ''}${label ? ' lbl' : ''}`, 'data-tip': tip, 'aria-label': tip, disabled, 'data-act': act || null, onclick }, icon(name, size), label ? h('span', {}, label) : null);
  return b;
}
/** Segmented icon group; items = [{icon, tip, on, onclick}] */
export const seg = (items) => h('div', { class: 'seg' }, items.map((i) => ib(i.icon, i.tip, i.onclick, { on: i.on, size: i.size ?? 17 })));

const AXIS = ['x', 'y', 'z'];
/** Three number inputs with coloured X/Y/Z chips. */
export function xyz(values, onset, { step = 1, unit = '' } = {}) {
  return h('div', { class: 'xyz' }, values.map((v, k) => h('label', { class: `xyz-c a${AXIS[k]}` }, h('i', {}, AXIS[k].toUpperCase()),
    h('input', { type: 'number', step, value: +Number(v).toFixed(4), onchange: (e) => { const nv = parseFloat(e.target.value); if (Number.isFinite(nv)) onset(k, nv); } })),
  ), unit ? h('span', { class: 'unit' }, unit) : null);
}
export function num(value, onset, { step = 1, unit = '', tip = '', icon: ic = null, w = null } = {}) {
  return h('label', { class: 'numf', 'data-tip': tip || null, style: w ? `width:${w}` : null }, ic ? icon(ic, 14) : null,
    h('input', { type: 'number', step, value: +Number(value).toFixed(6), onchange: (e) => { const nv = parseFloat(e.target.value); if (Number.isFinite(nv)) onset(nv); } }), unit ? h('span', { class: 'unit' }, unit) : null);
}

/** Collapsible section with icon header; open state is remembered in `state[key]`. */
export function section(state, key, ic, title, body, { summary = '', rerender, defaultOpen = false, actions = null } = {}) {
  // the default depends on the selected part until the user opens/closes the section explicitly
  const open = state[key] !== undefined ? state[key] : defaultOpen;
  return h('section', { class: `sec${open ? ' open' : ''}` },
    h('header', { class: 'sec-h', onclick: () => { state[key] = !open; rerender(); } }, icon('chevron', 14), icon(ic, 16), h('b', {}, title), summary ? h('em', {}, summary) : null, h('span', { style: 'flex:1' }), actions),
    open ? h('div', { class: 'sec-b' }, body) : null);
}
export const row = (...kids) => h('div', { class: 'r' }, kids);

/** replaceChildren that ignores null/false (the DOM would print "null") and flattens arrays. */
export const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
