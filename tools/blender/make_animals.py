"""Build the wildlife and export it to public/models/.

    npm run animals
    (blender --background --python tools/blender/make_animals.py)

Four species, built the same way as the dog: rough blobs fused into one skin by
a voxel remesh, with the parts that need to move kept as separate named objects
so the game can animate them without a bone rig.

Every animal keeps the same naming contract as the Samoyed -- the parts the
game rotates are called `head`, `tail` and `leg_*` -- so one animation helper
drives all of them.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

from critterlib import (  # noqa: E402
    export_glb, join_into, material, reset_scene, shape, skin, smooth,
)

OUT_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                 "public", "models")
)


def _root(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    return root


def _parent(root, parts):
    for obj in parts:
        obj.parent = root
        obj.matrix_parent_inverse = Matrix.Identity(4)


# ------------------------------------------------------------------ rabbit --

def build_rabbit():
    reset_scene()
    fur = material("Fur", (0.494, 0.435, 0.376, 1.0))
    pale = material("FurPale", (0.729, 0.690, 0.639, 1.0))
    dark = material("Dark", (0.086, 0.075, 0.071, 1.0), rough=0.35)

    root = _root("Rabbit")

    body = skin("body", [
        shape("sphere", (0.20, 0.22, 0.30), (0, 0.17, 0.02), name="torso"),
        shape("sphere", (0.19, 0.19, 0.19), (0, 0.20, 0.10), name="haunch"),
        shape("sphere", (0.15, 0.15, 0.15), (0, 0.19, -0.10), name="chest"),
    ], fur, 1400)
    smooth(body)

    neck = (0, 0.24, -0.13)
    head = skin("head", [
        shape("sphere", (0.145, 0.145, 0.165), (0, 0.26, -0.18), pivot=neck, name="skull"),
        shape("cone", (0.09, 0.09, 0.10), (0, 0.235, -0.26), pivot=neck,
              name="muzzle", aim=(0, -0.1, -1)),
        # The ears are the whole silhouette. Without them it is a potato.
        shape("cone", (0.055, 0.20, 0.035), (-0.055, 0.40, -0.15), pivot=neck,
              name="ear_l", aim=(-0.22, 1.0, -0.12)),
        shape("cone", (0.055, 0.20, 0.035), (0.055, 0.40, -0.15), pivot=neck,
              name="ear_r", aim=(0.22, 1.0, -0.12)),
    ], fur, 1400)
    details = [
        shape("sphere", (0.030, 0.030, 0.026), (-0.058, 0.275, -0.225),
              pivot=neck, mat=dark, name="eye_l"),
        shape("sphere", (0.030, 0.030, 0.026), (0.058, 0.275, -0.225),
              pivot=neck, mat=dark, name="eye_r"),
        shape("sphere", (0.026, 0.022, 0.022), (0, 0.232, -0.305),
              pivot=neck, mat=dark, name="nose"),
    ]
    head = join_into(head, details)
    head.name = "head"
    smooth(head)

    tail = shape("sphere", (0.075, 0.075, 0.075), (0, 0.23, 0.19),
                 pivot=(0, 0.22, 0.17), mat=pale, name="tail")
    smooth(tail)

    legs = []
    for name, x, z, back in (("leg_front_L", -0.075, -0.09, False),
                             ("leg_front_R", 0.075, -0.09, False),
                             ("leg_back_L", -0.085, 0.11, True),
                             ("leg_back_R", 0.085, 0.11, True)):
        hip = (x, 0.14, z)
        blobs = [
            shape("capsule", (0.055, 0.13 if back else 0.11, 0.055),
                  (x, 0.075, z), pivot=hip, name="upper", aim=(0, -1, 0)),
            shape("sphere", (0.06, 0.045, 0.10), (x, 0.022, z - 0.02),
                  pivot=hip, name="foot"),
        ]
        if back:
            blobs.append(shape("sphere", (0.10, 0.12, 0.13), (x, 0.14, z + 0.01),
                               pivot=hip, name="thigh"))
        leg = skin(name, blobs, fur, 700)
        smooth(leg)
        legs.append(leg)

    parts = [body, head, tail] + legs
    _parent(root, parts)
    return parts


# ---------------------------------------------------------------- squirrel --

def build_squirrel():
    reset_scene()
    fur = material("Fur", (0.478, 0.294, 0.176, 1.0))
    pale = material("FurPale", (0.812, 0.749, 0.667, 1.0))
    dark = material("Dark", (0.071, 0.059, 0.055, 1.0), rough=0.35)

    root = _root("Squirrel")

    body = skin("body", [
        shape("sphere", (0.13, 0.16, 0.22), (0, 0.14, 0.01), name="torso"),
        shape("sphere", (0.115, 0.13, 0.13), (0, 0.16, -0.07), name="chest"),
    ], fur, 1100)
    smooth(body)

    neck = (0, 0.20, -0.10)
    head = skin("head", [
        shape("sphere", (0.105, 0.105, 0.115), (0, 0.22, -0.14), pivot=neck, name="skull"),
        shape("cone", (0.065, 0.065, 0.08), (0, 0.205, -0.20), pivot=neck,
              name="muzzle", aim=(0, -0.1, -1)),
        shape("sphere", (0.045, 0.055, 0.02), (-0.055, 0.29, -0.12),
              pivot=neck, name="ear_l"),
        shape("sphere", (0.045, 0.055, 0.02), (0.055, 0.29, -0.12),
              pivot=neck, name="ear_r"),
    ], fur, 1100)
    head = join_into(head, [
        shape("sphere", (0.026, 0.026, 0.022), (-0.045, 0.232, -0.175),
              pivot=neck, mat=dark, name="eye_l"),
        shape("sphere", (0.026, 0.026, 0.022), (0.045, 0.232, -0.175),
              pivot=neck, mat=dark, name="eye_r"),
    ])
    head.name = "head"
    smooth(head)

    # The tail is the animal. It gets its own pivot and a big sweep.
    base = (0, 0.17, 0.11)
    tail_blobs = []
    for i in range(6):
        t = i / 5.0
        tail_blobs.append(shape(
            "sphere",
            (0.075 + t * 0.05, 0.10 + t * 0.09, 0.10),
            (0, 0.18 + t * 0.26, 0.13 + t * 0.10 - t * t * 0.14),
            pivot=base, name="tail_seg"
        ))
    tail = skin("tail", tail_blobs, pale, 1400)
    smooth(tail)

    legs = []
    for name, x, z in (("leg_front_L", -0.055, -0.06), ("leg_front_R", 0.055, -0.06),
                       ("leg_back_L", -0.065, 0.08), ("leg_back_R", 0.065, 0.08)):
        hip = (x, 0.11, z)
        leg = skin(name, [
            shape("capsule", (0.04, 0.09, 0.04), (x, 0.06, z), pivot=hip,
                  name="upper", aim=(0, -1, 0)),
            shape("sphere", (0.045, 0.03, 0.07), (x, 0.018, z - 0.015),
                  pivot=hip, name="foot"),
        ], fur, 500)
        smooth(leg)
        legs.append(leg)

    parts = [body, head, tail] + legs
    _parent(root, parts)
    return parts


# -------------------------------------------------------------------- bear --

def build_bear():
    reset_scene()
    fur = material("Fur", (0.129, 0.106, 0.098, 1.0), rough=0.9)
    muzzle_mat = material("FurPale", (0.286, 0.239, 0.196, 1.0), rough=0.9)
    dark = material("Dark", (0.043, 0.039, 0.039, 1.0), rough=0.3)

    root = _root("Bear")

    body = skin("body", [
        shape("sphere", (0.90, 0.86, 1.55), (0, 0.95, 0.05), name="torso"),
        # The shoulder hump is the single most recognisable thing about a bear.
        shape("sphere", (0.86, 0.76, 0.70), (0, 1.14, -0.45), name="hump"),
        shape("sphere", (0.82, 0.78, 0.72), (0, 0.90, 0.62), name="rump"),
        shape("sphere", (0.70, 0.55, 1.10), (0, 0.68, 0.05), name="belly"),
    ], fur, 4500, voxel=0.035)
    smooth(body)

    neck = (0, 1.12, -0.80)
    head = skin("head", [
        shape("sphere", (0.56, 0.52, 0.58), (0, 1.05, -1.00), pivot=neck, name="skull"),
        shape("cone", (0.36, 0.34, 0.40), (0, 0.96, -1.28), pivot=neck,
              name="muzzle", aim=(0, -0.15, -1)),
        shape("sphere", (0.20, 0.20, 0.10), (-0.26, 1.34, -0.90), pivot=neck, name="ear_l"),
        shape("sphere", (0.20, 0.20, 0.10), (0.26, 1.34, -0.90), pivot=neck, name="ear_r"),
    ], fur, 3000, voxel=0.03)
    head = join_into(head, [
        shape("sphere", (0.115, 0.10, 0.09), (0, 0.965, -1.47), pivot=neck,
              mat=dark, name="nose"),
        shape("sphere", (0.07, 0.075, 0.06), (-0.16, 1.12, -1.24), pivot=neck,
              mat=dark, name="eye_l"),
        shape("sphere", (0.07, 0.075, 0.06), (0.16, 1.12, -1.24), pivot=neck,
              mat=dark, name="eye_r"),
        shape("sphere", (0.30, 0.22, 0.24), (0, 0.94, -1.30), pivot=neck,
              mat=muzzle_mat, name="snout_pale"),
    ])
    head.name = "head"
    smooth(head)

    tail = shape("sphere", (0.16, 0.16, 0.14), (0, 1.02, 0.95),
                 pivot=(0, 1.00, 0.90), mat=fur, name="tail")
    smooth(tail)

    legs = []
    for name, x, z, back in (("leg_front_L", -0.44, -0.52, False),
                             ("leg_front_R", 0.44, -0.52, False),
                             ("leg_back_L", -0.44, 0.62, True),
                             ("leg_back_R", 0.44, 0.62, True)):
        hip = (x, 0.72, z)
        leg = skin(name, [
            shape("sphere", (0.44, 0.46, 0.46), (x, 0.62, z), pivot=hip, name="thigh"),
            shape("capsule", (0.32, 0.42, 0.32), (x, 0.34, z), pivot=hip,
                  name="upper", aim=(0, -1, 0)),
            shape("sphere", (0.34, 0.20, 0.44), (x, 0.09, z - 0.06),
                  pivot=hip, name="paw"),
        ], fur, 1800, voxel=0.03)
        smooth(leg)
        legs.append(leg)

    parts = [body, head, tail] + legs
    _parent(root, parts)
    return parts


# -------------------------------------------------------------------- fish --

def build_fish():
    reset_scene()
    body_mat = material("Fur", (0.290, 0.353, 0.353, 1.0), rough=0.35)
    belly_mat = material("FurPale", (0.678, 0.702, 0.663, 1.0), rough=0.35)

    root = _root("Fish")

    # One name the game already knows how to drive: `tail`.
    body = skin("body", [
        shape("sphere", (0.075, 0.115, 0.34), (0, 0, -0.02), name="torso"),
        shape("cone", (0.06, 0.09, 0.16), (0, 0, -0.24), name="snout",
              aim=(0, 0, -1)),
        shape("sphere", (0.055, 0.075, 0.10), (0, 0, 0.16), name="peduncle"),
    ], body_mat, 900, voxel=0.012)
    body = join_into(body, [
        shape("sphere", (0.055, 0.05, 0.24), (0, -0.05, -0.02),
              mat=belly_mat, name="belly"),
        shape("cone", (0.012, 0.10, 0.11), (0, 0.10, -0.02),
              mat=body_mat, name="dorsal", aim=(0, 1, -0.25)),
    ])
    body.name = "body"
    smooth(body)

    base = (0, 0, 0.20)
    tail = shape("cone", (0.014, 0.17, 0.17), (0, 0, 0.30), pivot=base,
                 mat=body_mat, name="tail", aim=(0, 0, 1))
    smooth(tail)

    parts = [body, tail]
    _parent(root, parts)
    return parts


BUILDERS = {
    "rabbit": build_rabbit,
    "squirrel": build_squirrel,
    "bear": build_bear,
    "fish": build_fish,
}


if __name__ == "__main__":
    for name, builder in BUILDERS.items():
        parts = builder()
        path = os.path.join(OUT_DIR, f"{name}.glb")
        tris = export_glb(path, parts)
        print(f"SAM: {name:<9} {tris:>6,} triangles -> {path}")
