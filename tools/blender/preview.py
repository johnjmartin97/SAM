"""Render the model on a neutral studio setup, so it can be judged as a model.

    npm run preview

The game is a dark forest lit by one lamp -- the worst possible place to see
whether a shape is right. This renders clean side, front and three-quarter
views to tools/blender/preview/, which is how you actually look at a sculpt.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import make_samoyed  # noqa: E402

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "preview")

VIEWS = {
    "side": (90.0, 0.0, 5.4),
    "front": (0.0, 4.0, 5.0),
    "three-quarter": (128.0, 14.0, 5.6),
    "top": (90.0, 72.0, 6.0),
}


def studio():
    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.05, 0.055, 0.065, 1.0)
    bg.inputs[1].default_value = 1.0
    bpy.context.scene.world = world

    # Three-point: a key to describe form, a fill to keep shadows readable, and
    # a rim to separate a white dog from a dark background.
    for name, loc, energy, size in (
        ("key", (3.4, -4.2, 4.0), 900, 3.0),
        ("fill", (-4.0, -2.4, 1.6), 260, 4.0),
        ("rim", (-1.6, 4.6, 3.0), 700, 2.0),
    ):
        light_data = bpy.data.lights.new(name, type='AREA')
        light_data.energy = energy
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        light.location = loc
        constraint = light.constraints.new('TRACK_TO')
        bpy.context.collection.objects.link(light)
        constraint.target = bpy.context.scene.objects.get("Samoyed")


def render(view, yaw_deg, pitch_deg, distance):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 70
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam

    target = (0.0, 0.0, 0.62)
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    cam.location = (
        target[0] + math.sin(yaw) * math.cos(pitch) * distance,
        target[1] - math.cos(yaw) * math.cos(pitch) * distance,
        target[2] + math.sin(pitch) * distance,
    )
    constraint = cam.constraints.new('TRACK_TO')
    empty = bpy.data.objects.new("Target", None)
    empty.location = target
    bpy.context.collection.objects.link(empty)
    constraint.target = empty

    scene.render.resolution_x = 760
    scene.render.resolution_y = 760
    scene.render.filepath = os.path.join(OUT_DIR, f"{view}.png")
    scene.render.image_settings.file_format = 'PNG'
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 24
    bpy.ops.render.render(write_still=True)

    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(empty, do_unlink=True)


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    make_samoyed.build()
    studio()
    for name, (yaw, pitch, dist) in VIEWS.items():
        render(name, yaw, pitch, dist)
        print(f"SAM: rendered {name}")
    print(f"SAM: previews in {OUT_DIR}")
