export const TICK_HZ = 9;
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export const BEANS = [
  { name: "Lima", color: "#b8e04a" },
  { name: "Coffee", color: "#c8875a" },
  { name: "Navy", color: "#4c7bff" },
  { name: "Kidney", color: "#ff4d4d" },
  { name: "Pinto", color: "#f0c14e" },
  { name: "Jelly", color: "#ff5fd2" },
  { name: "Mung", color: "#2ee59a" },
  { name: "Black", color: "#e8e8e8" },
];

const WALL = 255;
const BLAST = 3;
const WIN_BONUS = 100;
const WALL_BONUS = 25;
const POINT_PER_SEC = 10;

export type Skill = "novice" | "expert";
export type Phase = "countdown" | "play" | "round-end" | "match-end";

export type Rider = {
  id: number;
  name: string;
  human: boolean;
  skill: Skill;
  x: number;
  y: number;
  dir: number;
  alive: boolean;
  score: number;
  roundScore: number;
  survived: number;
  turns: number[];
  aim: number | null;
  wallBonus: boolean;
};

export type StepEvent =
  | { t: "death"; id: number; x: number; y: number }
  | { t: "wall" }
  | { t: "bonus"; id: number }
  | { t: "round"; winner: number | null }
  | { t: "match"; winner: number | null };

export type Sim = {
  cols: number;
  rows: number;
  grid: Uint8Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  riders: Rider[];
  tick: number;
  round: number;
  rounds: number;
  phase: Phase;
  wallAt: number;
  wallEvery: number;
  winner: number | null;
  matchWinner: number | null;
  demo: boolean;
  rng: () => number;
};

export function chooseGrid(w: number, h: number): { cols: number; rows: number } {
  const cell = Math.max(8, Math.min(15, Math.round(Math.min(w, h) / 26)));
  let cols = clamp(Math.round(w / cell), 16, 84);
  let rows = clamp(Math.round(h / cell), 18, 96);
  if (cols % 2) cols -= 1;
  if (rows % 2) rows -= 1;
  return { cols: Math.max(16, cols), rows: Math.max(18, rows) };
}

export function createMatch(opts: {
  cols: number;
  rows: number;
  players: { id: number; name: string }[];
  skill: Skill;
  rounds: number;
  demo?: boolean;
  rng?: () => number;
}): Sim {
  const riders: Rider[] = [];
  for (const p of opts.players.slice(0, 8)) {
    riders.push({
      id: p.id,
      name: p.name,
      human: true,
      skill: opts.skill,
      x: 0,
      y: 0,
      dir: 0,
      alive: true,
      score: 0,
      roundScore: 0,
      survived: 0,
      turns: [],
      aim: null,
      wallBonus: false,
    });
  }
  const sim: Sim = {
    cols: opts.cols,
    rows: opts.rows,
    grid: new Uint8Array(opts.cols * opts.rows),
    minX: 0,
    minY: 0,
    maxX: opts.cols - 1,
    maxY: opts.rows - 1,
    riders,
    tick: 0,
    round: 1,
    rounds: Math.max(1, opts.rounds),
    phase: "countdown",
    wallAt: 8 * TICK_HZ,
    wallEvery: 16,
    winner: null,
    matchWinner: null,
    demo: Boolean(opts.demo),
    rng: opts.rng ?? Math.random,
  };
  resetRound(sim);
  return sim;
}

export function resetRound(sim: Sim) {
  sim.grid.fill(0);
  sim.minX = 0;
  sim.minY = 0;
  sim.maxX = sim.cols - 1;
  sim.maxY = sim.rows - 1;
  sim.tick = 0;
  sim.winner = null;
  const spots = spawnSpots(sim.cols, sim.rows);
  for (let i = 0; i < sim.riders.length; i++) {
    const r = sim.riders[i]!;
    const s = spots[i]!;
    r.x = s.x;
    r.y = s.y;
    r.dir = s.dir;
    r.alive = true;
    r.roundScore = 0;
    r.survived = 0;
    r.turns = [];
    r.aim = null;
    r.wallBonus = false;
    sim.grid[r.y * sim.cols + r.x] = r.id;
  }
}

export function pushTurn(sim: Sim, id: number, delta: -1 | 1) {
  const r = sim.riders.find((x) => x.id === id);
  if (!r?.human || !r.alive) return;
  if (r.turns.length >= 2) return;
  r.turns.push(delta);
  r.aim = null;
}

export function aimHuman(sim: Sim, id: number, dir: number) {
  const r = sim.riders.find((x) => x.id === id);
  if (!r?.human || !r.alive) return;
  if (dir < 0 || dir > 3) return;
  if ((dir + 2) % 4 === r.dir && r.turns.length === 0) return;
  r.aim = dir;
  r.turns = [];
}

