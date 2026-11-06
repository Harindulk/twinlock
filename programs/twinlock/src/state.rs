use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Level {
    pub creator: Pubkey,
    pub id: u32,
    pub w: u8,
    pub h: u8,
    pub cells: [u8; 64],
    pub a: u8,
    pub b: u8,
    pub name: [u8; 24],
    /// Moves in the creator's proof solution.
    pub par: u8,
    pub best: u8,
    pub best_player: Pubkey,
    pub clears: u32,
    /// Packed moves of the current best solution, so anyone can watch it replay.
    pub solution: [u8; 16],
}

#[account]
#[derive(InitSpace)]
pub struct Clear {
    pub player: Pubkey,
    pub level: Pubkey,
    pub moves: u8,
    pub slot: u64,
    pub solution: [u8; 16],
}

#[account]
#[derive(InitSpace)]
pub struct Player {
    pub name: [u8; 16],
}
