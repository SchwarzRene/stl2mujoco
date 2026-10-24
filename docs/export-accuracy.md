[< Back to the README](../README.md)

# What makes the export accurate

| Topic | What is done |
|---|---|
| Units | Everything is SI (m, kg, rad). Meshes are scaled by MuJoCo's `scale` – STL data is exported unmodified. |
| Mass / inertia | Volume, centre of mass and the **full inertia tensor** are integrated exactly from the triangle mesh (signed tetrahedra) in the joint frame and written as an explicit `<inertial … fullinertia>`. Mass comes from a material density **or** a measured mass (then the tensor is scaled). Verified against analytic box/cylinder/sphere values in the tests. |
| Kinematics | Poses are stored in world space in the reference pose and converted to parent-relative `pos`/`quat`; joint axes are expressed in the joint frame. |
| Servos | Datasheet torque and speed are reproduced: position actuator clipped at the **stall torque** plus joint damping = stall torque ÷ no-load speed (the DC-motor torque/speed line), so a servo never exceeds its no-load speed and is overpowered above its stall torque. Verified in MuJoCo tests. Inertia/friction are flagged estimates. See [standard_parts](../standard_parts/README.md). |
| Collision | Separate invisible collision geoms (group 3). MuJoCo uses the **convex hull** of a mesh; large meshes are simplified (default ≤ 20 000 triangles) for collision only. Visuals are exported 1:1. Concave parts (e.g. a ring) collide as their hull – split them or disable collision where that matters. |
| Checks | Warns about non-watertight meshes (mass unreliable → use measured mass), joints without mass, bad ranges, parts below the floor, etc. |
| Sensors | Optional joint position/velocity sensors and a base IMU (gyro, accelerometer, pose). |
