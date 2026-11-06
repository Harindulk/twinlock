import './style.css';
import { Game } from './game';
import { OFFICIAL } from './levels';
import { fromRows, unpackMoves, type Grid, FLOOR, PAD_A, PAD_B } from './rules';
import { solve } from './solver';
import * as chain from './chain';
import { sfx, muted, setMuted } from './sfx';

interface LevelEntry {
  title: string;
  grid: Grid;
  address?: string; // on-chain Level account
  par?: number;
  best?: number;
  official: boolean;
  draft?: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const KEYS: Record<string, number> = { ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3, w: 0, s: 1, a: 2, d: 3, W: 0, S: 1, A: 2, D: 3 };

await chain.init();
await chain.preloadOfficial(OFFICIAL.map((l) => l.id));

const progress: Record<string, number> = JSON.parse(localStorage.getItem('twinlock.progress') || '{}');
const official: LevelEntry[] = OFFICIAL.map((l) => ({
  title: l.title,
  grid: fromRows(l.rows),
  address: chain.officialLevelAddress(l.id),
  official: true,
}));
let community: LevelEntry[] = [];
let current: LevelEntry = official[0];

const game = new Game($('board') as HTMLCanvasElement, {
  onMove: (m) => {
    $('stat-moves').textContent = String(m.length);
    if (m.length) sfx.move(m.length);
  },
  onBlocked: () => sfx.blocked(),
  onSolved: (moves) => {
    sfx.solved();
    onSolved(moves);
  },
  onFell: () => (sfx.fell(), setReceipt('bad', 'A twin fell', `<p>Restart (R) or undo (Z). The program would reject this run too: it stops at the move a twin lands in a pit.</p>`)),
});

// ---------- level list ----------
function key(l: LevelEntry) {
  return l.address ?? l.title;
}

function renderLists() {
  const item = (l: LevelEntry, i: number) => {
    const done = progress[key(l)];
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-current', String(l === current));
    b.innerHTML = `<span class="n">${i + 1}</span><span class="t"></span><span class="s ${done ? 'done' : ''}">${done ? `${done} moves` : l.par ? `par ${l.par}` : ''}</span>`;
    b.querySelector('.t')!.textContent = l.title;
    b.onclick = () => select(l);
    li.append(b);
    return li;
  };
  $('official-list').replaceChildren(...official.map(item));
  const cl = $('community-list');
  if (community.length) cl.replaceChildren(...community.map(item));
}

function select(l: LevelEntry) {
  current = l;
  game.load(l.grid);
  $('level-name').textContent = l.title;
  $('stat-par').textContent = l.par ? String(l.par) : '–';
  $('stat-best').textContent = l.best ? String(l.best) : '–';
  setReceipt('idle', '', `<p>${l.draft ? 'Solve your level to publish it. The program checks your solution before the level exists.' : 'Solve the board. Your move list goes to the Twinlock program, which replays it move by move and only records a clear it can reproduce.'}</p>`);
  ($('btn-forge') as HTMLButtonElement).disabled = !l.address;
  renderLists();
  refreshBoard();
}

// ---------- proof receipt ----------
function setReceipt(state: 'idle' | 'pending' | 'ok' | 'bad', head: string, body: string, pill?: string) {
  const r = $('receipt');
  r.className = `receipt ${state}`;
  r.innerHTML = (head ? `<div class="head"><span>${head}</span>${pill ? `<span class="pill ${state}">${pill}</span>` : ''}</div>` : '') + body;
  if (state === 'ok' || state === 'bad') {
    r.classList.add('stamp');
    state === 'ok' ? sfx.verified() : sfx.rejected();
  }
}

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;
const txLink = (sig: string) => `<a class="mono" href="${chain.explorerTx(sig)}" target="_blank" rel="noopener">${short(sig)}</a>`;

async function onSolved(moves: number[]) {
  if (current.draft) return publishDraft(moves);
  const local = progress[key(current)];
  if (!local || moves.length < local) {
    progress[key(current)] = moves.length;
    localStorage.setItem('twinlock.progress', JSON.stringify(progress));
  }
  renderLists();
  if (!current.address) return;
  setReceipt('pending', `Solved in ${moves.length}. Sending to Solana…`, `<p class="muted">The program is replaying your ${moves.length} moves.</p>`);
  try {
    const r = await chain.submitClear(current.address, moves);
    setReceipt(
      'ok',
      `Verified on Solana`,
      `<dl><dt>Replayed</dt><dd>${moves.length} moves, solved</dd><dt>Slot</dt><dd class="mono">${r.slot}</dd><dt>Tx</dt><dd>${txLink(r.sig)}</dd></dl>${nextButton()}`,
      'recorded',
    );
    wireNext();
    ensureName().then(refreshBoard);
    refreshBoard();
  } catch (e) {
    showChainError(e, 'Not recorded');
  }
}

function nextLevel(): LevelEntry | null {
  const list = current.official ? official : community;
  const i = list.indexOf(current);
  return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
}
const nextButton = () => (nextLevel() ? `<button class="btn next" id="btn-next" type="button">Next: ${escapeHtml(nextLevel()!.title)} (N)</button>` : '');
function wireNext() {
  const b = document.getElementById('btn-next');
  if (b) b.onclick = () => select(nextLevel()!);
}

// The default name is only local until it is written once on chain.
async function ensureName() {
  if (localStorage.getItem('twinlock.nameOnChain') === nameInput.value) return;
  try {
    await chain.setName(nameInput.value.trim().slice(0, 16));
    localStorage.setItem('twinlock.nameOnChain', nameInput.value);
  } catch {
    /* cosmetic; retried after the next clear */
  }
}

function showChainError(e: unknown, head: string) {
  const err = e as chain.ChainError;
  setReceipt(
    'bad',
    head,
    `<dl>${err.code ? `<dt>Program said</dt><dd class="mono">${err.code}</dd>` : ''}${err.sig ? `<dt>Tx</dt><dd>${txLink(err.sig)}</dd>` : ''}</dl>${err.message ? `<div class="log mono">${escapeHtml(err.message)}</div>` : ''}`,
    err.code ? 'rejected' : 'offline',
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

$('btn-forge').onclick = async () => {
  if (!current.address) return;
  const forged = [current.grid.a % 4]; // any single move: it cannot reach both pads
  setReceipt('pending', 'Sending a forged 1-move clear…', `<p class="muted">The client claims a 1-move solve. The program replays it.</p>`);
  try {
    const r = await chain.submitClear(current.address, forged, { skipPreflight: true });
    setReceipt('ok', 'Accepted?', `<p>Tx ${txLink(r.sig)}</p>`);
  } catch (e) {
    showChainError(e, 'Forged clear rejected');
  }
};

// ---------- leaderboard ----------
let bestSolution: number[] | null = null;

async function refreshBoard() {
  const tbody = $('leaderboard');
  const l = current;
  if (!l.address) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">Publish to get a leaderboard</td></tr>`;
    $('btn-watch').hidden = true;
    return;
  }
  try {
    const [info, rows] = await Promise.all([chain.fetchLevel(l.address), chain.fetchClears(l.address)]);
    if (l !== current) return;
    if (info) {
      l.par = info.par;
      l.best = info.best;
      $('stat-par').textContent = String(info.par);
      $('stat-best').textContent = String(info.best);
      bestSolution = unpackMoves(info.solution, info.best);
      $('btn-watch').hidden = false;
    } else {
      $('stat-best').textContent = '–';
      $('btn-watch').hidden = true;
    }
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="muted">No clears yet. Be first.</td></tr>`;
      return;
    }
    const me = chain.playerAddress();
    tbody.replaceChildren(
      ...rows.slice(0, 10).map((r) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="${r.player === me ? 'me' : ''}"></td><td class="num">${r.moves}</td><td><a class="mono" href="${chain.explorerAddress(r.address)}" target="_blank" rel="noopener">${short(r.address)}</a></td>`;
        (tr.firstChild as HTMLElement).textContent = r.name || short(r.player);
        return tr;
      }),
    );
  } catch {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">Leaderboard unavailable (RPC busy). It retries when you pick a level.</td></tr>`;
  }
}

