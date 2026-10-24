<p align="center"><img src="docs/images/logo.png" alt="stl2mujoco logo: a triangle-mesh block joined by a hinge to a solid block" width="160"></p>

<h1 align="center">stl2mujoco</h1>

Turn CAD parts (STL) into a **MuJoCo** robot model, in a browser-based visual editor, or headless from a CAD assembly (STEP).
Mass and inertia are computed from the meshes, servos come from a library with datasheet torque and speed, and the export is a ZIP with
`model.xml` + `meshes/` that loads directly in MuJoCo.

<p align="center"><img src="docs/images/workflow.svg" alt="Workflow: 1 add parts (STL or standard parts), 2 assemble with mates, 3 define roles and axes and check with Test pose, 4 copy and mirror sub-trees, 5 export a ZIP with model.xml and meshes that loads in MuJoCo" width="100%"></p>

## Quick start

```bash
npm install
npm run dev          # editor at http://localhost:5173
```

Run an exported model:

```bash
unzip robot_mujoco.zip
python -m mujoco.viewer --mjcf=robot/model.xml
```

## Example: Crabsy hexapod

![Crabsy hexapod built from its STEP assembly and simulated in MuJoCo](docs/images/crabsy.png)

[Crabsy](https://github.com/SamuelNoesslboeck/Crabsy), a 3D-printed hexapod with 18 servos, rebuilt from its STL files and STEP assembly. How: [Crabsy example](docs/crabsy-example.md).

## Documentation

| Page | Contents |
|---|---|
| [Using the editor](docs/editor.md) | Interface overview, assembly mates |
| [STEP import](docs/step-import.md) | Folder of STLs + CAD assembly to robot, the `robot.json` format |
| [Crabsy example](docs/crabsy-example.md) | Rebuild and walk the Crabsy hexapod step by step |
| [STL files and refreshing a part](docs/stl-and-refresh.md) | What an STL can carry, updating a part from a new STL |
| [Datasheet parts](docs/datasheet-parts.md) | Add a standard part from a datasheet with a headless Claude Code session |
| [Export accuracy](docs/export-accuracy.md) | Units, mass and inertia, servos, collision, checks |
| [Standard parts library](standard_parts/README.md) | Servos, screws, nuts, washers |
| [Development](docs/development.md) | Project layout, tests, roadmap and known limits |