export function step(sim: Sim): StepEvent[] {
  if (sim.phase !== "play") return [];
  const events: StepEvent[] = [];
  sim.tick += 1;

  if (sim.tick % TICK_HZ === 0) {
    for (const r of sim.riders) {
      if (!r.alive) continue;
      r.score += POINT_PER_SEC;
      r.roundScore += POINT_PER_SEC;
    }
  }

  if (sim.tick >= sim.wallAt && (sim.tick - sim.wallAt) % sim.wallEvery === 0) {
    if (shrink(sim, events)) events.push({ t: "wall" });
    if (maybeFinish(sim)) {
      finishRound(sim, events);
      return events;
    }
  }

  for (const r of sim.riders) {
    if (!r.alive) continue;
    if (r.human) applyHuman(r);
    else r.dir = decide(sim, r);
  }

  for (const r of sim.riders) {
    if (!r.alive) continue;
    sim.grid[r.y * sim.cols + r.x] = r.id;
  }

  type Intent = { r: Rider; nx: number; ny: number };
  const intents: Intent[] = [];
  for (const r of sim.riders) {
    if (!r.alive) continue;
    intents.push({ r, nx: r.x + DX[r.dir]!, ny: r.y + DY[r.dir]! });
  }

  const dead = new Set<number>();
  const crash = new Map<number, { x: number; y: number }>();
  const claim = new Map<number, number[]>();

  for (const intent of intents) {
    const { r, nx, ny } = intent;
    if (nx < sim.minX || ny < sim.minY || nx > sim.maxX || ny > sim.maxY || cell(sim, nx, ny) !== 0) {
      dead.add(r.id);
      const inside = nx >= 0 && ny >= 0 && nx < sim.cols && ny < sim.rows;
      crash.set(r.id, inside ? { x: nx, y: ny } : { x: r.x, y: r.y });
      continue;
    }
    const key = ny * sim.cols + nx;
    const list = claim.get(key);
    if (list) list.push(r.id);
    else claim.set(key, [r.id]);
  }

  for (const [key, ids] of claim) {
    if (ids.length < 2) continue;
    const x = key % sim.cols;
    const y = (key - x) / sim.cols;
    for (const id of ids) {
      dead.add(id);
      crash.set(id, { x, y });
    }
  }

  for (const intent of intents) {
    const { r, nx, ny } = intent;
    if (dead.has(r.id)) {
      r.alive = false;
      const at = crash.get(r.id) ?? { x: r.x, y: r.y };
      blast(sim, at.x, at.y);
      events.push({ t: "death", id: r.id, x: at.x, y: at.y });
    } else {
      r.x = nx;
      r.y = ny;
      r.survived += 1;
    }
  }

  if (maybeFinish(sim)) finishRound(sim, events);
  return events;
}

export function occupied(sim: Sim, x: number, y: number): boolean {
  if (x < sim.minX || y < sim.minY || x > sim.maxX || y > sim.maxY) return true;
  if (cell(sim, x, y) !== 0) return true;
  for (const r of sim.riders) {
    if (r.alive && r.x === x && r.y === y) return true;
  }
  return false;
}

