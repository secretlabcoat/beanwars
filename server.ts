import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "redis";
import { BEANS, TICK_HZ, createMatch, resetRound, step, pushTurn, aimHuman, type Sim } from "./sim.ts";

const PORT = Number(process.env.PORT || 10000);
const PUB = path.join(import.meta.dirname, "public");
const COLS = 40, ROWS = 56, ROUNDS = 3;

type Client = { ws: WebSocket; id: number | null; order: number; name: string };
const clients = new Set<Client>();
let order = 0;
let admin: number | null = null;
let sim: Sim | null = null;
let timer: NodeJS.Timeout | null = null;
let wait = 0; // ticks to wait (countdown / between rounds)

// ---- top 20 (wins per player name) ----
type Rec = { name: string; wins: number; games: number; bean?: number };
let scores: Record<string, Rec> = {};
const SKEY = "bw:scores";
const FILE = path.join(import.meta.dirname, "scores.json");
let kv: ReturnType<typeof createClient> | null = null;
async function loadScores() {
  try { if (fs.existsSync(FILE)) scores = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  if (process.env.REDIS_URL) {
    try {
      kv = createClient({ url: process.env.REDIS_URL });
      kv.on("error", (e) => console.log("kv error", e.message));
      await kv.connect();
      const v = await kv.get(SKEY);
      if (v) scores = JSON.parse(v);
    } catch (e: any) { console.log("kv unavailable", e.message); kv = null; }
  }
}
function saveScores() {
  const v = JSON.stringify(scores);
  try { fs.writeFileSync(FILE, v); } catch {}
  if (kv) kv.set(SKEY, v).catch(() => {});
}
function top20() {
  return Object.values(scores).sort((a, b) => b.wins - a.wins || a.games - b.games || a.name.localeCompare(b.name)).slice(0, 20);
}
function recordMatch(s: Sim) {
  for (const r of s.riders) {
    if (!r.human) continue;
    const k = r.name.toLowerCase();
    const e = (scores[k] ||= { name: r.name, wins: 0, games: 0 });
    e.name = r.name; e.games++; e.bean = r.id - 1;
    if (s.matchWinner === r.id) e.wins++;
  }
  saveScores();
  const m = JSON.stringify({ t: "top", list: top20() });
  for (const c of clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(m);
}

const server = http.createServer((req, res) => {
  let p = (req.url || "/").split("?")[0]!;
  if (p === "/") p = "/index.html";
  const f = path.join(PUB, path.normalize(p));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("Not found"); return; }
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".mp3": "audio/mpeg", ".jpg": "image/jpeg" };
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
const wss = new WebSocketServer({ server, path: "/ws" });

const send = (c: Client, m: unknown) => c.ws.readyState === WebSocket.OPEN && c.ws.send(JSON.stringify(m));
const players = () => [...clients].filter((c) => c.id !== null).sort((a, b) => a.order - b.order);

function lobby() {
  const ps = players().map((c) => ({ id: c.id, bean: c.id! - 1, name: c.name }));
  for (const c of clients) send(c, { t: "lobby", you: c.id, admin, players: ps, phase: sim ? "playing" : "lobby" });
}

function fixAdmin() {
  const ps = players();
  if (admin === null || !ps.some((c) => c.id === admin)) admin = ps[0]?.id ?? null;
}

function broadcastState() {
  if (!sim) return;
  const m = {
    t: "state", cols: sim.cols, rows: sim.rows, grid: Buffer.from(sim.grid).toString("base64"),
    minX: sim.minX, minY: sim.minY, maxX: sim.maxX, maxY: sim.maxY,
    phase: sim.phase, round: sim.round, rounds: sim.rounds, tick: sim.tick, wait: Math.ceil(wait / TICK_HZ),
    winner: sim.winner, matchWinner: sim.matchWinner,
    riders: sim.riders.map((r) => ({ id: r.id, name: r.name, x: r.x, y: r.y, dir: r.dir, alive: r.alive, score: r.score })),
  };
  const s = JSON.stringify(m);
  for (const c of clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(s);
}

function tick() {
  if (!sim) return;
  if (wait > 0) {
    wait--;
    if (wait === 0) {
      if (sim.phase === "countdown") sim.phase = "play";
      else if (sim.phase === "round-end") { sim.round++; resetRound(sim); sim.phase = "countdown"; wait = 3 * TICK_HZ; }
      else if (sim.phase === "match-end") { endMatch(); return; }
    }
  } else if (sim.phase === "play") {
    step(sim);
    if (sim.phase === "round-end") wait = 3 * TICK_HZ;
    if (sim.phase === "match-end") { wait = 6 * TICK_HZ; recordMatch(sim); }
  }
  broadcastState();
}

function startMatch() {
  const ps = players();
  if (!ps.length || sim) return;
  const list: { id: number; name: string; ai?: boolean }[] = ps.map((c) => ({ id: c.id!, name: c.name }));
  if (list.length === 1) {
    const taken = new Set(list.map((p) => p.id));
    const free = BEANS.map((_, i) => i).filter((i) => !taken.has(i + 1));
    const pick = free[Math.floor(Math.random() * free.length)] ?? 0;
    list.push({ id: pick + 1, name: "AI " + BEANS[pick]!.name, ai: true });
  }
  sim = createMatch({ cols: COLS, rows: ROWS, players: list, skill: "expert", rounds: ROUNDS });
  wait = 3 * TICK_HZ;
  timer = setInterval(tick, 1000 / TICK_HZ);
  lobby();
  broadcastState();
}

function endMatch() {
  if (timer) clearInterval(timer);
  timer = null; sim = null;
  lobby();
}

wss.on("connection", (ws) => {
  const c: Client = { ws, id: null, order: order++, name: "" };
  clients.add(c);
  send(c, { t: "top", list: top20() });
  lobby();
  ws.on("message", (raw) => {
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.t === "join" && c.id === null && !sim) {
      const b = Number(m.bean);
      if (!(b >= 0 && b < BEANS.length) || players().some((p) => p.id === b + 1)) { lobby(); return; }
      c.id = b + 1; c.order = order++;
      c.name = String(m.name || "").replace(/[<>]/g, "").trim().slice(0, 14) || BEANS[b]!.name;
      fixAdmin(); lobby();
    } else if (m.t === "leave" && c.id !== null && !sim) {
      c.id = null; fixAdmin(); lobby();
    } else if (m.t === "start" && c.id !== null && c.id === admin) startMatch();
    else if (m.t === "turn" && sim && c.id !== null && (m.d === 1 || m.d === -1)) pushTurn(sim, c.id, m.d);
    else if (m.t === "aim" && sim && c.id !== null) aimHuman(sim, c.id, Number(m.dir));
  });
  ws.on("close", () => {
    clients.delete(c);
    if (sim && c.id !== null) { const r = sim.riders.find((r) => r.id === c.id); if (r) r.alive = false; }
    fixAdmin();
    if (sim && !players().length) endMatch();
    lobby();
  });
});

setInterval(() => { for (const c of clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.ping(); }, 25000);
loadScores().then(() => server.listen(PORT, () => console.log("Beanwars on", PORT)));
