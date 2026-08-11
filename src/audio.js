import { riverZ, waterDepth } from './terrain.js';

// Everything you hear, synthesised in code.
//
// No sound files: same reasoning as the textures and the dog. A .wav is an
// asset you cannot review in a diff; an oscillator and a filter are three
// numbers you can change and hear the result of.
//
// Browsers refuse to start audio until the user does something, so nothing
// makes a sound until start() is called from the existing click-to-look.
//
// One deliberate correction to the obvious brief: this stage is at night, so
// there is no dawn chorus. Songbirds would be flatly wrong. What you get is
// crickets, the odd owl, wind in the canopy, and water.

const CRICKETS = 7;

export class Ambience {
  constructor() {
    this.ctx = null;
    this.started = false;
    this._crickets = [];
    this._nextOwl = 12 + Math.random() * 20;
    this._stepDistance = 0;
    this._time = 0;
  }

  /** Must be called from a real user gesture. */
  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.started = true;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);
    // Fade up, so switching on is not a click.
    this.master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.5);

    // One noise buffer, reused by everything that needs hiss.
    const seconds = 3;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // Brown-ish noise: smoother and less hissy than pure white.
      last = (last + Math.random() * 2 - 1) * 0.5;
      data[i] = last;
    }
    this.noise = buf;

    this._buildWind();
    this._buildRiver();
    this._buildFire();
    for (let i = 0; i < CRICKETS; i++) {
      this._crickets.push({
        next: Math.random() * 3,
        pan: Math.random() * 2 - 1,
        pitch: 3800 + Math.random() * 2200,
      });
    }
  }

  _noiseSource(loop = true) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    return src;
  }

  // --- wind in the canopy: always there, never in the foreground ----------
  _buildWind() {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.4;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.055;

    // A slow gust, so it breathes rather than hums.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(this.windGain.gain);
    lfo.start();

    src.connect(filter).connect(this.windGain).connect(this.master);
    src.start();
  }

  // --- the river: gets louder as you approach, and grittier in the rapids --
  _buildRiver() {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 0.6;
    const top = ctx.createBiquadFilter();
    top.type = 'highpass';
    top.frequency.value = 300;

    this.riverGain = ctx.createGain();
    this.riverGain.gain.value = 0;
    this.riverFilter = band;

    src.connect(band).connect(top).connect(this.riverGain).connect(this.master);
    src.start();
  }

  // --- campfire: a low roar plus irregular pops --------------------------
  _buildFire() {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;

    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    src.connect(filter).connect(this.fireGain).connect(this.master);
    src.start();
    this._nextCrackle = 0;
  }

  _panned(node, pan) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    return p;
  }

  /** A cricket's trill: several short pulses, not one tone. */
  _chirp(cricket) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = cricket.pitch;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = cricket.pitch;
    band.Q.value = 12;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    const pulses = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pulses; i++) {
      const t = t0 + i * 0.032;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.05, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.026);
    }

    osc.connect(band).connect(gain);
    this._panned(gain, cricket.pan).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + pulses * 0.032 + 0.05);
  }

  /** Two soft notes, a long way off. */
  _hoot() {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const base = 330 + Math.random() * 90;
    const notes = [base, base * 0.86]; // the classic two-note "hoo ... hoo"
    const pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < notes.length; i++) {
      const t = t0 + i * 0.55;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(notes[i], t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.055, t + 0.09);
      gain.gain.setValueAtTime(0.055, t + 0.26);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.45);
      osc.connect(gain);
      this._panned(gain, pan).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.5);
    }
  }

  /** A short filtered burst -- paws on needles and leaf litter. */
  footstep(wet = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = this._noiseSource(false);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = wet > 0.3 ? 2600 : 1500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(wet > 0.3 ? 0.09 : 0.055, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0, Math.random() * 2);
    src.stop(t0 + 0.12);
  }

  splash(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = this._noiseSource(false);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, t0);
    filter.frequency.exponentialRampToValueAtTime(500, t0 + 0.4);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.3 * power, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0, Math.random() * 2);
    src.stop(t0 + 0.55);
  }

  /** The flurry of a dog shaking itself dry. */
  shake() {
    if (!this.ctx) return;
    for (let i = 0; i < 7; i++) {
      setTimeout(() => this.splash(0.22), i * 90);
    }
  }

  update(dt, state) {
    if (!this.ctx) return;
    this._time += dt;
    const { position, speed, grounded, submersion, wetness, campDistance } = state;

    // --- river: distance to the channel centreline, plus how rough it is ---
    const toCentre = Math.abs(position.z - riverZ(position.x));
    const near = Math.max(0, 1 - toCentre / 26);
    const depth = waterDepth(position.x, position.z);
    const target = near * near * 0.42 + (depth > 0 ? 0.12 : 0);
    this.riverGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
    // Closer up you hear the grit of it, not just the rush.
    this.riverFilter.frequency.setTargetAtTime(
      700 + near * 900, this.ctx.currentTime, 0.5
    );

    // --- campfire ---
    const fire = Math.max(0, 1 - campDistance / 22);
    this.fireGain.gain.setTargetAtTime(fire * fire * 0.16, this.ctx.currentTime, 0.5);
    if (fire > 0.15) {
      this._nextCrackle -= dt;
      if (this._nextCrackle <= 0) {
        this._nextCrackle = 0.08 + Math.random() * 0.5;
        this.footstep(0); // a pop is close enough to a footstep in character
      }
    }

    // --- crickets: quieter near rushing water, where they would be drowned --
    const cricketVolume = 1 - near * 0.7;
    for (const c of this._crickets) {
      c.next -= dt;
      if (c.next <= 0) {
        c.next = 1.2 + Math.random() * 3.5;
        if (Math.random() < cricketVolume) this._chirp(c);
      }
    }

    // --- owl ---
    this._nextOwl -= dt;
    if (this._nextOwl <= 0) {
      this._nextOwl = 25 + Math.random() * 45;
      this._hoot();
    }

    // --- footsteps, paced by distance travelled rather than by a timer, so
    //     they stay in step whether he is walking or running ---
    if (grounded && submersion < 0.5) {
      this._stepDistance += speed * dt;
      if (this._stepDistance > 1.15) {
        this._stepDistance = 0;
        this.footstep(Math.max(submersion, wetness * 0.5));
      }
    } else {
      this._stepDistance = 0;
    }
  }
}