export function formatTime(tick: number): string {
  const s = Math.floor(tick / TICK_HZ);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function finishRound(sim: Sim, events: StepEvent[]) {
  const alive = sim.riders.filter((r) => r.alive);
  if (alive.length === 1) {
    const w = alive[0]!;
    w.score += WIN_BONUS;
    w.roundScore += WIN_BONUS;
    sim.winner = w.id;
  } else {
    sim.winner = null;
  }
  if (sim.round >= sim.rounds) {
    sim.phase = "match-end";
    let best = -1;
    let id: number | null = null;
    let tie = false;
    for (const r of sim.riders) {
      if (r.score > best) {
        best = r.score;
        id = r.id;
        tie = false;
      } else if (r.score === best) tie = true;
    }
    sim.matchWinner = tie ? null : id;
    events.push({ t: "match", winner: sim.matchWinner });
  } else {
    sim.phase = "round-end";
    events.push({ t: "round", winner: sim.winner });
  }
}

function shrink(sim: Sim, events: StepEvent[]): boolean {
  const width = sim.maxX - sim.minX + 1;
  const height = sim.maxY - sim.minY + 1;
  if (width <= 11 || height <= 15) return false;
  for (let x = sim.minX; x <= sim.maxX; x++) {
    sim.grid[sim.minY * sim.cols + x] = WALL;
    sim.grid[sim.maxY * sim.cols + x] = WALL;
  }
  for (let y = sim.minY; y <= sim.maxY; y++) {
    sim.grid[y * sim.cols + sim.minX] = WALL;
    sim.grid[y * sim.cols + sim.maxX] = WALL;
  }
  sim.minX += 1;
  sim.minY += 1;
  sim.maxX -= 1;
  sim.maxY -= 1;
  if (sim.tick === sim.wallAt) {
    for (const r of sim.riders) {
      if (!r.alive || r.wallBonus) continue;
      r.wallBonus = true;
      r.score += WALL_BONUS;
      r.roundScore += WALL_BONUS;
      events.push({ t: "bonus", id: r.id });
    }
  }
  for (const r of sim.riders) {
    if (!r.alive) continue;
    if (r.x < sim.minX || r.x > sim.maxX || r.y < sim.minY || r.y > sim.maxY) {
      r.alive = false;
      blast(sim, r.x, r.y);
      events.push({ t: "death", id: r.id, x: r.x, y: r.y });
    }
  }
  return true;
}

function applyHuman(r: Rider) {
  if (r.turns.length) {
    const d = r.turns.shift()!;
    r.dir = (r.dir + d + 4) % 4;
    r.aim = null;
    return;
  }
  if (r.aim === null) return;
  if (r.aim !== (r.dir + 2) % 4) r.dir = r.aim;
  r.aim = null;
}

function decide(sim: Sim, rider: Rider): number {
  if (rider.skill === "novice" && sim.tick % 3 !== 0) {
    const nx = rider.x + DX[rider.dir]!;
    const ny = rider.y + DY[rider.dir]!;
    if (!occupied(sim, nx, ny)) return rider.dir;
  }
  const options = [0, 1, 2, 3].filter((d) => d !== (rider.dir + 2) % 4);
  let best = rider.dir;
  let bestScore = -1e9;
  for (const d of options) {
    const nx = rider.x + DX[d]!;
    const ny = rider.y + DY[d]!;
    let score: number;
    if (occupied(sim, nx, ny)) score = -100000;
    else {
      const space = flood(sim, nx, ny, rider.skill === "expert" ? 420 : 70);
      const ray = openRay(sim, nx, ny, d);
      score = space + ray * 4;
      if (d === rider.dir) score += rider.skill === "expert" ? 10 : 24;
      score += sim.rng() * (rider.skill === "expert" ? 12 : 55);
    }
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  if (rider.skill === "novice" && sim.rng() < 0.1) {
    const risky = options.find((d) => d !== best && !occupied(sim, rider.x + DX[d]!, rider.y + DY[d]!));
    if (risky !== undefined) return risky;
  }
  return best;
}

let seen = new Uint8Array(0);
const stack: number[] = [];

function flood(sim: Sim, sx: number, sy: number, limit: number): number {
  const n = sim.cols * sim.rows;
  if (seen.length < n) seen = new Uint8Array(n);
  else seen.fill(0);
  stack.length = 0;
  const start = sy * sim.cols + sx;
  seen[start] = 1;
  stack.push(start);
  let count = 0;
  while (stack.length && count < limit) {
    const i = stack.pop()!;
    count += 1;
    const x = i % sim.cols;
    const y = (i - x) / sim.cols;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (occupied(sim, nx, ny)) continue;
      const ni = ny * sim.cols + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return count;
}

function openRay(sim: Sim, x: number, y: number, dir: number): number {
  let n = 0;
  let cx = x;
  let cy = y;
  while (n < 48 && !occupied(sim, cx, cy)) {
    n += 1;
    cx += DX[dir]!;
    cy += DY[dir]!;
  }
  return n;
}

function blast(sim: Sim, x: number, y: number) {
  for (let dy = -BLAST; dy <= BLAST; dy++) {
    for (let dx = -BLAST; dx <= BLAST; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > BLAST) continue;
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= sim.cols || yy >= sim.rows) continue;
      const i = yy * sim.cols + xx;
      const v = sim.grid[i]!;
      if (v !== 0 && v !== WALL) sim.grid[i] = 0;
    }
  }
}

function spawnSpots(cols: number, rows: number) {
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  const qx = Math.floor(cols / 4);
  const qy = Math.floor(rows / 4);
  return [
    { x: cx, y: rows - 4, dir: 0 },
    { x: cx, y: 3, dir: 2 },
    { x: 3, y: cy, dir: 1 },
    { x: cols - 4, y: cy, dir: 3 },
    { x: qx, y: rows - 4, dir: 0 },
    { x: cols - 1 - qx, y: 3, dir: 2 },
    { x: 3, y: qy, dir: 1 },
    { x: cols - 4, y: rows - 1 - qy, dir: 3 },
  ];
}

function maybeFinish(sim: Sim): boolean {
  const alive = aliveCount(sim);
  if (sim.riders.length <= 1) return alive === 0;
  return alive <= 1;
}

function aliveCount(sim: Sim): number {
  let n = 0;
  for (const r of sim.riders) if (r.alive) n += 1;
  return n;
}

function cell(sim: Sim, x: number, y: number): number {
  return sim.grid[y * sim.cols + x] ?? WALL;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
