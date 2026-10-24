// Builds a minimal STEP assembly (structure + placements only) for tests.
//   stepFixture(['robot', 'body', 'plate'], [{ parent: 'robot', child: 'body' }, { parent: 'body', child: 'plate', pos: [0, 0, 5] }])
// pos in mm, rotZ in degrees: the placement of the child in its parent.
export function stepFixture(products, usages) {
  let id = 100;
  const lines = [];
  const add = (body) => { lines.push(`#${++id}=${body};`); return id; };
  const ctx = add("PRODUCT_CONTEXT('',#1,'mechanical')");
  const pd = {};
  for (const name of products) {
    const prod = add(`PRODUCT('${name}','${name}','',(#${ctx}))`);
    const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
    pd[name] = add(`PRODUCT_DEFINITION('design','',#${pdf},#${ctx})`);
  }
  const axis = (pos, rotZ = 0) => {
    const loc = add(`CARTESIAN_POINT('',(${pos.join(',')}))`);
    const z = add("DIRECTION('',(0.,0.,1.))");
    const r = (rotZ * Math.PI) / 180;
    const x = add(`DIRECTION('',(${Math.cos(r)},${Math.sin(r)},0.))`);
    return add(`AXIS2_PLACEMENT_3D('',#${loc},#${z},#${x})`);
  };
  usages.forEach((u, i) => {
    const nauo = add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${i}','${u.name ?? u.child}','',#${pd[u.parent]},#${pd[u.child]},$)`);
    const pds = add(`PRODUCT_DEFINITION_SHAPE('','',#${nauo})`);
    const idt = add(`ITEM_DEFINED_TRANSFORMATION('','',#${axis([0, 0, 0])},#${axis(u.pos ?? [0, 0, 0], u.rotZ ?? 0)})`);
    const rel = add(`(REPRESENTATION_RELATIONSHIP('','',#1,#2)REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${idt})SHAPE_REPRESENTATION_RELATIONSHIP())`);
    add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${rel},#${pds})`);
  });
  return `ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
