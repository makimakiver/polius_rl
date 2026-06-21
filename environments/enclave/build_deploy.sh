#!/usr/bin/env bash
# Build → push → repin → ensure-USDC-spendable → deploy the Polius attestation
# enclave on Marlin Oyster.
#
# Prereqs: docker (buildx for arm64), a registry login, the `oyster-cvm` CLI, and a
# wallet with SUI + USDC. Put the wallet key in an UNTRACKED .deploy.env:
#   echo 'PRIVATE_KEY=suiprivkey1...' > environments/enclave/.deploy.env
#
# Step 2b auto-withdraws any USDC sitting in the wallet's Sui *address balance*
# (accumulator) into a spendable Coin first — otherwise oyster can't pay even when
# the balance looks funded. PRIVATE_KEY must control the USDC-holding address.
#
# NOTE: the withdraw (step 2b) and the final `oyster-cvm deploy` (step 3) both spend
# real funds — run this yourself; an agent/CI cannot authorize it.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE_REPO="${IMAGE_REPO:-albeit3405/pollius}"
IMAGE_TAG="${IMAGE_TAG:-polius-enclave-arm64}"
COMPOSE_FILE="./docker-compose.yml"
DURATION_MIN="${DURATION_MIN:-1200}"   # 1200 = 20h (default demo lifetime)

[ -f .deploy.env ] && set -a && . ./.deploy.env && set +a
: "${PRIVATE_KEY:?PRIVATE_KEY not set — add it to environments/enclave/.deploy.env}"

# 1. build for the enclave host arch (Oyster Nitro is arm64) and push
docker build --platform linux/arm64 -t "${IMAGE_REPO}:${IMAGE_TAG}" .
docker push "${IMAGE_REPO}:${IMAGE_TAG}"

# 2. pin the pushed digest into the compose we actually deploy ('#' delim: digest has '@')
DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "${IMAGE_REPO}:${IMAGE_TAG}")
sed -i '' "s#^[[:space:]]*image:.*#    image: ${DIGEST}#" "${COMPOSE_FILE}"
echo "pinned ${COMPOSE_FILE} -> ${DIGEST}"

# 2b. Ensure USDC is SPENDABLE before paying. oyster-cvm pays in USDC, but funds
#     received into the Sui *address balance* (accumulator) are NOT spendable Coin
#     objects until withdrawn — so a wallet can show a big USDC balance yet fail to
#     pay. This redeems any address-balance USDC into a Coin (no-op if there's none).
#     Uses @mysten/sui >= 2.19 (tx.withdrawal); installed once into a cache dir since
#     the repo pins 2.17. Requires PRIVATE_KEY to control the USDC-holding address.
USDC_TYPE="${USDC_TYPE:-0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC}"
SDK_DIR="${TMPDIR:-/tmp}/pollius-sdk"
WITHDRAW_TS="$(cd ../../scripts && pwd)/withdraw-address-balance.ts"
if [ -f "$WITHDRAW_TS" ]; then
  echo "→ ensuring USDC is spendable (withdraw address balance)…"
  mkdir -p "$SDK_DIR"
  [ -d "$SDK_DIR/node_modules/@mysten/sui" ] || ( cd "$SDK_DIR" && npm i --silent @mysten/sui@latest tsx )
  cp "$WITHDRAW_TS" "$SDK_DIR/withdraw.ts"
  ( cd "$SDK_DIR" && SUI_PRIVATE_KEY="${PRIVATE_KEY}" COIN_TYPE="${USDC_TYPE}" npx -y tsx withdraw.ts ) \
    || echo "  (no address-balance USDC to withdraw — continuing)"
else
  echo "  (withdraw helper not found at $WITHDRAW_TS — skipping pre-withdraw)"
fi

# 3. deploy for 20h (paid). A fresh deploy gets a NEW IP — wire it into .env.local:
#      ENCLAVE_URL=http://<NEW_IP>:3000   then restart the verifier.
oyster-cvm deploy \
  --wallet-private-key "${PRIVATE_KEY}" \
  --docker-compose "${COMPOSE_FILE}" \
  --instance-type c6g.xlarge \
  --duration-in-minutes "${DURATION_MIN}" \
  --deployment sui
