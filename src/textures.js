import * as THREE from 'three';

// Every texture in the game is drawn here, in code, on a canvas. Nothing is
// downloaded and nothing is hand-painted, so the whole look is version
// controlled and tweakable by changing a number.
//
// The single biggest step from "primitives in a dark room" to "woods" is
// alpha-cut foliage: a branch is not a green cone, it is a few dozen flat
// cards each carrying a picture of a needle spray with transparent gaps
// between the needles. That is what needleSpray() and leafCluster() are for.

/** Deterministic RNG so every texture is identical between runs. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function finish(c, { repeat = 1, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Turn a drawn texture into a normal map by treating its brightness as height.
 * Cheap, and enough to make bark and ground catch the lamp as it sweeps past --
 * which is most of what sells a surface as real under a moving light.
 */
export function normalFromCanvas(c, strength = 2.2) {
  const size = c.width;
  const src = c.getContext('2d').getImageData(0, 0, size, size).data;
  const out = canvas(size);
  const dst = out.getContext('2d').createImageData(size, size);

  const lum = (x, y) => {
    const i = ((y & (size - 1)) * size + (x & (size - 1))) * 4;
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel, giving the slope of the height field in each direction.
      const dx =
        lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1) -
        (lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1));
      const dy =
        lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1) -
        (lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1));

      let nx = dx * strength;
      let ny = dy * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      dst.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      dst.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      dst.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      dst.data[i + 3] = 255;
    }
  }
  out.getContext('2d').putImageData(dst, 0, 0);
  const tex = finish(out, { srgb: false });
  return tex;
}

/* ------------------------------------------------------------------ bark -- */

/**
 * Bark. `style` picks the character: 'furrowed' for pine and oak, 'papery'
 * for birch with its dark lenticel scars, 'smooth' for beech.
 */
export function bark(style = 'furrowed', seed = 1) {
  const size = 512;
  const c = canvas(size);
  const g = c.getContext('2d');
  const r = rng(seed);

  const palette = {
    furrowed: ['#3a2b1e', '#2a1e14', '#4a382a', '#241a12'],
    papery: ['#cfc9bd', '#e2ded4', '#b6ae9f', '#8d8375'],
    smooth: ['#6a655c', '#7a756b', '#57534b', '#4a463f'],
  }[style];

  g.fillStyle = palette[0];
  g.fillRect(0, 0, size, size);

  if (style === 'papery') {
    // Birch: pale, with horizontal dark scars and peeling bands.
    for (let i = 0; i < 220; i++) {
      const y = r() * size;
      const w = 12 + r() * 120;
      const h = 1 + r() * 4;
      g.fillStyle = r() < 0.7 ? '#33302b' : palette[3];
      g.globalAlpha = 0.25 + r() * 0.6;
      g.fillRect(r() * size, y, w, h);
    }
    g.globalAlpha = 0.5;
    for (let i = 0; i < 26; i++) {
      g.fillStyle = palette[1 + ((r() * 3) | 0)];
      g.fillRect(0, r() * size, size, 3 + r() * 22);
    }
  } else {
    // Conifer and broadleaf: long vertical furrows of varying depth.
    const furrows = style === 'smooth' ? 40 : 130;
    for (let i = 0; i < furrows; i++) {
      const x = r() * size;
      const w = (style === 'smooth' ? 3 : 2) + r() * (style === 'smooth' ? 10 : 16);
      g.strokeStyle = palette[1 + ((r() * 3) | 0)];
      g.globalAlpha = 0.3 + r() * 0.6;
      g.lineWidth = w;
      g.beginPath();
      let x0 = x;
      g.moveTo(x0, -10);
      // Wander down the trunk so the furrows are not ruler-straight.
      for (let y = 0; y < size + 20; y += 24) {
        x0 += (r() - 0.5) * 11;
        g.lineTo(x0, y);
      }
      g.stroke();
    }
    // Flecks of lighter and darker bark, breaking up the streaks.
    for (let i = 0; i < 1600; i++) {
      g.globalAlpha = 0.05 + r() * 0.25;
      g.fillStyle = palette[(r() * 4) | 0];
      g.fillRect(r() * size, r() * size, 1 + r() * 4, 1 + r() * 9);
    }
  }

  g.globalAlpha = 1;
  return { map: finish(c, { repeat: 1 }), canvas: c };
}

/* --------------------------------------------------------------- foliage -- */

/**
 * A spray of conifer needles on a stem, on transparent background. Drawn once
 * and mapped onto flat cards; the transparency is what gives a tree its ragged
 * edge instead of a cone's clean silhouette.
 */
export function needleSpray(seed = 3, tint = [58, 82, 44]) {
  const size = 256;
  const c = canvas(size);
  const g = c.getContext('2d');
  const r = rng(seed);

  const mid = size * 0.5;
  // Woody stem running left to right.
  g.strokeStyle = '#3b2f22';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(6, mid);
  g.lineTo(size - 14, mid + (r() - 0.5) * 12);
  g.stroke();

  // Needles in pairs along the stem, shortening toward the tip.
  for (let i = 0; i < 240; i++) {
    const t = i / 240;
    const x = 10 + t * (size - 26);
    const y = mid + (r() - 0.5) * 10;
    const taper = Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.85);
    const len = (26 + r() * 52) * taper;
    const sweep = 0.5 + r() * 0.75; // needles angle back toward the tip
    const side = r() < 0.5 ? -1 : 1;

    const shade = 0.65 + r() * 0.5;
    g.strokeStyle = `rgb(${(tint[0] * shade) | 0},${(tint[1] * shade) | 0},${(tint[2] * shade) | 0})`;
    g.lineWidth = 1.1 + r() * 1.5;
    g.globalAlpha = 0.75 + r() * 0.25;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(sweep) * len * 0.55, y + side * Math.sin(sweep) * len);
    g.stroke();
  }
  g.globalAlpha = 1;
  return finish(c, { repeat: 1 });
}

