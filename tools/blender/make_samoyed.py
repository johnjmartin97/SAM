"""Build the low-poly Samoyed and export it to public/models/samoyed.glb.

Run headless:  npm run model
(equivalently: blender --background --python tools/blender/make_samoyed.py)

The model is deliberately built as a small hierarchy of named parts -- head,
tail and four legs -- each with its origin at the joint it rotates around.
The game finds those parts by name and rotates them, so the same procedural
trot cycle that drove the placeholder drives this model too. No rig needed yet.

Coordinates below are written in the GAME's axes (X right, Y up, Z back, so the
nose points at -Z) and converted to Blender's on the way in. That keeps these
numbers directly comparable with src/samoyed.js.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                   "public", "models", "samoyed.glb")

CREAM = (0.960, 0.941, 0.902, 1.0)
SHADOW = (0.878, 0.851, 0.804, 1.0)
DARK = (0.110, 0.110, 0.125, 1.0)
TONGUE = (0.850, 0.420, 0.450, 1.0)


def game_to_blender(v):
    """(x, y_up, z_back) -> Blender (x, y_forward, z_up)."""
    x, y, z = v
    return Vector((x, z, y))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgba):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = 0.85
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    return mat


def shape(kind, size, center, pivot=None, mat=None, name="part",
          scale=(1, 1, 1), rot=(0, 0, 0)):
    """Create one low-poly part.

    center: where the part sits, in game axes.
    pivot:  where its origin (rotation point) goes; defaults to the center.
    """
    if kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1.0)
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.5)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.5, radius2=0.12, depth=1.0)
    else:
        raise ValueError(kind)

    obj = bpy.context.active_object
    obj.name = name

    # Bake the part's own size and rotation into the mesh.
    sx, sy, sz = game_to_blender(size)
    obj.data.transform(Matrix.Diagonal(Vector((sx, sy, sz, 1.0))))
    if any(rot):
        rx, ry, rz = rot
        m = (Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y')
             @ Matrix.Rotation(rx, 4, 'X'))
        obj.data.transform(m)
    if scale != (1, 1, 1):
        ssx, ssy, ssz = game_to_blender(scale)
        obj.data.transform(Matrix.Diagonal(Vector((ssx, ssy, ssz, 1.0))))

    # Put the origin at the pivot, and the mesh at the center.
    c = game_to_blender(center)
    p = game_to_blender(pivot) if pivot is not None else c
    obj.data.transform(Matrix.Translation(c - p))
    obj.location = p

    for poly in obj.data.polygons:
        poly.use_smooth = False  # flat shading, keeps the low-poly read

    if mat:
        obj.data.materials.append(mat)
    return obj


def join_into(parent_obj, objs):
    """Merge helper meshes into one object so the export stays tidy."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    parent_obj.select_set(True)
    bpy.context.view_layer.objects.active = parent_obj
    bpy.ops.object.join()
    return parent_obj


def build():
    reset_scene()

    fur = material("Fur", CREAM)
    fur_shade = material("FurShade", SHADOW)
    dark = material("Dark", DARK)
    tongue_mat = material("Tongue", TONGUE)

    root = bpy.data.objects.new("Samoyed", None)  # empty at the feet
    bpy.context.collection.objects.link(root)

    # ---- torso -------------------------------------------------------------
    body = shape("cube", (0.58, 0.52, 0.95), (0, 0.62, 0), mat=fur, name="body")
    chest = shape("cube", (0.60, 0.48, 0.36), (0, 0.66, -0.40), mat=fur, name="chest")
    rump = shape("sphere", (0.60, 0.54, 0.52), (0, 0.62, 0.36), mat=fur, name="rump")
    ruff = shape("sphere", (0.72, 0.66, 0.40), (0, 0.74, -0.52), mat=fur, name="ruff")
    body = join_into(body, [chest, rump, ruff])
    body.name = "body"

    # ---- head (origin at the neck so it can tilt) --------------------------
    neck = (0, 0.92, -0.62)
    skull = shape("sphere", (0.44, 0.42, 0.44), (0, 0.94, -0.62), pivot=neck,
                  mat=fur, name="head")
    snout = shape("cone", (0.26, 0.22, 0.30), (0, 0.88, -0.86), pivot=neck,
                  mat=fur, name="snout", rot=(math.radians(-90), 0, 0))
    nose = shape("sphere", (0.13, 0.11, 0.10), (0, 0.90, -1.00), pivot=neck,
                 mat=dark, name="nose")
    mouth = shape("cube", (0.16, 0.05, 0.14), (0, 0.80, -0.90), pivot=neck,
                  mat=tongue_mat, name="mouth")
    head_parts = [snout, nose, mouth]
    for s in (-1, 1):
        head_parts.append(
            shape("sphere", (0.075, 0.09, 0.06), (0.115 * s, 0.99, -0.80),
                  pivot=neck, mat=dark, name="eye")
        )
        head_parts.append(
            shape("cone", (0.16, 0.20, 0.09), (0.15 * s, 1.16, -0.58),
                  pivot=neck, mat=fur_shade, name="ear",
                  rot=(math.radians(-90), 0, 0))
        )
    head = join_into(skull, head_parts)
    head.name = "head"

    # ---- tail (origin at the base, curls up over the back) -----------------
    base = (0, 0.82, 0.44)
    t1 = shape("cube", (0.15, 0.32, 0.15), (0, 0.96, 0.46), pivot=base,
               mat=fur, name="tail")
    t2 = shape("cube", (0.14, 0.14, 0.32), (0, 1.14, 0.34), pivot=base,
               mat=fur, name="tail_tip")
    t3 = shape("sphere", (0.17, 0.17, 0.17), (0, 1.12, 0.18), pivot=base,
               mat=fur_shade, name="tail_end")
    tail = join_into(t1, [t2, t3])
    tail.name = "tail"

    # ---- legs (origin at hip/shoulder) -------------------------------------
    legs = []
    for name, x, z in (("leg_front_L", -0.19, -0.30), ("leg_front_R", 0.19, -0.30),
                       ("leg_back_L", -0.19, 0.32), ("leg_back_R", 0.19, 0.32)):
        hip = (x, 0.42, z)
        upper = shape("cube", (0.18, 0.44, 0.18), (x, 0.21, z), pivot=hip,
                      mat=fur, name=name)
        paw = shape("cube", (0.21, 0.13, 0.26), (x, -0.03, z - 0.02), pivot=hip,
                    mat=fur_shade, name=name + "_paw")
        legs.append(join_into(upper, [paw]))
        legs[-1].name = name

    for obj in [body, head, tail] + legs:
        obj.parent = root
        obj.matrix_parent_inverse = Matrix.Identity(4)

    return root


def export(root):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=os.path.normpath(OUT),
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
    )


if __name__ == "__main__":
    root = build()
    export(root)
    print("SAM: wrote", os.path.normpath(OUT))
