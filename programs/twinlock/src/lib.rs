use anchor_lang::prelude::*;

pub mod rules;
pub mod state;

use rules::{replay, validate_level, Grid, ReplayErr};
use state::{Clear, Level, Player};

declare_id!("GeciFjoMLb14573Qw9zdjCNEW6JsYwvDWnzxwfwj8oDb");

#[error_code]
pub enum TwinlockError {
    #[msg("Level layout is invalid")]
    BadLevel,
    #[msg("These moves do not solve the level")]
    NotSolved,
    #[msg("A twin fell into a pit")]
    Fell,
    #[msg("Moves continue after the level was solved")]
    ExtraMoves,
    #[msg("More than 64 moves")]
    TooManyMoves,
}

fn check(g: &Grid, moves: &[u8; 16], n: u8) -> Result<u8> {
    replay(g, moves, n).map_err(|e| {
        match e {
            ReplayErr::NotSolved => TwinlockError::NotSolved,
            ReplayErr::Fell(step) => {
                msg!("fell on move {}", step);
                TwinlockError::Fell
            }
            ReplayErr::ExtraMoves => TwinlockError::ExtraMoves,
            ReplayErr::TooManyMoves => TwinlockError::TooManyMoves,
        }
        .into()
    })
}

#[program]
pub mod twinlock {
    use super::*;

    /// A level only exists on-chain if its creator proved it can be solved.
    #[allow(clippy::too_many_arguments)]
    pub fn publish_level(
        ctx: Context<PublishLevel>,
        id: u32,
        w: u8,
        h: u8,
        cells: [u8; 64],
        a: u8,
        b: u8,
        name: [u8; 24],
        moves: [u8; 16],
        n: u8,
    ) -> Result<()> {
        let g = Grid { w, h, cells, a, b };
        require!(validate_level(&g), TwinlockError::BadLevel);
        let par = check(&g, &moves, n)?;
        let creator = ctx.accounts.creator.key();
        ctx.accounts.level.set_inner(Level {
            creator,
            id,
            w,
            h,
            cells,
            a,
            b,
            name,
            par,
            best: par,
            best_player: creator,
            clears: 0,
            solution: moves,
        });
        Ok(())
    }

    /// Records a clear only if the program's own replay of the moves solves the level.
    pub fn submit_clear(ctx: Context<SubmitClear>, moves: [u8; 16], n: u8) -> Result<()> {
        let level = &mut ctx.accounts.level;
        let g = Grid { w: level.w, h: level.h, cells: level.cells, a: level.a, b: level.b };
        let n = check(&g, &moves, n)?;
        let clear = &mut ctx.accounts.clear;
        let player = ctx.accounts.player.key();
        if clear.moves == 0 {
            level.clears += 1;
            clear.player = player;
            clear.level = level.key();
        }
        if clear.moves == 0 || n < clear.moves {
            clear.moves = n;
            clear.solution = moves;
            clear.slot = Clock::get()?.slot;
        }
        if n < level.best {
            level.best = n;
            level.best_player = player;
            level.solution = moves;
        }
        Ok(())
    }

    pub fn set_name(ctx: Context<SetName>, name: [u8; 16]) -> Result<()> {
        ctx.accounts.player.name = name;
        Ok(())
    }
}

// The sponsor `payer` covers fees and rent so players never need SOL; the
// player's own key (`creator`/`player`/`authority`) is what the records belong to.

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct PublishLevel<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Level::INIT_SPACE,
        seeds = [b"level", creator.key().as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub level: Account<'info, Level>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitClear<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub player: Signer<'info>,
    #[account(mut)]
    pub level: Account<'info, Level>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Clear::INIT_SPACE,
        seeds = [b"clear", level.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub clear: Account<'info, Clear>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetName<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Player::INIT_SPACE,
        seeds = [b"player", authority.key().as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,
    pub system_program: Program<'info, System>,
}
