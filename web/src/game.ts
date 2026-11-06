import { applyMove, fell, mirror, solved, PAD_A, PAD_B, PIT, WALL, type Grid } from './rules';

export interface GameHooks {
  onMove?(moves: number[]): void;
  onSolved?(moves: number[]): void;
  onFell?(): void;
  onBlocked?(): void;
}

const COLORS = {
  well: '#f4f6f8',
  floor: '#ffffff',
  wall: '#2a2d31',
  pit: '#131416',
  a: '#1b6c80',
  b: '#a86f0c',
  aSoft: '#d6e8ec',
  bSoft: '#f3e6cf',
};

const DIR_VEC = [[0, -1], [0, 1], [-1, 0], [1, 0]];

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
const ease = (t: number) => 1 - (1 - t) ** 3;

interface Anim {
  from: [number, number];
  to: [number, number];
  t0: number;
  bump?: number; // direction of a blocked bump
}

/** Canvas board: input, undo, animation. Rules come only from rules.ts. */
export class Game {
  g!: Grid;
  a = 0;
  b = 0;
  moves: number[] = [];
  done = false;
  dead = false;
  private animA!: Anim;
  private animB!: Anim;
  private cell = 64;
  private ctx: CanvasRenderingContext2D;
  private solvedAt = 0;
  private fellAt = 0;
  private queue: number[] = [];
  private playing = false;
  private particles: Particle[] = [];
  private trauma = 0;
  private lastFrame = 0;

  constructor(private canvas: HTMLCanvasElement, private hooks: GameHooks = {}) {
    this.ctx = canvas.getContext('2d')!;
    requestAnimationFrame(this.frame);
  }

  load(g: Grid) {
    this.g = g;
    this.restart();
    this.resize();
  }

  restart() {
    this.a = this.g.a;
    this.b = this.g.b;
    this.moves = [];
    this.done = this.dead = false;
    this.queue = [];
    this.playing = false;
    const now = performance.now();
    this.animA = { from: this.xy(this.a), to: this.xy(this.a), t0: now - 1000 };
    this.animB = { from: this.xy(this.b), to: this.xy(this.b), t0: now - 1000 };
    this.hooks.onMove?.(this.moves);
  }

  /** Replays a move list from the start, animated, for watching a stored solution. */
  playback(moves: number[]) {
    this.restart();
    this.playing = true;
    this.queue = [...moves];
  }

  undo() {
    if (this.playing || !this.moves.length) return;
    const rest = this.moves.slice(0, -1);
    this.restart();
    for (const d of rest) this.step(d, false);
    this.hooks.onMove?.(this.moves);
  }

  input(dir: number) {
    if (this.playing || this.done || this.dead) return;
    this.step(dir, true);
  }

  private step(dir: number, animate: boolean) {
    const r = applyMove(this.g, this.a, this.b, dir);
    const now = animate ? performance.now() : -1e9;
    // start from where each twin is drawn right now, so fast input never snaps
    const fromA = animate ? this.drawnPos(this.animA, now) : this.xy(this.a);
    const fromB = animate ? this.drawnPos(this.animB, now) : this.xy(this.b);
    this.animA = { from: fromA, to: this.xy(r.a), t0: now, bump: r.a === this.a ? dir : undefined };
    this.animB = { from: fromB, to: this.xy(r.b), t0: now, bump: r.b === this.b ? mirror(dir) : undefined };
    if (animate) {
      if (r.a !== this.a) this.dust(this.a, COLORS.a);
      if (r.b !== this.b) this.dust(this.b, COLORS.b);
      if (r.a === this.a || r.b === this.b) this.trauma = Math.min(1, this.trauma + 0.12);
    }
    this.a = r.a;
    this.b = r.b;
    this.moves.push(dir);
    if (animate && r.blocked) this.hooks.onBlocked?.();
    if (fell(this.g, this.a, this.b)) {
      this.dead = true;
      this.fellAt = now;
      if (animate) this.trauma = Math.min(1, this.trauma + 0.4);
      if (animate) this.hooks.onFell?.();
    } else if (solved(this.g, this.a, this.b)) {
      this.done = true;
      this.solvedAt = now;
      if (animate) {
        this.burst(this.a, COLORS.a);
        this.burst(this.b, COLORS.b);
      }
      if (animate) this.hooks.onSolved?.([...this.moves]);
    }
    if (animate) this.hooks.onMove?.(this.moves);
  }

  private drawnPos(an: Anim, now: number): [number, number] {
    const t = Math.min(1, (now - an.t0) / 130);
    return [an.from[0] + (an.to[0] - an.from[0]) * ease(t), an.from[1] + (an.to[1] - an.from[1]) * ease(t)];
  }

