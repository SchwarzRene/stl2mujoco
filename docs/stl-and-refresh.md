[< Back to the README](../README.md)

# STL files and refreshing a part

## STL files carry no assembly information

CAD assemblies (Solid Edge `.asm`, …) are proprietary, and STL files are exported per part in their own coordinate system,
so **part placement and joint axes cannot be recovered automatically**. That is what the visual editor is for.
Tip: export STLs from the *assembly* (positions preserved) if your CAD supports it – then parts are already in place and only roles/joints are needed.

The [STEP importer](step-import.md) is the way around this when you have the CAD assembly.

## What an STL can (and cannot) carry – and "Refresh part"

An STL is **only a bag of unnamed triangles**: no hole names, no features, no parameters, not even units. A hole is just
a ring of triangles. So nothing in the file says "this is the servo hole" – the editor *recognises geometry* instead
(circular rims → hole/boss centres, planar faces, edges) and stores your connectors as frames on the part.

When you change a part in CAD (say, a longer link), re-export the STL and click the **refresh icon** in that part's *Part file* section
(in Chromium the editor remembers the file you imported, so it is one click):

1. each connector is re-found on the new mesh – a hole connector matches a hole of the **same radius and direction**,
   a face connector the face with the same normal;
2. the expected position keeps the **offset from the nearest end** of the part on every axis, so the near holes stay
   and the far holes move with the far end;
3. every part attached to it by a mate is **re-snapped with its sub-assembly** – no need to place anything again;
4. a report lists what was found, what moved by how many mm, and what was not found (those mates are left untouched).

Only the geometry you change should change: if you also move holes around, add holes of the same size next to each
other, or remove one, the matching can pick a different hole or report it as *not found* – check the report.
STEP files do carry exact cylindrical faces (and sometimes names); importing STEP is a possible future improvement.
