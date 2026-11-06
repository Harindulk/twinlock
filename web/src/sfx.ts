// Tiny synthesized sound set (no audio files). Muted state persists in localStorage.
let ctx: AudioContext | null = null;
export let muted = typeof localStorage !== 'undefined' && localStorage.getItem('twinlock.muted') === '1';

export function setMuted(m: boolean) {
  muted = m;
  localStorage.setItem('twinlock.muted', m ? '1' : '0');
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.12, when = 0, slideTo?: number) {
  if (muted) return;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const jitter = () => 1 + (Math.random() - 0.5) * 0.06;
export const sfx = {
  move: (n: number) => tone(520 * jitter() * (1 + (n % 4) * 0.03), 0.07, 'triangle', 0.07),
  blocked: () => tone(140 * jitter(), 0.12, 'triangle', 0.14, 0, 90),
  fell: () => tone(420, 0.45, 'sine', 0.12, 0, 60),
  solved: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.09, i * 0.07)),
  verified: () => { tone(1319, 0.5, 'sine', 0.06); tone(1760, 0.6, 'sine', 0.05, 0.09); },
  rejected: () => { tone(160, 0.22, 'square', 0.05); tone(120, 0.3, 'square', 0.05, 0.12); },
};
