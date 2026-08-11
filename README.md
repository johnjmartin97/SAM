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

A river runs between him and the camp, so at some point he has to swim. He
comes out soaked, shakes himself off, and drips for a good while afterwards.

Reaching the fire completes the stage. Press R to go again.

### Checking the ground

The river is cut into the terrain by a height function that both the visible
ground and the physics are built from. If those two ever disagree you fall
through the world, and it does not show up in a screenshot, so there is a
check for it:

```sh
node tools/check-terrain.mjs
```

It fires rays at the physics ground and compares where they land against the
mesh. Run it after changing anything in `src/terrain.js`.

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
| `src/woods.js` | Lays out the level: what goes where, the campsite, darkness, win condition. |
| `src/trees.js` | The nine tree species, how a tree is built, and foliage collision. |
| `src/textures.js` | Every texture in the game, drawn in code on a canvas. Nothing is downloaded. |
| `src/terrain.js` | The shape of the ground, including the river valley. One height function feeds the mesh, the physics and every object's placement. |
| `src/water.js` | The river surface. The shader knows the terrain shape, so the water clips itself exactly at the shoreline. |
| `src/effects.js` | Splashes, wake rings and the drips off a wet dog. |
| `src/fur.js` | Sam's coat. Length, density and root darkness are the three knobs at the top. |
| `src/samoyed.js` | Loading the dog, and the trot/jump animation. |
| `src/camera.js` | The follow camera, including pulling in when a tree is behind you. |
| `src/level.js` | The old daylight platformer level. Not currently loaded; kept for later. |
| `tools/blender/make_samoyed.py` | The model itself. |

### How a tree is made

A tree is a trunk mesh plus a few dozen flat cards, each carrying an alpha-cut
picture of a needle spray or leaf clump drawn by `src/textures.js`. That is how
real-time engines build trees, and it is what gives a ragged edge you can see
through instead of a clean green cone.

The whole forest is 640 trees and about 26,000 cards, but all conifer foliage
is a single draw call and all broadleaf foliage another. Per-instance colour
means no two trees are quite the same shade.

Nine species: scots pine, norway spruce, young fir, silver birch, oak, beech,
dead snag, sapling and stump — plus bushes, bramble, fallen logs and boulders.

**Collision.** Trunks, boulders and logs block you. So does foliage: every
canopy has a collider, which above head height mostly stops the *camera* from
flying through branches. The species that skirt the ground — young firs,
saplings, bushes — are what actually block Sam, so the floor is something to
pick through rather than a plane with scenery painted on it. Bramble is
deliberately left non-solid; making it solid turns a dark forest into a maze
you cannot walk in.

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
