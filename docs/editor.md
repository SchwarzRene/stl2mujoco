[< Back to the README](../README.md)

# Using the editor

## The interface at a glance

Everything is icon-first; hover an icon for its name and a short explanation.

- **Toolbar:** import (↓), **build from STEP** (assembly icon, see [STEP import](step-import.md)), mate (🔗), add box / cylinder, unit of imported STLs · drop to floor, open, save · **undo / redo** (Ctrl+Z, Ctrl+Shift+Z) · status chip (✓ / ⚠ n – click for the list of checks), settings (sliders) · **Export**.
- **Left:** structure tree (icon = role) or the parts library (grid tab). **Drop STL files anywhere** in the 3D view to import them.
- **3D view:** floating bar with move / rotate, what to move (part + joint, part only, joint frame only) and "take children along".
- **Inspector (right):** name, **role icons** (floating base, fixed base, link, servo, motor, wheel, slider, hinge, ball), an action bar (copy, paste, duplicate, mirror X/Y/Z, arrays, apply to copies) and collapsible sections – *Placement, Joint, Servo / Drive, Mass & collision, Connectors, Part file, Library part, Copies*. **Every edit can be undone** – a drag, a typed number, a paste, a mate or a part refresh is one step (up to 100 steps; opening another project resets the history). Rarely used numbers sit behind the sliders-icon fold; sections that matter for the selected part open by themselves.

## Assembly mates

A *connector* is a frame on a part (green marker: origin + Z = surface normal / axis). In **Mate** mode you click on the geometry and the editor snaps to **hole/boss centres**, **face centres**, **vertices** or **edge midpoints** (or an exact point); library parts already carry connectors for their mounting holes and shaft.
A mate puts the two connectors together face-to-face (Flip aligns the Z axes instead), with optional offset and rotation, moves the part *and everything attached to it*, makes it a child of the target and sets the joint: rigid = welded, revolute = hinge about connector Z, slider = slide along Z, ball. Servo outputs are already hinge joints – mate your links rigidly to the servo's `output_top` marker.

Next: [Export accuracy](export-accuracy.md) | [Refreshing a part](stl-and-refresh.md)
