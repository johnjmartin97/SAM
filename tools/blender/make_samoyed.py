"""Build the Samoyed -- one continuous skinned body on a bone rig -- and export
it to public/models/samoyed.glb.

    npm run model

What changed, and why it matters:

The dog used to be seven separate objects that the game rotated individually.
That is why it read as a toy: rigid parts pivoting against each other, with
visible seams where they met. It is now ONE surface, fused by a voxel remesh,
bound to a skeleton. A skeleton deforms the surface, so the body bends through
a stride and the coat goes with it.

Animation lives in the file as real clips -- Idle, Walk, Run, Airborne, Swim,
Shake -- keyed on blocked poses rather than sampled from a sine wave. The game
plays and cross-fades them instead of driving joint angles itself.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from critterlib import join_into, material, reset_scene, shape, skin  # noqa: E402


def boolean_cut(target, cutters):
    """Subtract shapes from a mesh, so a hollow is a real hollow."""
    for cutter in cutters:
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = target
        mod = target.modifiers.new("Cut", 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        mod.solver = 'EXACT'
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
from rig import bind, build_actions, build_armature  # noqa: E402

OUT = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                 "public", "models", "samoyed.glb")
)

CREAM = (0.965, 0.953, 0.933, 1.0)
# Nose leather and eye rims: near-black, and warm rather than blue-grey. The
# old value was a mid grey, which is why the face read as plastic.
NOSE = (0.030, 0.026, 0.026, 1.0)
# A dog's eye is very dark brown, not black -- the brown only shows where light
# catches it, which is exactly what makes it look wet rather than painted on.
EYE = (0.048, 0.028, 0.020, 1.0)
TONGUE = (0.796, 0.372, 0.404, 1.0)
# Samoyed inner ear: pink, but it is thin skin over cartilage, so it is muted.
INNER_EAR = (0.874, 0.596, 0.573, 1.0)

# One surface for the whole animal, so it can be skinned.
BODY_BUDGET = 22000
VOXEL = 0.015


def build_mesh():
    reset_scene()

    fur = material("Fur", CREAM)
    # A nose is WET. Low roughness is the whole trick: it makes the lamp leave
    # a sharp highlight on it, which is what the eye reads as moisture.
    dark = material("Dark", NOSE, rough=0.16)
    # Glossier still. The catchlight in an eye is the single thing that makes a
    # face look alive rather than like a doll's.
    eye_mat = material("Eye", EYE, rough=0.05)
    tongue_mat = material("Tongue", TONGUE, rough=0.42)
    ear_mat = material("InnerEar", INNER_EAR, rough=0.62)

    # Everything furry, in one list, fused into a single continuous skin.
    # No pivots: the bones articulate the animal now, not object origins.
    blobs = [
        shape("sphere", (0.60, 0.58, 1.02), (0, 0.64, 0.02), name="torso"),
        shape("sphere", (0.64, 0.60, 0.60), (0, 0.66, -0.32), name="chest"),
        shape("sphere", (0.66, 0.64, 0.62), (0, 0.62, 0.36), name="rump"),
        shape("sphere", (0.84, 0.80, 0.52), (0, 0.76, -0.48), name="ruff"),
        shape("sphere", (0.74, 0.70, 0.36), (0, 0.78, -0.62), name="ruff_front"),
        shape("sphere", (0.54, 0.40, 0.84), (0, 0.48, 0.04), name="belly"),
        shape("sphere", (0.50, 0.46, 0.44), (0, 0.56, -0.26), name="shoulders"),
        shape("sphere", (0.56, 0.50, 0.48), (0, 0.54, 0.32), name="haunches"),
        # A real neck, so head and body are one piece rather than two balls
        # touching -- which is what let the old model read as assembled.
        shape("capsule", (0.34, 0.34, 0.34), (0, 0.86, -0.60), name="neck",
              aim=(0, 0.5, -1)),
        shape("sphere", (0.46, 0.46, 0.46), (0, 0.99, -0.66), name="skull"),
        shape("sphere", (0.44, 0.38, 0.36), (0, 1.10, -0.62), name="forehead"),
        shape("sphere", (0.32, 0.29, 0.32), (0, 0.91, -0.83), name="muzzle_base"),
        shape("cone", (0.28, 0.28, 0.32), (0, 0.905, -0.90), name="muzzle",
              aim=(0, -0.12, -1)),
        shape("sphere", (0.24, 0.24, 0.26), (-0.16, 0.96, -0.72), name="cheek_l"),
        shape("sphere", (0.24, 0.24, 0.26), (0.16, 0.96, -0.72), name="cheek_r"),
        shape("cone", (0.21, 0.27, 0.14), (-0.165, 1.27, -0.60), name="ear_l",
              aim=(-0.36, 1.0, -0.12)),
        shape("cone", (0.21, 0.27, 0.14), (0.165, 1.27, -0.60), name="ear_r",
              aim=(0.36, 1.0, -0.12)),
        shape("sphere", (0.25, 0.25, 0.25), (0, 0.90, 0.48), name="tail_0"),
        shape("sphere", (0.24, 0.24, 0.24), (0, 1.06, 0.44), name="tail_1"),
        shape("sphere", (0.22, 0.22, 0.22), (0, 1.18, 0.30), name="tail_2"),
        shape("sphere", (0.20, 0.20, 0.20), (0, 1.20, 0.12), name="tail_3"),
        shape("sphere", (0.18, 0.18, 0.18), (0, 1.15, -0.04), name="tail_4"),
    ]

    for x, z, back in ((-0.20, -0.30, False), (0.20, -0.30, False),
                       (-0.20, 0.34, True), (0.20, 0.34, True)):
        blobs += [
            shape("sphere", (0.30 if back else 0.26, 0.34, 0.30 if back else 0.26),
                  (x, 0.36, z), name="thigh"),
            shape("capsule", (0.19, 0.26, 0.19), (x, 0.22, z), name="upper",
                  aim=(0, -1, 0)),
            shape("capsule", (0.155, 0.22, 0.155), (x, 0.09, z), name="shin",
                  aim=(0, -1, 0)),
            shape("sphere", (0.21, 0.15, 0.26), (x, 0.01, z - 0.03), name="paw"),
        ]

    body = skin("Samoyed", blobs, fur, BODY_BUDGET, voxel=VOXEL)

    details = [
        # Nose leather: wider than deep, with a flat front, not a ball.
        shape("sphere", (0.132, 0.104, 0.098), (0, 0.906, -1.022), mat=dark,
              name="nose"),
        shape("sphere", (0.19, 0.065, 0.14), (0, 0.830, -0.945), mat=tongue_mat,
              name="smile"),
    ]
    # Nostrils are CUT, not added. Added as geometry they read as two warts
    # stuck on the end of the nose, which is exactly how the first attempt
    # looked.
    nose_obj = details[0]
    cutters = [shape("sphere", (0.052, 0.060, 0.070), (0.046 * sign, 0.900, -1.070),
                     name="nostril_cut") for sign in (-1, 1)]
    boolean_cut(nose_obj, cutters)

    for s in (-1, 1):
        details += [
            # The eye rim. Samoyeds are required to have black rims, and it is
            # what sets the eye INTO the face instead of stuck onto it.
            shape("sphere", (0.104, 0.090, 0.054), (0.127 * s, 1.017, -0.838),
                  mat=dark, name="eye_rim"),
            # The eye itself: smaller, and pushed back into the socket so only
            # the front of the curve shows.
            shape("sphere", (0.064, 0.060, 0.052), (0.125 * s, 1.019, -0.866),
                  mat=eye_mat, name="eye"),
            shape("cone", (0.115, 0.17, 0.075), (0.163 * s, 1.255, -0.655),
                  mat=ear_mat, name="ear_inner", aim=(0.36 * s, 1.0, -0.12)),
        ]
    body = join_into(body, details)
    body.name = "Samoyed"

    # Plain smooth shading, not the angle-based modifier: modifiers are NOT
    # applied on export for a skinned mesh (applying them would collapse the
    # armature), so the shading has to live in the mesh itself.
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.shade_smooth()
    bpy.ops.object.select_all(action='DESELECT')

    return body


def export(mesh):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        # MUST stay false: applying modifiers would bake away the armature and
        # export a statue.
        export_apply=False,
        export_skins=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_materials='EXPORT',
        export_normals=True,
        export_cameras=False,
        export_lights=False,
    )
    mesh.data.calc_loop_triangles()
    return len(mesh.data.loop_triangles)


if __name__ == "__main__":
    mesh = build_mesh()
    rig = build_armature()
    how = bind(mesh, rig)
    actions = build_actions(rig)
    tris = export(mesh)
    print(f"SAM: {tris:,} triangles, {len(rig.pose.bones)} bones, "
          f"{len(actions)} clips ({', '.join(actions)}), weights: {how}")
    print(f"SAM: wrote {OUT}")
