use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    twinlock::{
        rules::{pack_moves, FLOOR, PAD_A, PAD_B, PIT},
        state::{Clear, Level, Player},
    },
};

// Level "a.A#B..b" (1 row): solved by LLL in 3 moves; L then LLL is 4 moves.
fn level_cells() -> [u8; 64] {
    let mut c = [FLOOR; 64];
    c[0] = PAD_A;
    c[3] = 1; // wall
    c[7] = PAD_B;
    c
}

struct Env {
    svm: LiteSVM,
    sponsor: Keypair,
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/twinlock.so"));
        svm.add_program(twinlock::id(), bytes).unwrap();
        let sponsor = Keypair::new();
        svm.airdrop(&sponsor.pubkey(), 10_000_000_000).unwrap();
        Env { svm, sponsor }
    }

    fn send(&mut self, ix: Instruction, signer: &Keypair) -> Result<(), String> {
        self.svm.expire_blockhash();
        let bh = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&self.sponsor.pubkey()), &bh);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&self.sponsor, signer]).unwrap();
        self.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.meta.logs))
    }

    fn level_pda(creator: &Pubkey, id: u32) -> Pubkey {
        Pubkey::find_program_address(&[b"level", creator.as_ref(), &id.to_le_bytes()], &twinlock::id()).0
    }

    fn clear_pda(level: &Pubkey, player: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[b"clear", level.as_ref(), player.as_ref()], &twinlock::id()).0
    }

    fn publish(&mut self, creator: &Keypair, id: u32, cells: [u8; 64], moves: &[u8]) -> Result<Pubkey, String> {
        let level = Self::level_pda(&creator.pubkey(), id);
        let ix = Instruction::new_with_bytes(
            twinlock::id(),
            &twinlock::instruction::PublishLevel {
                id,
                w: 8,
                h: 1,
                cells,
                a: 2,
                b: 4,
                name: *b"Edge stall              ",
                moves: pack_moves(moves),
                n: moves.len() as u8,
            }
            .data(),
            twinlock::accounts::PublishLevel {
                payer: self.sponsor.pubkey(),
                creator: creator.pubkey(),
                level,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(ix, creator).map(|_| level)
    }

    fn clear(&mut self, player: &Keypair, level: Pubkey, moves: &[u8]) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            twinlock::id(),
            &twinlock::instruction::SubmitClear { moves: pack_moves(moves), n: moves.len() as u8 }.data(),
            twinlock::accounts::SubmitClear {
                payer: self.sponsor.pubkey(),
                player: player.pubkey(),
                level,
                clear: Self::clear_pda(&level, &player.pubkey()),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(ix, player)
    }

    fn get<T: AccountDeserialize>(&self, key: &Pubkey) -> T {
        let acc = self.svm.get_account(key).unwrap();
        T::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }
}

const L: u8 = 2;

#[test]
fn publish_with_valid_solution_creates_level() {
    let mut env = Env::new();
    let creator = Keypair::new();
    let level = env.publish(&creator, 7, level_cells(), &[L, L, L]).unwrap();
    let l: Level = env.get(&level);
    assert_eq!((l.creator, l.id, l.w, l.h, l.a, l.b), (creator.pubkey(), 7, 8, 1, 2, 4));
    assert_eq!(l.cells, level_cells());
    assert_eq!((l.par, l.best, l.best_player, l.clears), (3, 3, creator.pubkey(), 0));
}

#[test]
fn publish_rejects_unsolved_level() {
    let mut env = Env::new();
    let creator = Keypair::new();
    let err = env.publish(&creator, 1, level_cells(), &[L, L]).unwrap_err();
    assert!(err.contains("NotSolved"), "{err}");
}

#[test]
fn publish_rejects_bad_level() {
    let mut env = Env::new();
    let creator = Keypair::new();
    let mut cells = level_cells();
    cells[7] = FLOOR; // no pad B
    let err = env.publish(&creator, 1, cells, &[L, L, L]).unwrap_err();
    assert!(err.contains("BadLevel"), "{err}");
}

#[test]
fn clear_records_moves_and_counts() {
    let mut env = Env::new();
    let (creator, player) = (Keypair::new(), Keypair::new());
    let level = env.publish(&creator, 1, level_cells(), &[L, L, L]).unwrap();
    env.clear(&player, level, &[L, L, L]).unwrap();
    let c: Clear = env.get(&Env::clear_pda(&level, &player.pubkey()));
    assert_eq!((c.player, c.level, c.moves), (player.pubkey(), level, 3));
    let l: Level = env.get(&level);
    assert_eq!(l.clears, 1);
}

#[test]
fn forged_short_clear_is_rejected() {
    let mut env = Env::new();
    let (creator, cheater) = (Keypair::new(), Keypair::new());
    let level = env.publish(&creator, 1, level_cells(), &[L, L, L]).unwrap();
    let err = env.clear(&cheater, level, &[L]).unwrap_err();
    assert!(err.contains("NotSolved"), "{err}");
    assert!(env.svm.get_account(&Env::clear_pda(&level, &cheater.pubkey())).is_none());
}

#[test]
fn falling_into_a_pit_is_rejected() {
    let mut env = Env::new();
    let creator = Keypair::new();
    let mut cells = level_cells();
    cells[1] = PIT; // A falls on its first L
    let err = env.publish(&creator, 1, cells, &[L, L, L]).unwrap_err();
    assert!(err.contains("Fell"), "{err}");
}

#[test]
fn worse_clear_keeps_best_and_does_not_recount() {
    let mut env = Env::new();
    let (creator, player) = (Keypair::new(), Keypair::new());
    // open 3x3 room: many solutions of different lengths
    let mut cells = [FLOOR; 64];
    cells[6] = PAD_A; // (0,2)
    cells[8] = PAD_B; // (2,2)
    let level = Env::level_pda(&creator.pubkey(), 9);
    let ix = Instruction::new_with_bytes(
        twinlock::id(),
        &twinlock::instruction::PublishLevel {
            id: 9, w: 3, h: 3, cells, a: 0, b: 2, name: [b' '; 24], moves: pack_moves(&[1, 1]), n: 2,
        }
        .data(),
        twinlock::accounts::PublishLevel {
            payer: env.sponsor.pubkey(), creator: creator.pubkey(), level, system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    env.send(ix, &creator).unwrap();
    env.clear(&player, level, &[1, 0, 1, 1]).unwrap(); // down, up, down, down = 4
    env.clear(&player, level, &[1, 1]).unwrap(); // 2
    env.clear(&player, level, &[1, 0, 1, 0, 1, 1]).unwrap(); // 6, worse
    let c: Clear = env.get(&Env::clear_pda(&level, &player.pubkey()));
    assert_eq!(c.moves, 2);
    assert_eq!(c.solution, pack_moves(&[1, 1]));
    let l: Level = env.get(&level);
    assert_eq!((l.clears, l.best), (1, 2));
}

#[test]
fn set_name_stores_player_name() {
    let mut env = Env::new();
    let player = Keypair::new();
    let pda = Pubkey::find_program_address(&[b"player", player.pubkey().as_ref()], &twinlock::id()).0;
    for name in [*b"first           ", *b"harindu         "] {
        let ix = Instruction::new_with_bytes(
            twinlock::id(),
            &twinlock::instruction::SetName { name }.data(),
            twinlock::accounts::SetName {
                payer: env.sponsor.pubkey(), authority: player.pubkey(), player: pda, system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        env.send(ix, &player).unwrap();
    }
    let p: Player = env.get(&pda);
    assert_eq!(&p.name, b"harindu         ");
}
