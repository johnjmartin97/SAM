"""Modelling by cross-section, rather than by fusing spheres.

The old dog was a pile of overlapping blobs melted together by a voxel remesh.
That is why it read as a toy: a remesh gives uniform lumpy density everywhere
and no edge loops, so there is no anatomy in the surface -- no brow, no cheek,
no tuck-up at the loin, no shoulder.

This builds the way a modeller blocks out an animal: a spine, a series of
cross-sections along it, and a surface lofted through them. Every section is a
place where you can state an anatomical fact -- "the chest is deep and narrow
here", "the loin tucks up here" -- and the topology follows the form.

All coordinates are in GAME axes (X right, Y up, nose at -Z), converted on the
way into Blender by pt().
"""

import math

import bpy
from mathutils import Vector

from critterlib import pt

TAU = math.pi * 2


def section(z, y, half_w, up, down, exponent=2.4, n=20, x=0.0):
    """One cross-section: a closed ring of points.

    `up` and `down` are separate half-heights, which is what lets a chest be
    deep below the spine while staying flat on top. `exponent` controls how
    boxy the section is: 2 is a plain ellipse, higher is a fuller, more
    "well-sprung rib" shape.
    """
    pts = []
    for i in range(n):
        a = (i / n) * TAU
        cx = math.sin(a)
        cy = math.cos(a)
        # Superellipse: fuller shoulders on the section than a plain ellipse.
        sx = math.copysign(abs(cx) ** (2.0 / exponent), cx) if cx else 0.0
        sy = math.copysign(abs(cy) ** (2.0 / exponent), cy) if cy else 0.0
        h = up if sy >= 0 else down
        pts.append((x + sx * half_w, y + sy * h, z))
    return pts


def ring_at(centre, radius, normal, n=14, flatten=1.0):
    """A circular section perpendicular to `normal` -- used for limbs."""
    nvec = Vector(normal).normalized()
    # Any vector not parallel to the normal will do for the first axis.
    helper = Vector((0.0, 0.0, 1.0))
    if abs(nvec.dot(helper)) > 0.95:
        helper = Vector((1.0, 0.0, 0.0))
    u = nvec.cross(helper).normalized()
    v = nvec.cross(u).normalized()

    pts = []
    for i in range(n):
        a = (i / n) * TAU
        offset = u * (math.cos(a) * radius) + v * (math.sin(a) * radius * flatten)
        pts.append((centre[0] + offset.x, centre[1] + offset.y, centre[2] + offset.z))
    return pts


def loft(rings, name="part", cap_start=True, cap_end=True):
    """Skin a surface through a list of equal-length rings."""
    n = len(rings[0])
    verts = []
    faces = []

    for ring in rings:
        assert len(ring) == n, "every section must have the same point count"
        for p in ring:
            verts.append(pt(p))

    for r in range(len(rings) - 1):
        a = r * n
        b = (r + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append([a + i, b + i, b + j, a + j])

    if cap_start:
        faces.append(list(range(n - 1, -1, -1)))
    if cap_end:
        base = (len(rings) - 1) * n
        faces.append([base + i for i in range(n)])

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def tube(path, radii, n=14, name="limb", flatten=None):
    """A limb: circular sections swept along a path, tapering as given."""
    rings = []
    for i, point in enumerate(path):
        if i == 0:
            direction = Vector(path[1]) - Vector(path[0])
        elif i == len(path) - 1:
            direction = Vector(path[-1]) - Vector(path[-2])
        else:
            direction = Vector(path[i + 1]) - Vector(path[i - 1])
        squash = flatten[i] if flatten else 1.0
        rings.append(ring_at(point, radii[i], direction, n=n, flatten=squash))
    return loft(rings, name=name)


def smooth_shade(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    bpy.ops.object.select_all(action='DESELECT')


def subdivide(obj, levels=1):
    """Catmull-Clark, to turn blocked-out sections into a smooth surface.

    This is the step that makes lofted anatomy read as an animal rather than
    as a low-poly cage, and it keeps the edge loops the sections created.
    """
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("Subdivision", 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action='DESELECT')


# ------------------------------------------------------------ skinning --

def _distance_to_segment(p, a, b):
    ab = b - a
    length_sq = ab.dot(ab)
    if length_sq < 1e-9:
        return (p - a).length, 0.0
    t = max(0.0, min(1.0, (p - a).dot(ab) / length_sq))
    return (p - (a + ab * t)).length, t


def weight_to_bones(mesh_obj, rig, exclude=("root",), power=4.0, max_bones=3):
    """Assign skinning weights by distance to each bone.

    Blender's own automatic weighting needs watertight geometry and fails
    silently into something unusable when it does not get it. Since this mesh
    is generated, the weights can be generated too: nearest bones win, with a
    smooth falloff, which is what heat weighting approximates anyway. It is
    deterministic and it cannot fail on an intersecting limb.
    """
    bones = [b for b in rig.data.bones if b.name not in exclude]
    groups = {}
    for bone in bones:
        groups[bone.name] = mesh_obj.vertex_groups.new(name=bone.name)

    world = mesh_obj.matrix_world
    segments = [(b.name, b.head_local.copy(), b.tail_local.copy()) for b in bones]

    for vert in mesh_obj.data.vertices:
        p = world @ vert.co
        scored = []
        for name, head, tail in segments:
            d, _ = _distance_to_segment(p, head, tail)
            scored.append((d, name))
        scored.sort()
        chosen = scored[:max_bones]

        weights = []
        for d, name in chosen:
            weights.append((name, 1.0 / max(d, 1e-4) ** power))
        total = sum(w for _, w in weights)
        for name, w in weights:
            groups[name].add([vert.index], w / total, 'REPLACE')

    modifier = mesh_obj.modifiers.new("Armature", 'ARMATURE')
    modifier.object = rig
    modifier.use_vertex_groups = True
    mesh_obj.parent = rig
    return len(bones)


def decimate(obj, budget):
    """Bring a subdivided surface back to a triangle budget.

    Subdivision is what turns blocked-out sections into a smooth form, but it
    quadruples the count each level, and this mesh is drawn seventeen times --
    once as skin and sixteen times as fur shells.
    """
    obj.data.calc_loop_triangles()
    current = len(obj.data.loop_triangles)
    if current <= budget:
        return current
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("Decimate", 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = budget / current
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action='DESELECT')
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)
