"""The skeleton and the animation, for the Samoyed.

This replaces the procedural sine-wave legs the game used to run. Those moved
whole rigid parts; a skeleton deforms the SURFACE, so the body bends, the spine
flexes through a stride, and the coat moves with the skin.

The animation is keyframed on poses -- contact, down, passing, up -- the way an
animator blocks a cycle, rather than sampled from a sine. That matters because
the poses are the thing you can look at and adjust; a sine has no poses in it.

Angles are in degrees, in the bone's local space, and the joint list is written
in the GAME's axes (X right, Y up, nose at -Z) and converted by pt().
"""

import math

import bpy
from mathutils import Matrix, Vector

from critterlib import pt

# --------------------------------------------------------------- skeleton --

# name: (head, tail, parent, connected)
# Written nose-negative-Z, Y up: the same numbers the mesh is built from.
BONES = [
    ("root",        (0, 0.00, 0.20), (0, 0.22, 0.20), None, False),

    ("hips",        (0, 0.62, 0.42), (0, 0.64, 0.10), "root", False),
    ("spine",       (0, 0.64, 0.10), (0, 0.67, -0.24), "hips", True),
    ("chest",       (0, 0.67, -0.24), (0, 0.79, -0.52), "spine", True),
    ("neck",        (0, 0.79, -0.52), (0, 0.95, -0.68), "chest", True),
    ("head",        (0, 0.95, -0.68), (0, 0.92, -1.02), "neck", True),

    ("ear.L",       (-0.15, 1.14, -0.62), (-0.23, 1.36, -0.57), "head", False),
    ("ear.R",       (0.15, 1.14, -0.62), (0.23, 1.36, -0.57), "head", False),

    ("tail.01",     (0, 0.82, 0.46), (0, 1.04, 0.44), "hips", False),
    ("tail.02",     (0, 1.04, 0.44), (0, 1.20, 0.22), "tail.01", True),
    ("tail.03",     (0, 1.20, 0.22), (0, 1.18, -0.04), "tail.02", True),

    ("shoulder.L",  (-0.06, 0.70, -0.34), (-0.20, 0.52, -0.31), "chest", False),
    ("upperarm.L",  (-0.20, 0.52, -0.31), (-0.20, 0.29, -0.28), "shoulder.L", True),
    ("forearm.L",   (-0.20, 0.29, -0.28), (-0.20, 0.11, -0.31), "upperarm.L", True),
    ("paw.L",       (-0.20, 0.11, -0.31), (-0.20, 0.02, -0.42), "forearm.L", True),

    ("shoulder.R",  (0.06, 0.70, -0.34), (0.20, 0.52, -0.31), "chest", False),
    ("upperarm.R",  (0.20, 0.52, -0.31), (0.20, 0.29, -0.28), "shoulder.R", True),
    ("forearm.R",   (0.20, 0.29, -0.28), (0.20, 0.11, -0.31), "upperarm.R", True),
    ("paw.R",       (0.20, 0.11, -0.31), (0.20, 0.02, -0.42), "forearm.R", True),

    ("thigh.L",     (-0.09, 0.68, 0.34), (-0.21, 0.46, 0.40), "hips", False),
    ("shin.L",      (-0.21, 0.46, 0.40), (-0.21, 0.22, 0.30), "thigh.L", True),
    ("foot.L",      (-0.21, 0.22, 0.30), (-0.21, 0.04, 0.36), "shin.L", True),

    ("thigh.R",     (0.09, 0.68, 0.34), (0.21, 0.46, 0.40), "hips", False),
    ("shin.R",      (0.21, 0.46, 0.40), (0.21, 0.22, 0.30), "thigh.R", True),
    ("foot.R",      (0.21, 0.22, 0.30), (0.21, 0.04, 0.36), "shin.R", True),
]


