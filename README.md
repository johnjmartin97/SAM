# SAM

A 3D platformer starring a low-poly cartoon Samoyed.

## Run it

```sh
npm run dev      # then open http://localhost:5173
```

WASD to move, Shift to run, Space to jump, click once then move the mouse to
look around.

## Rebuild the dog

The model is code, not a binary someone hand-sculpted. `tools/blender/make_samoyed.py`
builds it and exports `public/models/samoyed.glb`:

```sh
npm run model    # runs Blender with no window, takes about a second
```

Edit the numbers in that script, re-run it, refresh the browser. If the export
is missing or broken the game falls back to a box-shaped placeholder dog rather
than showing nothing.

## Where things live

| File | What it owns |
| --- | --- |
| `src/player.js` | How it feels to move. All the tuning numbers are at the top in `TUNING`. |
| `src/level.js` | The platforms. One list; each entry makes both the visible block and the thing you collide with. |
| `src/samoyed.js` | Loading the dog, and the trot/jump animation. |
| `src/camera.js` | The follow camera, including pulling in when a wall is behind you. |
| `tools/blender/make_samoyed.py` | The model itself. |

The dog's parts (`head`, `tail`, `leg_front_L`, ...) are named the same in
Blender and in the game, so the animation code finds them by name. Rename a
part in the Blender script and you must rename it in `PART_NAMES` too.
