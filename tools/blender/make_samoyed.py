"""Build the Samoyed and export it to public/models/samoyed.glb.

Run headless:  npm run model
(equivalently: blender --background --python tools/blender/make_samoyed.py)

The model is a small hierarchy of named parts -- head, tail and four legs --
each with its origin at the joint it rotates around. The game finds those parts
by name and rotates them, so one procedural trot cycle drives the whole dog
without a bone rig.

AXES. Every coordinate below is written in the GAME's axes: X right, Y up, and
the nose pointing at -Z. pt() converts those to Blender's axes in a way that
survives the glTF export, which flips Blender's Y into glTF's Z:

    game (x, y, z) -> blender (x, -z, y) -> glTF (x, y, z)

so what you write here is exactly what the game gets. Sizes go through dim()
instead, which never negates -- a negative scale would turn the mesh inside out.
"""

import math
import os
import random

import bpy
from mathutils import Matrix, Vector

OUT = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                 "public", "models", "samoyed.glb")
)

# Samoyeds are white, but pure white reads as flat and blown-out under a warm
# sun. These are barely-tinted creams that still say "white dog".
CREAM = (0.965, 0.953, 0.933, 1.0)
SHADOW = (0.886, 0.867, 0.839, 1.0)
DARK = (0.086, 0.086, 0.102, 1.0)
TONGUE = (0.862, 0.435, 0.463, 1.0)
INNER_EAR = (0.902, 0.706, 0.686, 1.0)

# Bumping these is the single knob for how dense the mesh is.
SEG, RING = 32, 16


def pt(v):
    """Game-space point -> Blender-space point."""
    x, y, z = v
    return Vector((x, -z, y))


def dim(v):
    """Game-space size -> Blender-space size. Never negative."""
    x, y, z = v
    return Vector((abs(x), abs(z), abs(y)))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    random.seed(7)  # fluff is scattered, but the same way every run


def material(name, rgba, rough=0.72):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.2
    return mat


def shape(kind, size, center, pivot=None, mat=None, name="part",
          aim=None, spin=0.0):
    """One rounded part.

    size:   extents in game axes.
    center: where it sits, in game axes.
    pivot:  where its origin (the point it rotates about) goes.
    aim:    game-space direction the part's long axis should point.
    """
    if kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=SEG, ring_count=RING, radius=0.5)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=SEG, radius1=0.5, radius2=0.02, depth=1.0)
    elif kind == "capsule":
        bpy.ops.mesh.primitive_cylinder_add(vertices=SEG, radius=0.5, depth=1.0)
    else:
        raise ValueError(kind)

    obj = bpy.context.active_object
    obj.name = name

    if kind == "capsule":
        # Round the cylinder's ends so limbs read as soft, not machined.
        for end in (0.5, -0.5):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=SEG, ring_count=RING, radius=0.5)
            cap = bpy.context.active_object
            cap.location = (0, 0, end)
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            cap.select_set(True)
            bpy.ops.object.join()
            bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = obj

    if spin:
        obj.data.transform(Matrix.Rotation(spin, 4, 'Z'))

    # Scale first, in the part's own frame, then aim it.
    s = dim(size)
    obj.data.transform(Matrix.Diagonal(Vector((s.x, s.y, s.z, 1.0))))

    if aim is not None:
        target = pt(aim) - pt((0, 0, 0))
        if target.length > 1e-6:
            q = Vector((0.0, 0.0, 1.0)).rotation_difference(target.normalized())
            obj.data.transform(q.to_matrix().to_4x4())

    c = pt(center)
    p = pt(pivot) if pivot is not None else c
    obj.data.transform(Matrix.Translation(c - p))
    obj.location = p

    if mat:
        obj.data.materials.append(mat)
    return obj


def join_into(main, others):
    bpy.ops.object.select_all(action='DESELECT')
    for o in others:
        o.select_set(True)
    main.select_set(True)
    bpy.context.view_layer.objects.active = main
    bpy.ops.object.join()
    bpy.ops.object.select_all(action='DESELECT')
    return main