def build_armature(name="SamoyedRig"):
    armature = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, armature)
    bpy.context.collection.objects.link(rig)

    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')

    created = {}
    for bone_name, head, tail, parent, connected in BONES:
        bone = armature.edit_bones.new(bone_name)
        bone.head = pt(head)
        bone.tail = pt(tail)
        created[bone_name] = bone

    for bone_name, head, tail, parent, connected in BONES:
        if parent:
            created[bone_name].parent = created[parent]
            created[bone_name].use_connect = connected

    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def bind(mesh_obj, rig):
    """Skin the mesh to the skeleton.

    Automatic (heat) weighting needs watertight geometry, which is exactly what
    the voxel remesh produces -- one continuous surface rather than a pile of
    overlapping parts. If it still fails, envelopes are a usable fallback.
    """
    bpy.ops.object.select_all(action='DESELECT')
    mesh_obj.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        return "automatic"
    except RuntimeError:
        bpy.ops.object.select_all(action='DESELECT')
        mesh_obj.select_set(True)
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.parent_set(type='ARMATURE_ENVELOPE')
        return "envelope"


# ------------------------------------------------------------- animation --

def _pose(rig, frame, angles):
    """Key one pose. `angles` maps bone name -> (rx, ry, rz) in degrees."""
    for bone_name, rot in angles.items():
        bone = rig.pose.bones.get(bone_name)
        if bone is None:
            continue
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = tuple(math.radians(a) for a in rot)
        bone.keyframe_insert(data_path="rotation_euler", frame=frame)


