#!/usr/bin/env bash
# Build → push → repin → deploy the Polius attestation enclave on Marlin Oyster.
#
# Prereqs: docker (buildx for arm64), a registry login, the `oyster-cvm` CLI, and a
# wallet with SUI + USDC. Put the wallet key in an UNTRACKED .deploy.env:
#   echo 'PRIVATE_KEY=suiprivkey1...' > environments/enclave/.deploy.env
#
# NOTE: the final `oyster-cvm deploy` spends real USDC (~2 for 20h) and is a paid
# action — run it yourself; an agent/CI cannot authorize it.
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

# 3. deploy for 20h (paid). A fresh deploy gets a NEW IP — wire it into .env.local:
#      ENCLAVE_URL=http://<NEW_IP>:3000   then restart the verifier.
oyster-cvm deploy \
  --wallet-private-key "${PRIVATE_KEY}" \
  --docker-compose "${COMPOSE_FILE}" \
  --instance-type c6g.xlarge \
  --duration-in-minutes "${DURATION_MIN}" \
  --deployment sui
