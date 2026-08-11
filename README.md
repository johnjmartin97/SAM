# SAM

A 3D game starring a Samoyed called Sam.

## Run it

```sh
npm run dev      # then open http://localhost:5173
```

WASD to move, Shift to run, Space to jump, click once then move the mouse to
look around.

## The stage: Lost in the Woods

Sam is somewhere in a dark pine forest and has to get back to the campsite
where his owner is waiting. He can only see a few metres around himself, so the
forest cannot be navigated by memory of the layout — you find your way by
spotting the firelight glowing above the treetops and walking toward it.

Reaching the fire completes the stage. Press R to go again.

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
| `src/woods.js` | The forest stage: trees, campsite, darkness, and the win condition. |
| `src/fur.js` | Sam's coat. Length, density and root darkness are the three knobs at the top. |
| `src/samoyed.js` | Loading the dog, and the trot/jump animation. |
| `src/camera.js` | The follow camera, including pulling in when a tree is behind you. |
| `src/level.js` | The old daylight platformer level. Not currently loaded; kept for later. |
| `tools/blender/make_samoyed.py` | The model itself. |

### Tuning the darkness

Three numbers decide how lost you feel, and they have to move together:

- `scene.fog` density in `src/woods.js` — how far you can see at all.
- The `lamp` distance and intensity in `src/main.js` — how far Sam's own light
  reaches. Roughly match it to the fog distance, or you get a lit circle with a
  visible hard edge.
- `skyGlow` opacity and height in `src/woods.js` — how obvious the campfire is
  from across the map. This is the difficulty dial: turn it down for a harder,
  more disorienting stage, up for a gentler one.

The dog's parts (`head`, `tail`, `leg_front_L`, ...) are named the same in
Blender and in the game, so the animation code finds them by name. Rename a
part in the Blender script and you must rename it in `PART_NAMES` too.