$('btn-watch').onclick = () => bestSolution && game.playback(bestSolution);

// ---------- input ----------
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || ($('editor') as HTMLDialogElement).open) return;
  if (e.key in KEYS) {
    e.preventDefault();
    game.input(KEYS[e.key]);
  } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') game.undo();
  else if (e.key === 'r' || e.key === 'R') game.restart();
  else if (e.key === 'm' || e.key === 'M') muteBtn.click();
  else if ((e.key === 'n' || e.key === 'N') && game.done && nextLevel()) select(nextLevel()!);
});
let touch: [number, number] | null = null;
const well = $('board-well');
well.addEventListener('pointerdown', (e) => (touch = [e.clientX, e.clientY]));
well.addEventListener('pointerup', (e) => {
  if (!touch) return;
  const dx = e.clientX - touch[0], dy = e.clientY - touch[1];
  touch = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  game.input(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 2) : dy > 0 ? 1 : 0);
});
$('btn-undo').onclick = () => game.undo();
const muteBtn = $('btn-mute');
const syncMute = () => (muteBtn.textContent = muted ? 'Sound off' : 'Sound on');
muteBtn.onclick = () => (setMuted(!muted), syncMute());
syncMute();
$('btn-restart').onclick = () => game.restart();
window.addEventListener('resize', () => game.resize());

// ---------- player name ----------
const nameInput = $('player-name') as HTMLInputElement;
nameInput.value = localStorage.getItem('twinlock.name') || `player-${chain.playerAddress().slice(0, 4)}`;
nameInput.addEventListener('change', async () => {
  const n = nameInput.value.trim().slice(0, 16);
  localStorage.setItem('twinlock.name', n);
  try {
    await chain.setName(n);
    localStorage.setItem('twinlock.nameOnChain', n);
    refreshBoard();
  } catch {
    /* name is cosmetic; the next change retries */
  }
});

// ---------- editor ----------
const dlg = $('editor') as HTMLDialogElement;
let paint = '0';
let ed = { w: 6, h: 6, cells: new Array(64).fill(FLOOR) as number[], a: 0, b: 5 };