  private spawn(i: number, color: string, n: number, speed: number, life: number, size: number) {
    const [x, y] = this.xy(i);
    for (let k = 0; k < n; k++) {
      const ang = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: life, max: life, color, size: size * (0.6 + Math.random() * 0.6) });
    }
  }
  private dust = (i: number, color: string) => this.spawn(i, color, 4, 1.2, 260, 0.06);
  private burst = (i: number, color: string) => this.spawn(i, color, 18, 3.2, 650, 0.09);

  private xy(i: number): [number, number] {
    return [i % this.g.w, Math.floor(i / this.g.w)];
  }

  resize() {
    const box = this.canvas.parentElement!.getBoundingClientRect();
    const fit = Math.floor(Math.min((box.width - 32) / this.g.w, (box.height - 32) / this.g.h, 88));
    this.cell = Math.max(32, fit);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${this.cell * this.g.w}px`;
    this.canvas.style.height = `${this.cell * this.g.h}px`;
    this.canvas.width = this.cell * this.g.w * dpr;
    this.canvas.height = this.cell * this.g.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    if (!this.g) return;
    const dt = Math.min(50, now - (this.lastFrame || now));
    this.lastFrame = now;
    this.trauma = Math.max(0, this.trauma - dt / 600);
    for (const p of this.particles) {
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.playing && this.queue.length && now - this.animA.t0 > 190) {
      this.step(this.queue.shift()!, true);
      if (!this.queue.length) this.playing = false;
    }
    this.draw(now);
  };

  private draw(now: number) {
    const { ctx, cell: c, g } = this;
    ctx.clearRect(0, 0, g.w * c, g.h * c);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sh = reduce ? 0 : this.trauma * this.trauma * c * 0.08;
    ctx.save();
    ctx.translate(Math.sin(now / 23) * sh, Math.sin(now / 31) * sh);
    for (let i = 0; i < g.w * g.h; i++) {
      const x = (i % g.w) * c, y = Math.floor(i / g.w) * c;
      const k = g.cells[i];
      if (k === WALL) {
        ctx.fillStyle = COLORS.wall;
        roundRect(ctx, x + 2, y + 2, c - 4, c - 4, c * 0.14);
        continue;
      }
      ctx.fillStyle = COLORS.floor;
      roundRect(ctx, x + 2, y + 2, c - 4, c - 4, c * 0.14);
      if (k === PIT) {
        ctx.fillStyle = COLORS.pit;
        ctx.beginPath();
        ctx.ellipse(x + c / 2, y + c / 2, c * 0.32, c * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (k === PAD_A || k === PAD_B) {
        const won = this.done ? Math.max(0, 1 - (now - this.solvedAt) / 600) : 0;
        ctx.strokeStyle = k === PAD_A ? COLORS.a : COLORS.b;
        ctx.fillStyle = k === PAD_A ? COLORS.aSoft : COLORS.bSoft;
        ctx.lineWidth = Math.max(2, c * 0.05);
        ctx.beginPath();
        ctx.arc(x + c / 2, y + c / 2, c * (0.3 + won * 0.12), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    this.drawTwin(this.animA, COLORS.a, now, false);
    this.drawTwin(this.animB, COLORS.b, now, true);
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * c, p.y * c, p.size * c, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawTwin(an: Anim, color: string, now: number, flip: boolean) {
    const { ctx, cell: c } = this;
    const t = Math.min(1, (now - an.t0) / 130);
    let [px, py] = this.drawnPos(an, now);
    if (an.bump !== undefined && t < 1) {
      const k = Math.sin(t * Math.PI) * 0.14;
      px += DIR_VEC[an.bump][0] * k;
      py += DIR_VEC[an.bump][1] * k;
    }
    // squash along the move, stretch across it
    const moving = t < 1 && an.bump === undefined && (an.from[0] !== an.to[0] || an.from[1] !== an.to[1]);
    const s = moving ? Math.sin(t * Math.PI) * 0.12 : 0;
    const horiz = an.from[1] === an.to[1];
    let sx = 1 + (horiz ? s : -s), sy = 1 + (horiz ? -s : s);
    let alpha = 1;
    if (this.dead) {
      const k = Math.min(1, (now - this.fellAt) / 420);
      const inPit = this.g.cells[an.to[1] * this.g.w + an.to[0]] === PIT;
      if (inPit) { sx *= 1 - k; sy *= 1 - k; alpha = 1 - k * 0.6; }
    }
    if (this.done) {
      const k = (now - this.solvedAt) / 500;
      if (k < 1) py -= Math.sin(k * Math.PI) * 0.18;
    }
    const size = c * 0.62;
    const cx = px * c + c / 2, cy = py * c + c / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(sx, sy);
    ctx.fillStyle = color;
    roundRect(ctx, -size / 2, -size / 2, size, size, size * 0.3);
    // eyes look where the twin last moved; B's look is mirrored
    const look = an.bump ?? (an.to[0] > an.from[0] ? 3 : an.to[0] < an.from[0] ? 2 : an.to[1] > an.from[1] ? 1 : an.to[1] < an.from[1] ? 0 : flip ? 2 : 3);
    const ex = DIR_VEC[look][0] * size * 0.08, ey = DIR_VEC[look][1] * size * 0.08;
    ctx.fillStyle = '#ffffff';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * size * 0.18 + ex, -size * 0.06 + ey, size * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
