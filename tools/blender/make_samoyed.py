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

# The blobs are only rough input -- the voxel remesh resamples them into one
# continuous skin -- so they do not need to be dense.
SEG, RING = 16, 8

# Voxel size for that remesh, then a triangle budget per part. The budget
# matters because the fur shader redraws each part once per shell layer.
VOXEL = 0.022
BUDGET = {"body": 7000, "head": 5000, "tail": 4000, "leg": 2500}


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


def _apply(obj, mod):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action='DESELECT')


def skin(name, blobs, mat, budget):
    """Fuse overlapping blobs into ONE continuous surface.

    This is the difference between a dog and a pile of snowballs. A voxel
    remesh throws away the input topology and re-skins the union of the
    shapes, so the seams where blobs overlap simply stop existing. The result
    is dense, so it is then decimated down to a triangle budget.
    """
    main = join_into(blobs[0], blobs[1:])
    main.name = name

    main.data.materials.clear()
    main.data.materials.append(mat)

    m = main.modifiers.new("Remesh", 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = VOXEL
    m.adaptivity = 0.0
    _apply(main, m)

    main.data.calc_loop_triangles()
    current = len(main.data.loop_triangles)
    if current > budget:
        d = main.modifiers.new("Decimate", 'DECIMATE')
        d.decimate_type = 'COLLAPSE'
        d.ratio = budget / current
        _apply(main, d)

    return main


def build():
    reset_scene()

    fur = material("Fur", CREAM)
    dark = material("Dark", DARK, rough=0.35)
    tongue_mat = material("Tongue", TONGUE, rough=0.55)
    ear_mat = material("InnerEar", INNER_EAR, rough=0.7)

    root = bpy.data.objects.new("Samoyed", None)  # empty, sits between the feet
    bpy.context.collection.objects.link(root)

    # Each part is built as rough overlapping blobs, then fused by skin() into
    # a single surface. The blobs define the silhouette; the fur shader in the
    # game supplies the hair itself, so nothing here tries to look hairy.

    # ---- torso -------------------------------------------------------------
    body = skin("body", [
        shape("sphere", (0.60, 0.58, 1.02), (0, 0.64, 0.02), name="torso"),
        shape("sphere", (0.64, 0.60, 0.60), (0, 0.66, -0.32), name="chest"),
        shape("sphere", (0.66, 0.64, 0.62), (0, 0.62, 0.36), name="rump"),
        # The ruff: the thick collar the breed is known for. It is a shape, not
        # a texture, so it has to be modelled a size larger than the neck.
        shape("sphere", (0.84, 0.80, 0.52), (0, 0.76, -0.48), name="ruff"),
        shape("sphere", (0.74, 0.70, 0.36), (0, 0.78, -0.62), name="ruff_front"),
        shape("sphere", (0.54, 0.40, 0.84), (0, 0.48, 0.04), name="belly"),
        # Shoulder and haunch mass, so the legs do not look pinned on.
        shape("sphere", (0.50, 0.46, 0.44), (0, 0.56, -0.26), name="shoulders"),
        shape("sphere", (0.56, 0.50, 0.48), (0, 0.54, 0.32), name="haunches"),
    ], fur, BUDGET["body"])
    smooth(body)

    # ---- head (origin at the neck so it tilts as one piece) ----------------
    neck = (0, 0.94, -0.60)
    head = skin("head", [
        shape("sphere", (0.46, 0.46, 0.46), (0, 0.99, -0.66), pivot=neck, name="skull"),
        shape("sphere", (0.44, 0.38, 0.36), (0, 1.10, -0.62), pivot=neck, name="forehead"),
        shape("sphere", (0.32, 0.29, 0.32), (0, 0.91, -0.83), pivot=neck, name="muzzle_base"),
        shape("cone", (0.28, 0.28, 0.32), (0, 0.905, -0.90), pivot=neck,
              name="muzzle", aim=(0, -0.12, -1)),
        # Cheek ruffs -- the wide, soft jawline.
        shape("sphere", (0.24, 0.24, 0.26), (-0.16, 0.96, -0.72), pivot=neck, name="cheek_l"),
        shape("sphere", (0.24, 0.24, 0.26), (0.16, 0.96, -0.72), pivot=neck, name="cheek_r"),
        # Pricked triangular ears, splayed slightly outward.
        shape("cone", (0.21, 0.27, 0.14), (-0.165, 1.27, -0.60), pivot=neck,
              name="ear_l", aim=(0.36 * -1, 1.0, -0.12)),
        shape("cone", (0.21, 0.27, 0.14), (0.165, 1.27, -0.60), pivot=neck,
              name="ear_r", aim=(0.36, 1.0, -0.12)),
    ], fur, BUDGET["head"])

    # Details go on AFTER the remesh, so they keep their own materials and do
    # not get fused (and furred) into the face.
    details = [
        shape("sphere", (0.145, 0.125, 0.12), (0, 0.905, -1.03), pivot=neck,
              mat=dark, name="nose"),
        # The upturned mouth line -- the "Samoyed smile".
        shape("sphere", (0.20, 0.07, 0.15), (0, 0.828, -0.945), pivot=neck,
              mat=tongue_mat, name="smile"),
    ]
    for s in (-1, 1):
        details += [
            shape("sphere", (0.085, 0.10, 0.075), (0.135 * s, 1.025, -0.845),
                  pivot=neck, mat=dark, name="eye"),
            shape("cone", (0.115, 0.17, 0.075), (0.163 * s, 1.255, -0.655),
                  pivot=neck, mat=ear_mat, name="ear_inner",
                  aim=(0.36 * s, 1.0, -0.12)),
        ]
    head = join_into(head, details)
    head.name = "head"
    smooth(head)

    # ---- tail: a plume curling up over the back ----------------------------
    base = (0, 0.84, 0.46)
    segs = []
    for i in range(9):
        t = i / 8.0
        a = math.radians(20 + t * 150)
        r = 0.34
        p = (0.0,
             0.92 + math.sin(a) * r * 0.85,
             0.48 + (math.cos(a) - math.cos(math.radians(20))) * r)
        k = 0.25 - t * 0.05
        segs.append(shape("sphere", (k, k, k), p, pivot=base, name="tail_seg"))
    tail = skin("tail", segs, fur, BUDGET["tail"])
    smooth(tail)

    # ---- legs (origin at the hip/shoulder) ---------------------------------
    legs = []
    for name, x, z, back in (("leg_front_L", -0.20, -0.30, False),
                             ("leg_front_R", 0.20, -0.30, False),
                             ("leg_back_L", -0.20, 0.34, True),
                             ("leg_back_R", 0.20, 0.34, True)):
        hip = (x, 0.44, z)
        blobs = [
            # Trousered upper leg: heavier on the hind legs, as on the breed.
            shape("sphere", (0.30 if back else 0.26, 0.34, 0.30 if back else 0.26),
                  (x, 0.36, z), pivot=hip, name="thigh"),
            shape("capsule", (0.19, 0.26, 0.19), (x, 0.22, z), pivot=hip,
                  name="upper", aim=(0, -1, 0)),
            shape("capsule", (0.155, 0.22, 0.155), (x, 0.09, z), pivot=hip,
                  name="shin", aim=(0, -1, 0)),
            shape("sphere", (0.21, 0.15, 0.26), (x, 0.01, z - 0.03), pivot=hip,
                  name="paw"),
        ]
        leg = skin(name, blobs, fur, BUDGET["leg"])
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
    for p in parts:
        print(f"    {p.name:<14}{len(p.data.loop_triangles):>7,} tris")
    print(f"SAM: wrote {OUT}  ({tris:,} triangles)")
