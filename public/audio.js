// Beanwars sound: effects, procedural lofi music, welcome voice.
(() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null, musicOn = false, nextBar = 0, bar = 0, timer = null, ambOn = false;
  let muted = localStorage.getItem('bw-muted') === '1';
  const btn = () => document.getElementById('mute');
  function setIcon() { const b = btn(); if (b) b.innerHTML = muted ? '&#128263;' : '&#128266;'; }
  function init() {
    if (ctx) { if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    ctx = new AC();
    ctx.onstatechange = () => { if (ctx.state !== 'running') setTimeout(init, 300); };
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    musicBus = ctx.createGain(); musicBus.gain.value = 0.22; musicBus.connect(lp); lp.connect(master);
  }
  function tone(f, dur, type, g, when = 0, dest = sfxBus) {
    if (!ctx) return;
    const t = ctx.currentTime + when, o = ctx.createOscillator(), a = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(g, t + 0.012); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(a); a.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  let noiseBuf = null;
  function noise(dur, g, ftype, freq, at, dest = sfxBus) {
    if (!ctx) return;
    if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), a = ctx.createGain();
    s.buffer = noiseBuf; f.type = ftype; f.frequency.value = freq;
    a.gain.setValueAtTime(g, at); a.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f); f.connect(a); a.connect(dest); s.start(at, Math.random() * 0.5); s.stop(at + dur + 0.02);
  }
  // ---- lofi music ----
  const BPM = 74, BEAT = 60 / BPM;
  const CHORDS = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 53, 59]]; // Cmaj7 Am7 Fmaj7 G7
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function pad(m, at, dur) {
    const o = ctx.createOscillator(), a = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = hz(m + 12); o.detune.value = (Math.random() - 0.5) * 14;
    f.type = 'lowpass'; f.frequency.value = 900;
    a.gain.setValueAtTime(0.0001, at); a.gain.linearRampToValueAtTime(0.07, at + 0.4); a.gain.linearRampToValueAtTime(0.0001, at + dur);
    o.connect(f); f.connect(a); a.connect(musicBus); o.start(at); o.stop(at + dur + 0.1);
  }
  function kick(at) {
    const o = ctx.createOscillator(), a = ctx.createGain();
    o.frequency.setValueAtTime(120, at); o.frequency.exponentialRampToValueAtTime(45, at + 0.18);
    a.gain.setValueAtTime(0.9, at); a.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    o.connect(a); a.connect(musicBus); o.start(at); o.stop(at + 0.35);
  }
  function scheduleBar(at, i) {
    const ch = CHORDS[i % 4];
    ch.forEach((m) => pad(m, at, BEAT * 4));
    const bo = ctx.createOscillator(), ba = ctx.createGain(); bo.type = 'sine'; bo.frequency.value = hz(ch[0] - 12);
    ba.gain.setValueAtTime(0.0001, at); ba.gain.linearRampToValueAtTime(0.35, at + 0.03); ba.gain.linearRampToValueAtTime(0.0001, at + BEAT * 2.8);
    bo.connect(ba); ba.connect(musicBus); bo.start(at); bo.stop(at + BEAT * 3);
    kick(at); kick(at + BEAT * 2.5);
    noise(0.18, 0.25, 'bandpass', 1800, at + BEAT, musicBus); noise(0.18, 0.25, 'bandpass', 1800, at + BEAT * 3, musicBus);
    for (let k = 0; k < 8; k++) noise(0.04, 0.06, 'highpass', 7000, at + k * BEAT / 2 + (k % 2 ? BEAT * 0.08 : 0), musicBus);
    for (let k = 0; k < 6; k++) noise(0.01, 0.05, 'highpass', 3000, at + Math.random() * BEAT * 4, musicBus); // vinyl crackle
  }
  function startAmbience() {
    if (!ctx || ambOn || !musicBus) return;
    ambOn = true;
    if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240;
    const g = ctx.createGain(); g.gain.value = 0.035;
    src.connect(f); f.connect(g); g.connect(musicBus); src.start();
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 90; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 58; og.gain.value = 0.016;
    o.connect(og); og.connect(musicBus); o.start();
  }
  function startMusic() {
    if (!ctx) return;
    startAmbience();
    if (musicOn) return;
    musicOn = true; nextBar = ctx.currentTime + 0.1;
    timer = setInterval(() => {
      if (ctx.state !== 'running') { init(); return; }
      if (nextBar < ctx.currentTime) nextBar = ctx.currentTime + 0.1;
      while (nextBar < ctx.currentTime + 1.5) { scheduleBar(nextBar, bar++); nextBar += BEAT * 4; } }, 300);
  }
  // voices go through the same audio engine so iPhone doesn't pause the music for them
  const voiceBufs = {};
  function playVoice(url = '/welcome.mp3') {
    if (!ctx) return;
    const go = (b) => { const s = ctx.createBufferSource(); s.buffer = b; s.connect(master); s.start(); };
    if (voiceBufs[url]) return go(voiceBufs[url]);
    fetch(url).then((r) => r.arrayBuffer()).then((a) => new Promise((ok, no) => ctx.decodeAudioData(a, ok, no))).then((b) => { voiceBufs[url] = b; go(b); }).catch(() => {});
  }
  // ---- public ----
  window.BWA = {
    welcome() {
      init(); startMusic();
      if (!muted) playVoice('/welcome.mp3');
    },
    great() {
      init(); startMusic();
      if (!muted) playVoice('/great.mp3');
    },
    get state() { return ctx ? ctx.state : 'none'; },
    turn() { tone(660 + Math.random() * 60, 0.05, 'square', 0.03); },
    onState(prev, s, you) {
      if (!ctx) return;
      if (!prev) return;
      if (s.phase === 'countdown' && s.wait !== prev.wait && s.wait > 0) tone(440, 0.12, 'triangle', 0.08);
      if (s.phase === 'play' && prev.phase === 'countdown') tone(880, 0.2, 'triangle', 0.09);
      if (s.minX !== prev.minX && s.phase === 'play') { tone(90, 0.18, 'sine', 0.12); tone(180, 0.1, 'triangle', 0.04); }
      for (const r of s.riders) {
        const p = prev.riders.find((x) => x.id === r.id); if (!p) continue;
        if (p.alive && !r.alive) { noise(0.3, 0.5, 'lowpass', 1100, ctx.currentTime); tone(110, 0.2, 'sine', 0.15); }
        if (r.id === you && r.alive && p.dir !== r.dir && s.round === prev.round) this.turn();
      }
      if (s.phase === 'round-end' && prev.phase !== 'round-end') [523, 659, 784].forEach((f, i) => tone(f, 0.15, 'triangle', 0.07, i * 0.1));
      if (s.phase === 'match-end' && prev.phase !== 'match-end') [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.08, i * 0.14));
    },
  };
  const wake = () => { if (ctx) { init(); startMusic(); } };
  ['pointerdown', 'touchend', 'keydown'].forEach((ev) => document.addEventListener(ev, wake, true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  window.addEventListener('pageshow', wake);
  window.addEventListener('DOMContentLoaded', () => {
    setIcon();
    btn().addEventListener('click', (e) => {
      e.stopPropagation(); muted = !muted; localStorage.setItem('bw-muted', muted ? '1' : '0'); setIcon();
      init(); startMusic(); if (master) master.gain.value = muted ? 0 : 1;
    });
  });
})();
