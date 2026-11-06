use twinlock::rules::{pack_moves, replay, validate_level, Grid, ReplayErr, FLOOR, PAD_A, PAD_B, PIT, WALL};

fn parse(rows: &[serde_json::Value], start_override: Option<&serde_json::Value>) -> Grid {
    let h = rows.len();
    let w = rows[0].as_str().unwrap().len();
    let mut g = Grid { w: w as u8, h: h as u8, cells: [FLOOR; 64], a: 0, b: 0 };
    for (y, row) in rows.iter().enumerate() {
        for (x, ch) in row.as_str().unwrap().chars().enumerate() {
            let i = y * w + x;
            let cell = match ch {
                '#' => WALL,
                'a' => PAD_A,
                'b' => PAD_B,
                'x' => PIT,
                'A' => { g.a = i as u8; FLOOR }
                'B' => { g.b = i as u8; FLOOR }
                _ => FLOOR,
            };
            // shortcut: grids over 64 cells are truncated here; validate_level must still reject them via w/h.
            if i < 64 { g.cells[i] = cell; }
        }
    }
    if let Some(s) = start_override {
        g.a = s[0].as_u64().unwrap() as u8;
        g.b = s[1].as_u64().unwrap() as u8;
    }
    g
}

fn moves(s: &str) -> Vec<u8> {
    s.chars().map(|c| match c { 'U' => 0, 'D' => 1, 'L' => 2, 'R' => 3, _ => panic!("bad move {c}") }).collect()
}

#[test]
fn all_fixtures_match() {
    let doc: serde_json::Value = serde_json::from_str(include_str!("../../../fixtures/levels.json")).unwrap();
    for case in doc["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let g = parse(case["rows"].as_array().unwrap(), case.get("start_override"));
        let mv = moves(case["moves"].as_str().unwrap());
        let expect = &case["expect"];
        if expect == "bad_level" {
            assert!(!validate_level(&g), "{name}: level should be rejected");
            continue;
        }
        assert!(validate_level(&g), "{name}: level should be valid");
        let got = if mv.len() > 64 {
            Err(ReplayErr::TooManyMoves)
        } else {
            replay(&g, &pack_moves(&mv), mv.len() as u8)
        };
        let want = if let Some(n) = expect.get("solved") {
            Ok(n.as_u64().unwrap() as u8)
        } else if let Some(s) = expect.get("fell") {
            Err(ReplayErr::Fell(s.as_u64().unwrap() as u8))
        } else {
            match expect.as_str().unwrap() {
                "not_solved" => Err(ReplayErr::NotSolved),
                "extra_moves" => Err(ReplayErr::ExtraMoves),
                "too_many_moves" => Err(ReplayErr::TooManyMoves),
                other => panic!("unknown expect {other}"),
            }
        };
        assert_eq!(got, want, "{name}");
    }
}

#[test]
fn move_count_over_64_is_rejected() {
    let g = Grid { w: 2, h: 1, cells: [PAD_A, PAD_B, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], a: 0, b: 1 };
    assert_eq!(replay(&g, &[0u8; 16], 65), Err(ReplayErr::TooManyMoves));
}

#[test]
fn bits_past_move_count_are_ignored() {
    let g = parse(&[serde_json::json!("aA.Bb")], None);
    let mut packed = pack_moves(&moves("L"));
    packed[0] |= 0b1111_1100; // garbage in moves 2-4
    packed[15] = 0xff;
    assert_eq!(replay(&g, &packed, 1), Ok(1));
}
