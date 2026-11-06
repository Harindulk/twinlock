#!/usr/bin/env bash
# Starts a throwaway local validator with the built program, funds a sponsor key, runs the chain e2e tests.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
mkdir -p keys
[ -f keys/sponsor.keypair.json ] || solana-keygen new --no-bip39-passphrase -s -o keys/sponsor.keypair.json >/dev/null
PROGRAM_ID=$(solana-keygen pubkey target/deploy/twinlock-keypair.json)
solana-test-validator --reset --quiet --ledger test-ledger --bpf-program "$PROGRAM_ID" target/deploy/twinlock.so >/dev/null 2>&1 &
VPID=$!
trap 'kill $VPID' EXIT
for i in $(seq 1 60); do solana -u localhost cluster-version >/dev/null 2>&1 && break; sleep 0.5; done
solana -u localhost airdrop 100 "$(solana-keygen pubkey keys/sponsor.keypair.json)" >/dev/null
cd web
VITE_RPC=http://127.0.0.1:8899 VITE_PROGRAM_ID="$PROGRAM_ID" SPONSOR_KEYPAIR=../keys/sponsor.keypair.json npx vitest run src/chain.e2e.test.ts
