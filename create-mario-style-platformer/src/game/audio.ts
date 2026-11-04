// Web Audio synthesized SFX + music sequencer (no external files)
let ctx: AudioContext | null = null;
let muted = false;
let musicTimer: number | null = null;
let musicStep = 0;
let musicPlaying = false;

export function setMuted(m: boolean) {
  muted = m;
  if (m) stopMusic();
  else if (musicPlaying) startMusic();
}
export function isMuted() { return muted; }

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { return null; }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.12, slideTo?: number, delay = 0) {
  if (muted) return;
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t); osc.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.15, delay = 0, freq = 1000) {
  if (muted) return;
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const bufferSize = a.sampleRate * dur;
  const buffer = a.createBuffer(1, bufferSize, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = a.createBufferSource(); src.buffer = buffer;
  const filter = a.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = freq;
  const gain = a.createGain(); gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(gain).connect(a.destination);
  src.start(t);
}

export const sfx = {
  jump(big = false) { tone(big ? 300 : 380, 0.18, "square", 0.10, big ? 900 : 1050); },
  coin() { tone(988, 0.07, "square", 0.09); tone(1319, 0.35, "square", 0.09, undefined, 0.07); },
  stomp() { tone(500, 0.12, "square", 0.12, 120); noise(0.08, 0.08, 0, 800); },
  bump() { tone(160, 0.1, "square", 0.12, 90); },
  brick() { noise(0.18, 0.16, 0, 1800); tone(220, 0.1, "square", 0.08, 60); },
  powerup() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.11, "square", 0.09, undefined, i * 0.07)); },
  powerdown() { [800, 600, 400, 200].forEach((f, i) => tone(f, 0.14, "square", 0.09, undefined, i * 0.09)); },
  kick() { tone(700, 0.1, "square", 0.11, 200); },
  shoot() { tone(900, 0.12, "square", 0.08, 300); },
  oneUp() { [659, 784, 1319, 1047, 1175, 1319].forEach((f, i) => tone(f, 0.12, "square", 0.09, undefined, i * 0.08)); },
  death() { [660, 622, 587, 523, 440, 392, 330].forEach((f, i) => tone(f, 0.16, "square", 0.10, undefined, i * 0.13)); },
  flag() { [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.14, "square", 0.09, undefined, i * 0.09)); },
  pause() { tone(440, 0.08, "square", 0.08); tone(880, 0.12, "square", 0.08, undefined, 0.08); },
  gameover() { [392, 370, 349, 311].forEach((f, i) => tone(f, 0.35, "triangle", 0.12, undefined, i * 0.3)); },
  win() { [523, 523, 523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.16, "square", 0.09, undefined, i * 0.12)); },
  spring() { tone(200, 0.2, "square", 0.1, 1200); },
  splash() { noise(0.25, 0.12, 0, 600); },
};

// Simple overworld-inspired loop (original melody, chiptune style)
const MELODY = [
  // [note, steps]
  [659, 2], [659, 1], [0, 1], [659, 1], [0, 1], [523, 1], [659, 1], [784, 2], [0, 2],
  [392, 2], [0, 2], [523, 2], [0, 2], [440, 2], [0, 1], [494, 1], [466, 1], [440, 2],
  [784, 2], [659, 2], [587, 2], [523, 2], [0, 2], [587, 2], [659, 2], [0, 2],
  [523, 2], [659, 2], [784, 2], [1047, 2], [880, 2], [784, 2], [659, 2], [523, 2],
  [659, 2], [659, 1], [0, 1], [659, 1], [0, 1], [523, 1], [659, 1], [784, 2], [0, 2],
  [392, 2], [0, 2], [523, 2], [0, 2], [440, 2], [0, 1], [494, 1], [466, 1], [440, 2],
  [784, 2], [659, 2], [587, 2], [523, 2], [0, 2], [587, 2], [659, 2], [0, 2],
  [523, 2], [659, 2], [784, 2], [1047, 2], [880, 2], [784, 2], [659, 2], [523, 2],
];
const BASS = [131, 131, 98, 98, 110, 110, 131, 131, 98, 98, 110, 110, 131, 131, 98, 98];

export function startMusic() {
  if (muted || musicTimer !== null) return;
  musicPlaying = true;
  musicStep = 0;
  const stepDur = 140; // ms per 16th-ish step
  const playStep = () => {
    if (muted) return;
    let target = musicStep;
    let acc = 0;
    let note = 0;
    for (let i = 0; i < MELODY.length; i++) {
      const [n, len] = MELODY[i];
      if (target >= acc && target < acc + len) { note = n; break; }
      acc += len;
    }
    const totalSteps = MELODY.reduce((s, x) => s + x[1], 0);
    if (note > 0) tone(note, stepDur * 0.9 / 1000, "square", 0.045);
    // bass every 4 steps
    if (musicStep % 4 === 0) {
      const b = BASS[(musicStep / 4) % BASS.length | 0];
      tone(b, 0.22, "triangle", 0.06);
    }
    // hat
    if (musicStep % 2 === 0) noise(0.03, 0.015, 0, 6000);
    musicStep = (musicStep + 1) % totalSteps;
  };
  playStep();
  musicTimer = window.setInterval(playStep, stepDur);
}
export function stopMusic() {
  musicPlaying = false;
  if (musicTimer !== null) { clearInterval(musicTimer); musicTimer = null; }
}