def make_action(rig, name, keys, loop=True):
    """Build one clip from a list of (frame, {bone: angles}) poses."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action

    # Clear any pose left over from the previous clip, or it leaks into this one.
    for bone in rig.pose.bones:
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = (0, 0, 0)

    for frame, angles in keys:
        _pose(rig, frame, angles)

    if loop and keys:
        # Close the loop exactly, so the cycle does not pop.
        last_frame = keys[-1][0]
        _pose(rig, last_frame, keys[0][1])

    # Blender 5 moved f-curves behind action slots/layers. The default
    # interpolation is already Bezier, so this is only a nicety -- guard it
    # rather than depend on an API that moved.
    if hasattr(action, "fcurves"):
        for fcurve in action.fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = 'BEZIER'
    return action


# A trot: diagonal pairs move together, which is what a dog actually does at
# this speed. Front and back of the same diagonal are 180 degrees apart.
def _trot(reach, lift, spine):
    """Four blocked poses of a trot cycle, parameterised by how hard it is run."""
    def pose(phase):
        # phase 0 = left-front/right-back forward.
        a = phase * math.pi * 2
        fl = math.sin(a) * reach
        fr = math.sin(a + math.pi) * reach
        bl = math.sin(a + math.pi) * reach
        br = math.sin(a) * reach
        # Knees and hocks bend on the recovery half of the stroke.
        kfl = max(0.0, -math.sin(a)) * lift
        kfr = max(0.0, -math.sin(a + math.pi)) * lift
        kbl = max(0.0, math.sin(a + math.pi)) * lift
        kbr = max(0.0, math.sin(a)) * lift
        return {
            "upperarm.L": (fl, 0, 0), "forearm.L": (-kfl, 0, 0),
            "upperarm.R": (fr, 0, 0), "forearm.R": (-kfr, 0, 0),
            "thigh.L": (bl, 0, 0), "shin.L": (kbl, 0, 0),
            "thigh.R": (br, 0, 0), "shin.R": (kbr, 0, 0),
            # The spine counter-rotates through the stride; this is most of
            # what makes a four-legged walk look alive rather than mechanical.
            "spine": (0, math.sin(a) * spine, 0),
            "chest": (0, math.sin(a + 0.6) * spine * 0.6, 0),
            "neck": (0, math.sin(a + 1.2) * -spine * 0.5, 0),
            "hips": (math.sin(a * 2) * spine * 0.4, 0, 0),
            "tail.01": (-18 + math.sin(a * 2) * 6, math.sin(a) * 10, 0),
            "tail.02": (-14, math.sin(a + 0.5) * 12, 0),
        }
    return pose


def build_actions(rig):
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')

    actions = {}

    # --- Idle: breathing, an ear flick, a slow tail sway ---
    actions["Idle"] = make_action(rig, "Idle", [
        (1, {"chest": (0, 0, 0), "neck": (2, 0, 0), "head": (0, 0, 0),
             "tail.01": (-20, 0, 0), "tail.02": (-16, 0, 0), "tail.03": (-8, 0, 0),
             "ear.L": (0, 0, 0), "ear.R": (0, 0, 0)}),
        (30, {"chest": (1.5, 0, 0), "neck": (3, 4, 0), "head": (2, 3, 0),
              "tail.01": (-20, 9, 0), "tail.02": (-16, 12, 0), "tail.03": (-8, 10, 0),
              "ear.L": (0, 0, -6), "ear.R": (0, 0, 4)}),
        (52, {"chest": (0, 0, 0), "neck": (2, -3, 0), "head": (-1, -4, 0),
              "tail.01": (-20, -9, 0), "tail.02": (-16, -12, 0), "tail.03": (-8, -10, 0),
              "ear.L": (0, 0, 3), "ear.R": (0, 0, -7)}),
        (80, {"chest": (0, 0, 0), "neck": (2, 0, 0), "head": (0, 0, 0),
              "tail.01": (-20, 0, 0), "tail.02": (-16, 0, 0), "tail.03": (-8, 0, 0),
              "ear.L": (0, 0, 0), "ear.R": (0, 0, 0)}),
    ])

    # --- Walk: an easy trot, 24 frames ---
    walk = _trot(reach=22, lift=26, spine=5)
    actions["Walk"] = make_action(rig, "Walk", [
        (1 + i * 6, walk(i / 4.0)) for i in range(5)
    ])

    # --- Run: longer reach, deeper knee, more spine ---
    run = _trot(reach=38, lift=46, spine=9)
    actions["Run"] = make_action(rig, "Run", [
        (1 + i * 4, run(i / 4.0)) for i in range(5)
    ])

    # --- Airborne: front legs tucked, back legs trailing ---
    airborne = {
        "upperarm.L": (-46, 0, 0), "forearm.L": (-58, 0, 0),
        "upperarm.R": (-46, 0, 0), "forearm.R": (-58, 0, 0),
        "thigh.L": (34, 0, 0), "shin.L": (30, 0, 0),
        "thigh.R": (34, 0, 0), "shin.R": (30, 0, 0),
        "chest": (-6, 0, 0), "neck": (-10, 0, 0), "head": (-6, 0, 0),
        "tail.01": (-34, 0, 0), "tail.02": (-22, 0, 0),
    }
    actions["Airborne"] = make_action(rig, "Airborne", [
        (1, airborne), (20, airborne)
    ], loop=False)

    # --- Swim: front legs do the work, back legs kick shallow, nose up ---
    def paddle(phase):
        a = phase * math.pi * 2
        return {
            "upperarm.L": (-26 + math.sin(a) * 34, 0, 0),
            "forearm.L": (-40 + math.sin(a + 1.0) * 26, 0, 0),
            "upperarm.R": (-26 + math.sin(a + math.pi) * 34, 0, 0),
            "forearm.R": (-40 + math.sin(a + math.pi + 1.0) * 26, 0, 0),
            "thigh.L": (14 + math.sin(a + math.pi) * 16, 0, 0),
            "shin.L": (18, 0, 0),
            "thigh.R": (14 + math.sin(a) * 16, 0, 0),
            "shin.R": (18, 0, 0),
            "neck": (-16, 0, 0), "head": (-10, 0, 0),
            "tail.01": (-6, math.sin(a) * 8, 0), "tail.02": (-4, 0, 0),
        }
    actions["Swim"] = make_action(rig, "Swim", [
        (1 + i * 5, paddle(i / 4.0)) for i in range(5)
    ])

    # --- Shake: the whole body rolls, head and tail lagging behind it ---
    shake_keys = []
    for i in range(11):
        frame = 1 + i * 2
        a = i / 2.0 * math.pi
        shake_keys.append((frame, {
            "hips": (0, 0, math.sin(a) * 26),
            "spine": (0, 0, math.sin(a - 0.5) * 30),
            "chest": (0, 0, math.sin(a - 1.0) * 34),
            "neck": (0, 0, math.sin(a - 1.5) * 30),
            "head": (0, 0, math.sin(a - 2.0) * 38),
            "tail.01": (-18, 0, math.sin(a - 1.8) * 34),
            "tail.02": (-14, 0, math.sin(a - 2.4) * 30),
            "ear.L": (0, 0, math.sin(a - 2.2) * 30),
            "ear.R": (0, 0, math.sin(a - 2.2) * 30),
        }))
    actions["Shake"] = make_action(rig, "Shake", shake_keys, loop=False)

    bpy.ops.object.mode_set(mode='OBJECT')
    return actions