def smooth(obj, angle=52.0):
    """Smooth shading, but keep genuinely sharp edges sharp."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
    except Exception:
        bpy.ops.object.shade_smooth()
    bpy.ops.object.select_all(action='DESELECT')


def tufts(around, radius, count, size, mat, pivot, name, spread=0.22):
    """A ring of small blobs -- the trick that turns a smooth shape fluffy."""
    out = []
    cx, cy, cz = around
    for i in range(count):
        a = (i / count) * math.tau + random.uniform(-0.15, 0.15)
        r = radius * random.uniform(0.9, 1.12)
        p = (cx + math.cos(a) * r,
             cy + math.sin(a) * r * 0.85 + random.uniform(-spread, spread) * 0.3,
             cz + random.uniform(-spread, spread))
        k = size * random.uniform(0.75, 1.25)
        out.append(shape("sphere", (k, k * 0.9, k), p, pivot=pivot, mat=mat, name=name))
    return out


def build():
    reset_scene()

    fur = material("Fur", CREAM)
    fur_shade = material("FurShade", SHADOW)
    dark = material("Dark", DARK, rough=0.35)
    tongue_mat = material("Tongue", TONGUE, rough=0.55)
    ear_mat = material("InnerEar", INNER_EAR, rough=0.7)

    root = bpy.data.objects.new("Samoyed", None)  # empty, sits between the feet
    bpy.context.collection.objects.link(root)

    # ---- torso -------------------------------------------------------------
    body = shape("sphere", (0.62, 0.60, 1.05), (0, 0.64, 0.02), mat=fur, name="body")
    parts = [
        shape("sphere", (0.66, 0.62, 0.62), (0, 0.66, -0.34), mat=fur, name="chest"),
        shape("sphere", (0.64, 0.62, 0.60), (0, 0.63, 0.38), mat=fur, name="rump"),
        # The ruff: the thick collar of fur that makes the breed recognisable.
        shape("sphere", (0.80, 0.76, 0.50), (0, 0.74, -0.50), mat=fur, name="ruff"),
        shape("sphere", (0.70, 0.66, 0.34), (0, 0.76, -0.62), mat=fur_shade, name="ruff2"),
        # Belly, a touch shaded so the silhouette reads from the side.
        shape("sphere", (0.52, 0.34, 0.86), (0, 0.46, 0.04), mat=fur_shade, name="belly"),
    ]
    parts += tufts((0, 0.76, -0.56), 0.40, 16, 0.20, fur, None, "ruff_tuft", spread=0.26)
    parts += tufts((0, 0.66, 0.42), 0.30, 10, 0.17, fur, None, "rump_tuft", spread=0.20)
    body = join_into(body, parts)
    body.name = "body"
    smooth(body)

    # ---- head (origin at the neck so it tilts as one piece) ----------------
    neck = (0, 0.94, -0.60)
    head = shape("sphere", (0.46, 0.46, 0.46), (0, 0.98, -0.66), pivot=neck,
                 mat=fur, name="head")
    hp = [
        shape("sphere", (0.34, 0.30, 0.34), (0, 0.90, -0.84), pivot=neck,
              mat=fur, name="muzzle_base"),
        shape("cone", (0.30, 0.30, 0.34), (0, 0.90, -0.90), pivot=neck,
              mat=fur, name="muzzle", aim=(0, -0.15, -1)),
        shape("sphere", (0.145, 0.125, 0.12), (0, 0.905, -1.03), pivot=neck,
              mat=dark, name="nose"),
        # The upturned mouth line -- the "Samoyed smile".
        shape("sphere", (0.20, 0.07, 0.16), (0, 0.825, -0.94), pivot=neck,
              mat=tongue_mat, name="smile"),
        shape("sphere", (0.42, 0.36, 0.34), (0, 1.10, -0.62), pivot=neck,
              mat=fur, name="forehead"),
    ]
    hp += tufts((0, 1.00, -0.48), 0.30, 12, 0.15, fur, neck, "cheek_tuft", spread=0.22)
    for s in (-1, 1):
        hp += [
            shape("sphere", (0.085, 0.10, 0.075), (0.135 * s, 1.02, -0.84),
                  pivot=neck, mat=dark, name="eye"),
            # Triangular pricked ears, slightly splayed.
            shape("cone", (0.20, 0.26, 0.13), (0.165 * s, 1.28, -0.60),
                  pivot=neck, mat=fur, name="ear",
                  aim=(0.38 * s, 1.0, -0.12)),
            shape("cone", (0.11, 0.16, 0.07), (0.163 * s, 1.26, -0.655),
                  pivot=neck, mat=ear_mat, name="ear_inner",
                  aim=(0.38 * s, 1.0, -0.12)),
            shape("sphere", (0.10, 0.09, 0.09), (0.10 * s, 0.94, -0.92),
                  pivot=neck, mat=fur, name="cheek"),
        ]
    head = join_into(head, hp)
    head.name = "head"
    smooth(head)

    # ---- tail: a fluffy plume curling up over the back ---------------------
    base = (0, 0.84, 0.46)
    tail = shape("sphere", (0.20, 0.20, 0.20), (0, 0.90, 0.48), pivot=base,
                 mat=fur, name="tail")
    tp = []
    for i in range(1, 9):
        t = i / 8.0
        a = math.radians(20 + t * 150)  # sweep up, then forward over the spine
        r = 0.34
        p = (0.0,
             0.92 + math.sin(a) * r * 0.85,
             0.48 + (math.cos(a) - math.cos(math.radians(20))) * r)
        k = 0.24 - t * 0.06
        tp.append(shape("sphere", (k, k, k), p, pivot=base,
                        mat=fur if i % 2 else fur_shade, name="tail_seg"))
        tp += tufts(p, k * 0.62, 5, k * 0.52, fur, base, "tail_tuft", spread=0.14)
    tail = join_into(tail, tp)
    tail.name = "tail"
    smooth(tail)

    # ---- legs (origin at the hip/shoulder) ---------------------------------
    legs = []
    for name, x, z, front in (("leg_front_L", -0.20, -0.30, True),
                              ("leg_front_R", 0.20, -0.30, True),
                              ("leg_back_L", -0.20, 0.34, False),
                              ("leg_back_R", 0.20, 0.34, False)):
        hip = (x, 0.44, z)
        upper = shape("capsule", (0.21, 0.30, 0.21), (x, 0.30, z), pivot=hip,
                      mat=fur, name=name, aim=(0, -1, 0))
        lp = [
            shape("capsule", (0.165, 0.24, 0.165), (x, 0.10, z), pivot=hip,
                  mat=fur, name="shin", aim=(0, -1, 0)),
            # Paw, flattened and pushed slightly forward.
            shape("sphere", (0.22, 0.15, 0.27), (x, 0.005, z - 0.03), pivot=hip,
                  mat=fur_shade, name="paw"),
        ]
        # Thicker feathering at the top of each leg, heavier on the haunches.
        lp += tufts((x, 0.40, z), 0.16, 7, 0.15 if front else 0.19,
                    fur, hip, "leg_tuft", spread=0.16)
        leg = join_into(upper, lp)
        leg.name = name
        smooth(leg)
        legs.append(leg)

    for obj in [body, head, tail] + legs:
        obj.parent = root
        obj.matrix_parent_inverse = Matrix.Identity(4)

    return root, [body, head, tail] + legs


def export(root, parts):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials='EXPORT',
        export_normals=True,
        export_cameras=False,
        export_lights=False,
    )
    tris = sum(len(p.data.loop_triangles) if p.data.loop_triangles
               else len(p.data.polygons) * 2 for p in parts)
    return tris


if __name__ == "__main__":
    root, parts = build()
    for p in parts:
        p.data.calc_loop_triangles()
    tris = export(root, parts)
    print(f"SAM: wrote {OUT}  ({tris:,} triangles)")
