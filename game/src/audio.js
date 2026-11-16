// audio.js — RUSTLINE sound bank. WebAudio synth only.
export class AudioBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._noiseBuf = null;
  }

  ensure() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) {
        this.ctx = null;
        this.master = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  tone(freq, dur, type = 'sine', gain = 0.15, slideTo = null, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, gain = 0.2, filterFreq = 1200, type = 'lowpass') {
    if (!this.ctx || this.muted) return;
    if (!this._noiseBuf) {
      const len = this.ctx.sampleRate;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  shot(kind) {
    if (!this.ctx || this.muted) return;
    const s = {
      vk47: [0.12, 0.3, 1500, 120, 'square', 0.15],
      hornet: [0.07, 0.22, 2200, 220, 'square', 0.1],
      longbow: [0.25, 0.4, 900, 90, 'sawtooth', 0.2],
      mauler: [0.3, 0.45, 800, 70, 'sawtooth', 0.25],
    }[kind] || [0.09, 0.25, 1800, 180, 'square', 0.12];
    this.noise(s[0], s[1], s[2]);
    this.tone(s[3], s[0], s[4], s[5]);
  }

  dry() { this.tone(1200, 0.05, 'square', 0.08); }

  reloadSnd() {
    this.tone(500, 0.06, 'square', 0.1, null, 0);
    this.tone(700, 0.06, 'square', 0.1, null, 0.18);
  }

  hitmark(head) { this.tone(head ? 1400 : 1000, 0.05, 'sine', 0.12); }

  killSnd() {
    this.tone(660, 0.12, 'sine', 0.15, null, 0);
    this.tone(440, 0.18, 'sine', 0.15, null, 0.12);
  }

  explosion() {
    this.noise(1.2, 0.5, 300);
    this.tone(55, 1.0, 'sine', 0.4);
  }

  beep(freq = 880) { this.tone(freq, 0.08, 'sine', 0.12); }

  sting(win) {
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    for (let i = 0; i < notes.length; i++) this.tone(notes[i], 0.12, 'triangle', 0.14, null, i * 0.12);
  }

  step() { this.noise(0.04, 0.03, 900); }
}
