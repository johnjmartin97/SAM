"""Shared model-building helpers for every animal in SAM.

Extracted from make_samoyed.py so the dog and the wildlife cannot drift apart.
The axis convention in particular is load-bearing and must exist in exactly one
place: get it wrong and models come out mirrored, which is invisible until
something faces the wrong way.

AXES. Coordinates are written in the GAME's axes -- X right, Y up, nose at -Z --
and pt() converts them so they survive the glTF export, which flips Blender's Y
into glTF's Z:

    game (x, y, z) -> blender (x, -z, y) -> glTF (x, y, z)

So what a model script writes is what the game gets. Sizes go through dim(),
which never negates: a negative scale turns the mesh inside out.
"""

import math

import bpy
from mathutils import Matrix, Vector

SEG, RING = 16, 8


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


def skin(name, blobs, mat, budget, voxel=0.022):
    """Fuse overlapping blobs into ONE continuous surface.

    This is the difference between an animal and a pile of snowballs. A voxel
    remesh throws away the input topology and re-skins the union of the shapes,
    so the seams where blobs overlap simply stop existing. The result is dense,
    so it is then decimated to a triangle budget.
    """
    main = join_into(blobs[0], blobs[1:])
    main.name = name
    main.data.materials.clear()
    main.data.materials.append(mat)

    m = main.modifiers.new("Remesh", 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = voxel
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


def export_glb(path, parts):
    """Select everything and write a .glb. Returns the triangle count."""
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials='EXPORT',
        export_normals=True,
        export_cameras=False,
        export_lights=False,
    )
    tris = 0
    for p in parts:
        p.data.calc_loop_triangles()
        tris += len(p.data.loop_triangles)
    return tris
