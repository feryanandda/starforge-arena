/* STARFORGE sound: every effect is synthesised with WebAudio oscillators, so
   the game needs no audio files. A tiny step sequencer plays a dark synthwave
   bass line under the action. Sound starts on the first user gesture (browser
   policy) and M toggles mute. */
'use strict';

const Sfx = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  let musicTimer = null;
  let step = 0;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      return true;
    } catch (e) {
      return false;
    }
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, delay) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  /* A minor-key bass loop: A1 pattern with a fifth lift every other bar. */
  const BASS = [55, 0, 55, 55, 0, 55, 0, 65.41, 55, 0, 55, 55, 0, 82.41, 0, 73.42];

  function startMusic() {
    if (!ensure() || musicTimer !== null) return;
    step = 0;
    musicTimer = window.setInterval(() => {
      if (!ctx || muted) return;
      const f = BASS[step % BASS.length];
      if (f) tone(f, 0.16, 'sawtooth', 0.10);
      if (step % 4 === 0) tone(220, 0.3, 'sine', 0.03);
      step++;
    }, 150);
  }

  function stopMusic() {
    if (musicTimer !== null) {
      window.clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  return {
    unlock: ensure,
    shoot() { tone(880 + Math.random() * 120, 0.07, 'square', 0.05, 220); },
    hit() { tone(200, 0.05, 'square', 0.06, 90); },
    boom() { noise(0.35, 0.25); tone(120, 0.3, 'triangle', 0.2, 40); },
    bigBoom() { noise(0.7, 0.4); tone(90, 0.6, 'triangle', 0.3, 30); },
    hurt() { tone(160, 0.18, 'sawtooth', 0.16, 60); },
    dash() { noise(0.12, 0.08); tone(300, 0.12, 'sine', 0.06, 700); },
    pickup() { tone(660, 0.08, 'sine', 0.1); tone(990, 0.12, 'sine', 0.1, null, 0.07); },
    waveClear() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.1, null, i * 0.09)); },
    gameOver() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, null, i * 0.16)); },
    victory() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, null, i * 0.11)); },
    startMusic,
    stopMusic,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    isMuted() { return muted; },
  };
})();