function edRender() {
  const grid = $('ed-grid');
  grid.style.gridTemplateColumns = `repeat(${ed.w}, auto)`;
  grid.replaceChildren(
    ...Array.from({ length: ed.w * ed.h }, (_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `c${ed.cells[i]} ${i === ed.a ? 'ta' : i === ed.b ? 'tb' : ''}`;
      b.setAttribute('aria-label', `cell ${(i % ed.w) + 1},${Math.floor(i / ed.w) + 1}`);
      b.onclick = () => {
        if (paint === 'A') { ed.a = i; ed.cells[i] = FLOOR; }
        else if (paint === 'B') { ed.b = i; ed.cells[i] = FLOOR; }
        else {
          const v = Number(paint);
          if (v === PAD_A || v === PAD_B) ed.cells = ed.cells.map((c) => (c === v ? FLOOR : c));
          ed.cells[i] = v;
          if (i === ed.a || i === ed.b) ed.cells[i] = FLOOR;
        }
        edRender();
      };
      return b;
    }),
  );
  const g = edGrid();
  const s = solve(g);
  $('ed-status').textContent = !g.cells.includes(PAD_A) || !g.cells.includes(PAD_B)
    ? 'Place one teal pad and one amber pad.'
    : s ? `Solvable. Shortest solution: ${s.length} moves. Now prove it yourself.` : 'No solution exists yet. Change the walls or pits.';
}

function edGrid(): Grid {
  // re-pack the cells into the w*h layout the program expects
  return { w: ed.w, h: ed.h, cells: ed.cells.map((c, i) => (i < ed.w * ed.h ? c : FLOOR)), a: ed.a, b: ed.b };
}

function edResize() {
  const w = Math.min(8, Math.max(2, Number(($('ed-w') as HTMLInputElement).value)));
  const h = Math.min(8, Math.max(2, Number(($('ed-h') as HTMLInputElement).value)));
  const old = ed;
  const cells = new Array(64).fill(FLOOR);
  for (let y = 0; y < Math.min(h, old.h); y++) for (let x = 0; x < Math.min(w, old.w); x++) cells[y * w + x] = old.cells[y * old.w + x];
  const move = (p: number, fallback: number) => {
    const x = p % old.w, y = Math.floor(p / old.w);
    return x < w && y < h ? y * w + x : fallback;
  };
  ed = { w, h, cells, a: move(old.a, 0), b: move(old.b, w * h - 1) };
  if (ed.a === ed.b) ed.b = ed.a === 0 ? 1 : 0;
  edRender();
}

$('btn-editor').onclick = () => {
  edRender();
  dlg.showModal();
};
dlg.querySelectorAll<HTMLButtonElement>('[data-paint]').forEach((b) =>
  b.addEventListener('click', () => {
    paint = b.dataset.paint!;
    dlg.querySelectorAll('[data-paint]').forEach((x) => x.classList.toggle('sel', x === b));
  }),
);
$('ed-w').addEventListener('change', edResize);
$('ed-h').addEventListener('change', edResize);
$('ed-test').onclick = () => {
  const g = edGrid();
  if (!solve(g)) return;
  dlg.close();
  const name = ($('ed-name') as HTMLInputElement).value.trim() || 'Untitled';
  select({ title: name, grid: g, official: false, draft: true });
};

async function publishDraft(moves: number[]) {
  setReceipt('pending', 'Publishing…', `<p class="muted">The program replays your ${moves.length}-move solution before it creates the level.</p>`);
  try {
    const r = await chain.publishLevel(current.grid, current.title, moves);
    const entry: LevelEntry = { title: current.title, grid: current.grid, address: r.address, par: moves.length, best: moves.length, official: false };
    community.unshift(entry);
    setReceipt('ok', 'Level published', `<dl><dt>Proof</dt><dd>${moves.length} moves replayed</dd><dt>Level</dt><dd><a class="mono" href="${chain.explorerAddress(r.address)}" target="_blank" rel="noopener">${short(r.address)}</a></dd><dt>Tx</dt><dd>${txLink(r.sig)}</dd></dl>`, 'on chain');
    current = entry;
    renderLists();
    refreshBoard();
  } catch (e) {
    showChainError(e, 'Not published');
  }
}

// ---------- boot ----------
async function loadCommunity() {
  try {
    const all = await chain.fetchLevels();
    community = all
      .filter((l) => !chain.isOfficial(l.creator))
      .map((l) => ({ title: l.name || 'Untitled', grid: l.grid, address: l.address, par: l.par, best: l.best, official: false }));
    if (!community.length) $('community-list').innerHTML = `<li class="empty">None yet. Make the first one.</li>`;
    renderLists();
  } catch {
    $('community-list').innerHTML = `<li class="empty">Could not reach Solana devnet.</li>`;
  }
}

const programLink = $('program-link') as HTMLAnchorElement;
programLink.textContent = short(chain.PROGRAM_ID);
programLink.href = chain.explorerAddress(chain.PROGRAM_ID);
$('net-pill').textContent = chain.CLUSTER_LABEL;

select(official[0]);
loadCommunity();
