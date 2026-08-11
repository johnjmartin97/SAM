"""Sculpt the Samoyed and export it to public/models/samoyed.glb.

    npm run model

Built by cross-section, not by fusing spheres. The core -- nose, muzzle, stop,
skull, neck, withers, chest, loin, hip, rump -- is ONE lofted tube, because
that is what a quadruped's body actually is. Every section below is a place
where an anatomical fact gets stated, and the numbers are the breed:

  * a deep chest that drops well below the elbow, and a clear tuck-up at the
    loin -- the two things that make a dog read as a dog in silhouette;
  * a defined stop (the brow break between skull and muzzle), which is most of
    what makes a face look like a face;
  * a heavy neck ruff, small triangular ears set wide, and the plumed tail
    carried over the back -- the three things that say Samoyed specifically.

Legs are swept along a path with the correct zigzag: a dog's hind leg has a
stifle and a hock, not a straight column.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from critterlib import join_into, material, reset_scene, shape  # noqa: E402
from sculpt import (  # noqa: E402
    decimate, loft, section, smooth_shade, subdivide, tube, weight_to_bones,
)
from rig import build_actions, build_armature  # noqa: E402

OUT = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                 "public", "models", "samoyed.glb")
)

CREAM = (0.965, 0.953, 0.933, 1.0)
DARK = (0.086, 0.086, 0.102, 1.0)
TONGUE = (0.862, 0.435, 0.463, 1.0)
INNER_EAR = (0.902, 0.706, 0.686, 1.0)

# He is drawn seventeen times: once as skin, sixteen times as fur shells.
TRIANGLE_BUDGET = 24000

# (z, centre y, half width, up, down, exponent)
# Read this as a side view: z runs from the nose (-1.05) to the tail (0.58).
CORE = [
    (-0.930, 0.893, 0.070, 0.058, 0.052, 2.2),  # nose tip
    (-0.890, 0.893, 0.100, 0.082, 0.072, 2.2),  # nose
    (-0.845, 0.896, 0.122, 0.100, 0.088, 2.3),  # muzzle, front
    (-0.795, 0.902, 0.142, 0.116, 0.102, 2.4),  # muzzle, mid -- blunt, not fox
    (-0.745, 0.912, 0.168, 0.136, 0.118, 2.4),  # muzzle, base
    (-0.700, 0.945, 0.205, 0.166, 0.145, 2.5),  # the stop
    (-0.650, 0.980, 0.234, 0.186, 0.168, 2.6),  # brow and eyes
    (-0.590, 1.000, 0.250, 0.192, 0.188, 2.6),  # skull, widest
    (-0.520, 0.995, 0.238, 0.176, 0.202, 2.5),  # back of skull
    (-0.450, 0.958, 0.226, 0.156, 0.222, 2.4),  # nape
    (-0.360, 0.905, 0.286, 0.186, 0.286, 2.6),  # ruff, beginning
    (-0.250, 0.850, 0.350, 0.232, 0.318, 2.8),  # ruff, full -- the breed
    (-0.130, 0.798, 0.368, 0.238, 0.340, 2.8),  # withers
    (0.000, 0.760, 0.372, 0.220, 0.356, 2.8),   # chest, deepest
    (0.140, 0.762, 0.360, 0.212, 0.334, 2.8),   # ribs, well sprung
    (0.270, 0.784, 0.318, 0.198, 0.276, 2.6),   # loin, tucked up
    (0.390, 0.780, 0.366, 0.216, 0.292, 2.7),   # hip, broad
    (0.500, 0.774, 0.330, 0.202, 0.266, 2.6),   # rump
    (0.590, 0.796, 0.212, 0.152, 0.174, 2.3),   # tail set
    (0.650, 0.806, 0.090, 0.070, 0.076, 2.2),   # closes the loft smoothly
]

# Front leg. It stops at the pastern: the open end of the tube is then buried
# inside the paw, which is both how a leg actually meets a foot and how you
# avoid a visibly hollow tube where the foot should be.
# Thick at the top -- a Samoyed carries heavy feathering on the upper leg.
FRONT_PATH = [(0.0, 0.700, -0.268), (0.0, 0.520, -0.288), (0.0, 0.360, -0.300),
              (0.0, 0.230, -0.310), (0.0, 0.120, -0.316)]
FRONT_R = [0.180, 0.155, 0.124, 0.098, 0.088]
FRONT_FLAT = [1.0, 1.0, 1.0, 1.0, 1.0]

# Hind leg: hip, stifle (forward), hock (back), pastern. That zigzag is the
# whole character of a dog's back leg, and the thigh carries the most coat.
HIND_PATH = [(0.0, 0.720, 0.330), (0.0, 0.540, 0.410), (0.0, 0.370, 0.362),
             (0.0, 0.225, 0.302), (0.0, 0.120, 0.316)]
HIND_R = [0.215, 0.185, 0.130, 0.094, 0.086]
HIND_FLAT = [1.0, 1.0, 1.0, 1.0, 1.0]

# The plume: thickest in the middle, carried low over the back rather than
# arching away from it.
TAIL_PATH = [(0.0, 0.800, 0.470), (0.0, 0.985, 0.520), (0.0, 1.090, 0.420),
             (0.0, 1.130, 0.280), (0.0, 1.120, 0.140), (0.0, 1.075, 0.020)]
TAIL_R = [0.135, 0.168, 0.176, 0.164, 0.136, 0.088]


def build_core():
    rings = [section(z, y, w, up, down, exponent=e, n=24)
             for (z, y, w, up, down, e) in CORE]
    body = loft(rings, name="Samoyed")
    return body


def build_leg(name, path, radii, flat, x):
    offset = [(x, p[1], p[2]) for p in path]
    return tube(offset, radii, n=14, name=name, flatten=flat)


def build_paw(x, z):
    """A foot: a flattened pad with three toes, not the end of a pipe."""
    y = 0.058
    parts = [shape("sphere", (0.185, 0.112, 0.250), (x, y, z - 0.020), name="pad")]
    for tx in (-0.058, 0.0, 0.058):
        parts.append(shape("sphere", (0.070, 0.062, 0.098),
                           (x + tx, y - 0.008, z - 0.105), name="toe"))
    return parts


def build_ear(x_sign):
    """A small triangular ear, set wide and tipped forward."""
    base = (0.155 * x_sign, 1.085, -0.605)
    mid = (0.196 * x_sign, 1.215, -0.585)
    tip = (0.232 * x_sign, 1.330, -0.560)
    return tube([base, mid, tip], [0.088, 0.058, 0.012], n=10,
                name=f"ear{x_sign}", flatten=[0.32, 0.30, 0.28])


def build():
    reset_scene()
    fur = material("Fur", CREAM)
    dark = material("Dark", DARK, rough=0.35)
    tongue_mat = material("Tongue", TONGUE, rough=0.55)
    ear_mat = material("InnerEar", INNER_EAR, rough=0.7)

    core = build_core()
    parts = [
        build_leg("front.L", FRONT_PATH, FRONT_R, FRONT_FLAT, -0.165),
        build_leg("front.R", FRONT_PATH, FRONT_R, FRONT_FLAT, 0.165),
        build_leg("hind.L", HIND_PATH, HIND_R, HIND_FLAT, -0.180),
        build_leg("hind.R", HIND_PATH, HIND_R, HIND_FLAT, 0.180),
        tube(TAIL_PATH, TAIL_R, n=14, name="tail"),
        build_ear(-1),
        build_ear(1),
    ]
    for x, z in ((-0.165, -0.316), (0.165, -0.316), (-0.180, 0.316), (0.180, 0.316)):
        parts += build_paw(x, z)

    body = join_into(core, parts)
    body.name = "Samoyed"
    for slot in body.data.materials:
        pass
    body.data.materials.clear()
    body.data.materials.append(fur)

    # Smooth the blocked-out cage into a surface, keeping the edge loops the
    # sections created.
    subdivide(body, levels=2)
    smooth_shade(body)

    # Details keep their own materials.
    details = [
        shape("sphere", (0.086, 0.072, 0.062), (0, 0.890, -0.938), mat=dark,
              name="nose"),
        shape("sphere", (0.150, 0.045, 0.105), (0, 0.850, -0.836), mat=tongue_mat,
              name="smile"),
    ]
    for s in (-1, 1):
        details += [
            shape("sphere", (0.052, 0.058, 0.046), (0.120 * s, 0.988, -0.742),
                  mat=dark, name="eye"),
            shape("cone", (0.052, 0.115, 0.028), (0.185 * s, 1.205, -0.588),
                  mat=ear_mat, name="ear_inner", aim=(0.30 * s, 1.0, 0.18)),
        ]
    body = join_into(body, details)
    body.name = "Samoyed"
    decimate(body, TRIANGLE_BUDGET)
    smooth_shade(body)
    return body


def export(mesh):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
        export_apply=False,  # would bake away the armature
        export_skins=True, export_animations=True,
        export_animation_mode='ACTIONS', export_materials='EXPORT',
        export_normals=True, export_cameras=False, export_lights=False,
    )
    mesh.data.calc_loop_triangles()
    return len(mesh.data.loop_triangles)


if __name__ == "__main__":
    mesh = build()
    rig = build_armature()
    bones = weight_to_bones(mesh, rig)
    actions = build_actions(rig)
    tris = export(mesh)
    print(f"SAM: {tris:,} triangles, {bones} deform bones, "
          f"{len(actions)} clips, sculpted by cross-section")
    print(f"SAM: wrote {OUT}")