/** A clump of broadleaf leaves, again on transparent background. */
export function leafCluster(seed = 5, tint = [64, 92, 40]) {
  const size = 256;
  const c = canvas(size);
  const g = c.getContext('2d');
  const r = rng(seed);

  // Thin twigs holding the clump together.
  g.strokeStyle = '#42352a';
  g.lineWidth = 2.5;
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.moveTo(size * 0.5, size * 0.94);
    g.quadraticCurveTo(
      size * (0.2 + r() * 0.6), size * (0.4 + r() * 0.3),
      size * (0.08 + r() * 0.84), size * (0.06 + r() * 0.5)
    );
    g.stroke();
  }

  for (let i = 0; i < 130; i++) {
    // Cluster the leaves toward the middle, thinning at the edges.
    const a = r() * Math.PI * 2;
    const rad = Math.pow(r(), 0.62) * size * 0.46;
    const x = size * 0.5 + Math.cos(a) * rad;
    const y = size * 0.52 + Math.sin(a) * rad * 0.92;
    const w = 12 + r() * 20;
    const h = w * (0.5 + r() * 0.45);
    const shade = 0.6 + r() * 0.62;

    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI * 2);
    g.fillStyle = `rgb(${(tint[0] * shade) | 0},${(tint[1] * shade) | 0},${(tint[2] * shade) | 0})`;
    g.globalAlpha = 0.82 + r() * 0.18;
    g.beginPath();
    g.ellipse(0, 0, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    // A midrib, so a leaf reads as a leaf up close.
    g.globalAlpha *= 0.5;
    g.strokeStyle = `rgb(${(tint[0] * shade * 0.6) | 0},${(tint[1] * shade * 0.6) | 0},${(tint[2] * shade * 0.55) | 0})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-w * 0.45, 0);
    g.lineTo(w * 0.45, 0);
    g.stroke();
    g.restore();
  }
  g.globalAlpha = 1;
  return finish(c, { repeat: 1 });
}

/** Low scrub, used for bushes and bramble. Denser and darker than a leaf clump. */
export function scrub(seed = 9) {
  return leafCluster(seed, [44, 66, 30]);
}

/* ---------------------------------------------------------------- ground -- */

/** Forest floor: moss, bare dirt, fallen needles and leaf litter. */
export function forestFloor(seed = 11) {
  const size = 512;
  const c = canvas(size);
  const g = c.getContext('2d');
  const r = rng(seed);

  g.fillStyle = '#2c2a1e';
  g.fillRect(0, 0, size, size);

  // Broad damp and dry patches.
  for (let i = 0; i < 90; i++) {
    g.globalAlpha = 0.16 + r() * 0.3;
    g.fillStyle = ['#3b4426', '#242017', '#443a25', '#2f3a22'][(r() * 4) | 0];
    g.beginPath();
    g.ellipse(r() * size, r() * size, 20 + r() * 90, 18 + r() * 80, r() * 3, 0, 6.3);
    g.fill();
  }

  // Fallen needles: thousands of short rust-coloured strokes.
  for (let i = 0; i < 4200; i++) {
    const x = r() * size;
    const y = r() * size;
    const a = r() * Math.PI;
    const len = 4 + r() * 13;
    g.globalAlpha = 0.18 + r() * 0.5;
    g.strokeStyle = ['#5b4526', '#6b5330', '#3f3220', '#7a6034'][(r() * 4) | 0];
    g.lineWidth = 0.8 + r() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }

  // Scattered moss and small stones for local contrast.
  for (let i = 0; i < 700; i++) {
    g.globalAlpha = 0.2 + r() * 0.55;
    g.fillStyle = r() < 0.75 ? '#39482a' : '#575349';
    const s = 1.5 + r() * 5;
    g.beginPath();
    g.ellipse(r() * size, r() * size, s, s * (0.6 + r() * 0.6), r() * 3, 0, 6.3);
    g.fill();
  }

  g.globalAlpha = 1;
  return { map: finish(c, { repeat: 26 }), canvas: c };
}

/** Rock face, for boulders. */
export function stone(seed = 17) {
  const size = 256;
  const c = canvas(size);
  const g = c.getContext('2d');
  const r = rng(seed);

  g.fillStyle = '#4a4d50';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    g.globalAlpha = 0.1 + r() * 0.4;
    g.fillStyle = ['#3a3d40', '#585b5e', '#2f3234', '#63615a'][(r() * 4) | 0];
    g.beginPath();
    g.ellipse(r() * size, r() * size, 4 + r() * 34, 4 + r() * 30, r() * 3, 0, 6.3);
    g.fill();
  }
  // Cracks.
  g.globalAlpha = 0.5;
  g.strokeStyle = '#23262a';
  for (let i = 0; i < 18; i++) {
    g.lineWidth = 0.6 + r() * 1.8;
    g.beginPath();
    let x = r() * size;
    let y = r() * size;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 60;
      y += (r() - 0.5) * 60;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // Lichen.
  for (let i = 0; i < 120; i++) {
    g.globalAlpha = 0.1 + r() * 0.28;
    g.fillStyle = r() < 0.6 ? '#6b7355' : '#8a8f6a';
    g.beginPath();
    g.ellipse(r() * size, r() * size, 2 + r() * 11, 2 + r() * 9, 0, 0, 6.3);
    g.fill();
  }
  g.globalAlpha = 1;
  return { map: finish(c, { repeat: 2 }), canvas: c };
}
