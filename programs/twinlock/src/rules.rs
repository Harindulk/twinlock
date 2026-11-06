//! Twinlock rules: pure replay, no Anchor. The web client's rules.ts must match this exactly
//! (both are tested against fixtures/levels.json).

pub const FLOOR: u8 = 0;
pub const WALL: u8 = 1;
pub const PAD_A: u8 = 2;
pub const PAD_B: u8 = 3;
pub const PIT: u8 = 4;
pub const MAX_MOVES: u8 = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Grid {
    pub w: u8,
    pub h: u8,
    pub cells: [u8; 64],
    pub a: u8,
    pub b: u8,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ReplayErr {
    NotSolved,
    /// 1-based step on which a twin fell into a pit.
    Fell(u8),
    ExtraMoves,
    TooManyMoves,
}

/// Moves are 2 bits each (0 up, 1 down, 2 left, 3 right), 4 per byte, low bits first.
pub fn pack_moves(moves: &[u8]) -> [u8; 16] {
    let mut out = [0u8; 16];
    for (i, m) in moves.iter().take(MAX_MOVES as usize).enumerate() {
        out[i / 4] |= (m & 3) << ((i % 4) * 2);
    }
    out
}

pub fn validate_level(g: &Grid) -> bool {
    if !(1..=8).contains(&g.w) || !(1..=8).contains(&g.h) {
        return false;
    }
    let n = g.w as usize * g.h as usize;
    if n < 2 || g.a as usize >= n || g.b as usize >= n || g.a == g.b {
        return false;
    }
    if g.cells[g.a as usize] != FLOOR || g.cells[g.b as usize] != FLOOR {
        return false;
    }
    if g.cells[n..].iter().any(|&c| c != FLOOR) || g.cells.iter().any(|&c| c > PIT) {
        return false;
    }
    let pads_a = g.cells.iter().filter(|&&c| c == PAD_A).count();
    let pads_b = g.cells.iter().filter(|&&c| c == PAD_B).count();
    pads_a == 1 && pads_b == 1
}

fn step(g: &Grid, pos: u8, dir: u8) -> u8 {
    let (x, y) = ((pos % g.w) as i16, (pos / g.w) as i16);
    let (nx, ny) = match dir {
        0 => (x, y - 1),
        1 => (x, y + 1),
        2 => (x - 1, y),
        _ => (x + 1, y),
    };
    if nx < 0 || ny < 0 || nx >= g.w as i16 || ny >= g.h as i16 {
        return pos;
    }
    let next = (ny * g.w as i16 + nx) as u8;
    if g.cells[next as usize] == WALL { pos } else { next }
}

/// Replays `n` packed moves. Ok(n) when the last move solves the level.
pub fn replay(g: &Grid, moves: &[u8; 16], n: u8) -> Result<u8, ReplayErr> {
    if n > MAX_MOVES {
        return Err(ReplayErr::TooManyMoves);
    }
    let (mut a, mut b) = (g.a, g.b);
    for i in 0..n {
        let dir = (moves[i as usize / 4] >> ((i % 4) * 2)) & 3;
        let mirror = match dir { 2 => 3, 3 => 2, d => d };
        let (ta, tb) = (step(g, a, dir), step(g, b, mirror));
        if !(ta == tb || (ta == b && tb == a)) {
            a = ta;
            b = tb;
        }
        if g.cells[a as usize] == PIT || g.cells[b as usize] == PIT {
            return Err(ReplayErr::Fell(i + 1));
        }
        if g.cells[a as usize] == PAD_A && g.cells[b as usize] == PAD_B {
            return if i + 1 == n { Ok(n) } else { Err(ReplayErr::ExtraMoves) };
        }
    }
    Err(ReplayErr::NotSolved)
}
