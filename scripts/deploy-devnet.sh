#!/usr/bin/env bash
# Deploys the program to devnet, funds the fee sponsor, publishes the official levels and writes the web build env.
# Needs ~3 devnet SOL on keys/deployer.keypair.json (https://faucet.solana.com).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"
RPC=${RPC:-https://api.devnet.solana.com}
DEPLOYER=keys/deployer.keypair.json
SPONSOR=keys/sponsor-devnet.keypair.json
[ -f "$SPONSOR" ] || solana-keygen new --no-bip39-passphrase -s -o "$SPONSOR" >/dev/null
PROGRAM_ID=$(solana-keygen pubkey target/deploy/twinlock-keypair.json)
echo "deployer $(solana-keygen pubkey $DEPLOYER): $(solana -u "$RPC" balance $DEPLOYER)"
anchor build >/dev/null
solana program deploy -u "$RPC" -k "$DEPLOYER" --program-id target/deploy/twinlock-keypair.json target/deploy/twinlock.so
SP_BAL=$(solana -u "$RPC" balance "$SPONSOR" | cut -d' ' -f1)
if awk "BEGIN{exit !($SP_BAL < 0.5)}"; then solana -u "$RPC" -k "$DEPLOYER" transfer --allow-unfunded-recipient "$(solana-keygen pubkey $SPONSOR)" 0.8; fi
cd web
VITE_RPC="$RPC" VITE_PROGRAM_ID="$PROGRAM_ID" npx tsx tools/publish-official.ts ../$DEPLOYER ../$SPONSOR
printf 'VITE_RPC=%s\nVITE_PROGRAM_ID=%s\nVITE_OFFICIAL_CREATOR=%s\nVITE_SPONSOR_KEY=%s\n' "$RPC" "$PROGRAM_ID" "$(solana-keygen pubkey ../$DEPLOYER)" "$(cat ../$SPONSOR)" > .env.production
echo "done: program $PROGRAM_ID; web/.env.production written (npm run build)"
