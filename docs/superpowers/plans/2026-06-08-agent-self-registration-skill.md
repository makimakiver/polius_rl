# Agent Self-Registration Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent read `agent-skill/SKILL.md` and run a script to register itself against pollius_rl's own local `/api/register` (signature-verified, token-issuing), returning a link into the existing verify flow — with `role` removed end-to-end.

**Architecture:** Port `lib/protocol.ts` (canonical message) + `lib/signature.ts` (Sui signature verify) + a lean local `app/api/register/route.ts` (no SuiNS, no rate-limiting, no role) that issues a token via the existing `lib/token.ts` and returns `${origin}/agents/register/<token>`. A Node script `agent-skill/register.mjs` signs + POSTs; `agent-skill/SKILL.md` documents it. `role` is removed from the token claims and the already-built verify flow.

**Tech Stack:** Next.js 16.2.7 (modified — see `AGENTS.md`), React 19, `@mysten/sui@^2.17.0` (`/keypairs/ed25519`, `/verify`, `/transactions`, `/bcs`), `node:crypto`/HMAC. No test runner — verification is `npm run build`, `npm run lint`, `npx tsx` checks, and a dev-server walk.

---

## Why no unit tests

No test runner exists in `package.json`. Verification uses `npx tsx` round-trips for pure logic, `npm run build` (Next type-checks routes/libs), `npm run lint`, and a live local end-to-end run. Consistent with the rest of this codebase.

## File structure

- **New** `lib/protocol.ts` — `buildRegistrationMessage` + registration types (no role).
- **New** `lib/signature.ts` — `verifyAgentSignature` (personal + tx modes), depends on `protocol`.
- **New** `app/api/register/route.ts` — POST: validate → verify signature → issue token → link.
- **New** `agent-skill/register.mjs` — Node ESM signer/POSTer.
- **New** `agent-skill/SKILL.md` — agent-facing instructions.
- **Edit** `lib/token.ts`, `app/api/verify-token/route.ts`, `app/data/customAgents.ts`, `app/data/agents.ts`, `app/agents/register/RegisterAgentFlow.tsx` — remove `role` (cascade).

---

## Task 1: Remove `role` end-to-end

**Files:** Modify `lib/token.ts`, `app/api/verify-token/route.ts`, `app/data/customAgents.ts`, `app/data/agents.ts`, `app/agents/register/RegisterAgentFlow.tsx`.

Do all edits, then build+lint, then one commit (keeps every commit building).

- [ ] **Step 1: `lib/token.ts` — drop `role` from `AgentClaims`**

Replace:
```ts
export interface AgentClaims {
  agent_name: string;
  address: string;
  description: string;
  role: string;
}
```
with:
```ts
export interface AgentClaims {
  agent_name: string;
  address: string;
  description: string;
}
```

- [ ] **Step 2: `app/api/verify-token/route.ts` — drop `role` from the response**

Replace:
```ts
  return Response.json({
    verified: true,
    agent_name: claims.agent_name,
    address: b,
    description: claims.description,
    role: claims.role,
  });
```
with:
```ts
  return Response.json({
    verified: true,
    agent_name: claims.agent_name,
    address: b,
    description: claims.description,
  });
```

- [ ] **Step 3: `app/data/customAgents.ts` — drop `role` from `VerifiedClaims` and `agentFromClaims`**

Replace:
```ts
export interface VerifiedClaims {
  agent_name: string;
  address: string;
  role: string;
  description: string;
}
```
with:
```ts
export interface VerifiedClaims {
  agent_name: string;
  address: string;
  description: string;
}
```

And in `agentFromClaims`, remove the line:
```ts
    role: claims.role,
```
(leave the surrounding `name`, `model`, `description`, `owner`, `identityId`, etc. intact.)

- [ ] **Step 4: `app/data/agents.ts` — remove the optional `role` field from `Agent`**

Remove these two lines from the `Agent` interface:
```ts
  /** agent role, e.g. "trader" */
  role?: string;
```
(leave `description?`, `owner?`, `identityId?` intact.)

- [ ] **Step 5: `app/agents/register/RegisterAgentFlow.tsx` — drop `role`**

In `setClaims({...})`, remove the line:
```ts
        role: json.role,
```
In the verified-profile `<dl>`, remove the line:
```tsx
              <Row label="role" value={claims.role} />
```

- [ ] **Step 6: Build + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds with no type errors and no remaining references to `role`/`claims.role`/`json.role`. Lint: no NEW errors beyond the known pre-existing ones (`AgentCard.tsx`, `AppShell.tsx`, `wallet.tsx`, `AppNav.tsx`, and the accepted `react-hooks/set-state-in-effect` in `app/agents/page.tsx`).

- [ ] **Step 7: Commit**

```bash
git add lib/token.ts app/api/verify-token/route.ts app/data/customAgents.ts app/data/agents.ts app/agents/register/RegisterAgentFlow.tsx
git commit -m "refactor: remove role from agent registration/identity end-to-end

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `lib/protocol.ts` (canonical message)

**Files:** Create `lib/protocol.ts`.

- [ ] **Step 1: Create `lib/protocol.ts`**

```ts
// Canonical registration message shared by the agent (signer) and the server
// (verifier). Field order is part of the contract — keep it stable.

export interface AgentRegistration {
  agent_name: string;
  address: string;
  description: string;
}

export interface SignedAgentRegistration extends AgentRegistration {
  /** ISO-8601 timestamp included in the signed message (prevents reuse). */
  ts: string;
  /** Random nonce included in the signed message. */
  nonce: string;
  /** base64 string of the personal-message signature. */
  signature: string;
}

export interface CheckSubnameResponse {
  name: string;
  registrationLink: string;
}

/**
 * Build the canonical message bytes to sign for an agent registration. The
 * server reconstructs the exact same bytes from the request body and verifies
 * the signature against `address`. Field order matters — keep it stable.
 */
export function buildRegistrationMessage(input: {
  agent_name: string;
  address: string;
  description: string;
  ts: string;
  nonce: string;
}): Uint8Array {
  const canonical = JSON.stringify({
    agent_name: input.agent_name,
    address: input.address,
    description: input.description,
    ts: input.ts,
    nonce: input.nonce,
  });
  return new TextEncoder().encode(canonical);
}
```

- [ ] **Step 2: Verify the canonical message**

Run:
```bash
cd /Users/makimakiver/pollius_rl
npx --yes tsx -e "import {buildRegistrationMessage} from './lib/protocol'; const m=buildRegistrationMessage({agent_name:'a',address:'0x1',description:'d',ts:'t',nonce:'n'}); console.log('IS_BYTES', m instanceof Uint8Array); console.log('CANONICAL', new TextDecoder().decode(m)==='{\"agent_name\":\"a\",\"address\":\"0x1\",\"description\":\"d\",\"ts\":\"t\",\"nonce\":\"n\"}');"
```
Expected: `IS_BYTES true` and `CANONICAL true`.

- [ ] **Step 3: Commit**

```bash
git add lib/protocol.ts
git commit -m "feat: add agent registration canonical message (lib/protocol)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `lib/signature.ts` (Sui signature verification)

**Files:** Create `lib/signature.ts`.

- [ ] **Step 1: Create `lib/signature.ts`**

```ts
import {
  verifyPersonalMessageSignature,
  verifyTransactionSignature,
} from "@mysten/sui/verify";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { buildRegistrationMessage } from "./protocol";

export interface SignaturePayload {
  agent_name: string;
  address: string;
  description: string;
  ts: string;
  nonce: string;
  signature: string;
  /** Optional: when present, verify in transaction-wrap mode (Sui CLI path). */
  tx_bcs_b64?: string;
}

export type SignatureCheck =
  | { ok: true; mode: "personal" | "tx" }
  | { ok: false; status: 401 | 403; error: string; detail?: unknown };

/**
 * Verify a registration signature against the claimed `address`.
 *   - "personal": signature over the canonical message bytes (SDK clients).
 *   - "tx": signature over a TransactionData blob whose single Pure input holds
 *     the canonical message bytes (Sui CLI `keytool sign` path).
 */
export async function verifyAgentSignature(
  payload: SignaturePayload,
): Promise<SignatureCheck> {
  const expectedMessage = buildRegistrationMessage({
    agent_name: payload.agent_name,
    address: payload.address,
    description: payload.description,
    ts: payload.ts,
    nonce: payload.nonce,
  });

  if (payload.tx_bcs_b64) {
    return verifyTxMode(payload, expectedMessage);
  }
  return verifyPersonalMode(payload, expectedMessage);
}

async function verifyPersonalMode(
  payload: SignaturePayload,
  message: Uint8Array,
): Promise<SignatureCheck> {
  let recovered;
  try {
    recovered = await verifyPersonalMessageSignature(message, payload.signature);
  } catch (e) {
    return {
      ok: false,
      status: 401,
      error: "invalid personal-message signature",
      detail: (e as Error).message,
    };
  }
  const recoveredAddr = recovered.toSuiAddress();
  if (recoveredAddr !== payload.address) {
    return {
      ok: false,
      status: 403,
      error: "signature does not match address",
      detail: { expected: payload.address, recovered: recoveredAddr },
    };
  }
  return { ok: true, mode: "personal" };
}

async function verifyTxMode(
  payload: SignaturePayload,
  expectedMessage: Uint8Array,
): Promise<SignatureCheck> {
  const txBytes = base64ToBytes(payload.tx_bcs_b64!);

  let recovered;
  try {
    recovered = await verifyTransactionSignature(txBytes, payload.signature);
  } catch (e) {
    return {
      ok: false,
      status: 401,
      error: "invalid transaction signature",
      detail: (e as Error).message,
    };
  }
  if (recovered.toSuiAddress() !== payload.address) {
    return {
      ok: false,
      status: 403,
      error: "signature does not match address",
      detail: { expected: payload.address, recovered: recovered.toSuiAddress() },
    };
  }

  let txData;
  try {
    txData = Transaction.from(txBytes).getData();
  } catch (e) {
    return {
      ok: false,
      status: 401,
      error: "could not decode tx_bcs_b64 as TransactionData",
      detail: (e as Error).message,
    };
  }

  const pureInputs = (txData.inputs ?? []).filter(
    (i: { Pure?: { bytes?: string } | null }) => i?.Pure != null,
  );
  if (pureInputs.length !== 1) {
    return {
      ok: false,
      status: 403,
      error: `expected exactly 1 pure input, got ${pureInputs.length}`,
    };
  }

  const pureB64 = (pureInputs[0] as { Pure: { bytes: string } }).Pure.bytes;
  const pureBytes = base64ToBytes(pureB64);

  let inner: Uint8Array;
  try {
    inner = new Uint8Array(bcs.vector(bcs.u8()).parse(pureBytes));
  } catch (e) {
    return {
      ok: false,
      status: 403,
      error: "pure input is not a vector<u8>",
      detail: (e as Error).message,
    };
  }

  if (!bytesEqual(inner, expectedMessage)) {
    return {
      ok: false,
      status: 403,
      error: "embedded message does not match canonical registration message",
    };
  }

  return { ok: true, mode: "tx" };
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

- [ ] **Step 2: Build (type-checks the new lib)**

Run: `npm run build`
Expected: succeeds with no type errors. (The file isn't imported yet but `tsconfig` includes `**/*.ts`, so it is type-checked.)

- [ ] **Step 3: Commit**

```bash
git add lib/signature.ts
git commit -m "feat: add Sui agent signature verification (lib/signature)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `app/api/register/route.ts` (local register endpoint)

**Files:** Create `app/api/register/route.ts`.

- [ ] **Step 1: Create `app/api/register/route.ts`**

```ts
import { issueToken } from "@/lib/token";
import { verifyAgentSignature } from "@/lib/signature";

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;
const MAX_DESCRIPTION = 280;
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

interface RegisterBody {
  agent_name: string;
  address: string;
  description: string;
  ts: string;
  nonce: string;
  signature: string;
  tx_bcs_b64?: string;
}

function validate(
  input: unknown,
): { ok: true; body: RegisterBody } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: { _: "request body must be a JSON object" } };
  }
  const raw = input as Record<string, unknown>;

  const agent_name = typeof raw.agent_name === "string" ? raw.agent_name.trim().toLowerCase() : "";
  if (!agent_name) errors.agent_name = "required";
  else if (!LABEL_RE.test(agent_name))
    errors.agent_name = "1–63 chars, lowercase letters/digits/hyphens, no leading or trailing hyphen";

  const address = typeof raw.address === "string" ? raw.address.trim() : "";
  if (!address) errors.address = "required";
  else if (!SUI_ADDRESS_RE.test(address)) errors.address = "must be a 0x-prefixed Sui address";

  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (!description) errors.description = "required";
  else if (description.length > MAX_DESCRIPTION)
    errors.description = `must be ≤ ${MAX_DESCRIPTION} characters`;

  const ts = typeof raw.ts === "string" ? raw.ts.trim() : "";
  const parsedTs = ts ? Date.parse(ts) : NaN;
  if (!ts) errors.ts = "required (ISO-8601 timestamp included in signed message)";
  else if (Number.isNaN(parsedTs)) errors.ts = "must be an ISO-8601 timestamp";
  else if (Math.abs(Date.now() - parsedTs) > SIGNATURE_MAX_AGE_MS)
    errors.ts = `must be within ±${SIGNATURE_MAX_AGE_MS / 60_000} minutes of server time`;

  const nonce = typeof raw.nonce === "string" ? raw.nonce.trim() : "";
  if (!nonce) errors.nonce = "required (random nonce included in signed message)";
  else if (!/^[a-f0-9]{8,128}$/i.test(nonce)) errors.nonce = "must be 8–128 hex chars";

  const signature = typeof raw.signature === "string" ? raw.signature.trim() : "";
  if (!signature) errors.signature = "required (sign the canonical message with the address keypair)";

  const tx_bcs_b64 =
    typeof raw.tx_bcs_b64 === "string" && raw.tx_bcs_b64.trim() ? raw.tx_bcs_b64.trim() : undefined;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    body: { agent_name, address, description, ts, nonce, signature, tx_bcs_b64 },
  };
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = validate(raw);
  if (!result.ok) {
    return Response.json({ error: "validation failed", fields: result.errors }, { status: 400 });
  }

  const { agent_name, address, description, ts, nonce, signature, tx_bcs_b64 } = result.body;

  const sigResult = await verifyAgentSignature({
    agent_name, address, description, ts, nonce, signature, tx_bcs_b64,
  });
  if (!sigResult.ok) {
    return Response.json({ error: sigResult.error, detail: sigResult.detail }, { status: sigResult.status });
  }

  const token = issueToken({ agent_name, address, description });
  const origin = new URL(req.url).origin;
  const registrationLink = `${origin}/agents/register/${encodeURIComponent(token)}`;

  return Response.json({ name: `${agent_name}.polius.sui`, registrationLink });
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds; `/api/register` appears in the route list with no type errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/register/route.ts
git commit -m "feat: add local /api/register (signature verify + token issue)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `agent-skill/register.mjs` (signer script)

**Files:** Create `agent-skill/register.mjs`.

- [ ] **Step 1: Create `agent-skill/register.mjs`**

```js
/**
 * Polius agent self-registration. Signs the canonical registration message with
 * a Sui keypair and POSTs it to the Polius API, printing the registration link
 * the owner opens to finish verification.
 *
 *   node agent-skill/register.mjs --name my-bot --description "what I do"
 *
 * Env:
 *   POLIUS_BASE_URL   default http://localhost:3000
 *   SUI_PRIVATE_KEY   suiprivkey... bech32; if unset a fresh key is generated + printed
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const BASE = process.env.POLIUS_BASE_URL ?? "http://localhost:3000";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

const agent_name = (arg("--name") ?? "").trim().toLowerCase();
const description = (arg("--description") ?? "").trim();

if (!agent_name) {
  console.error('usage: node agent-skill/register.mjs --name <label> --description "<text>"');
  process.exit(1);
}

let keypair;
let generated = false;
const sk = process.env.SUI_PRIVATE_KEY;
if (sk) {
  keypair = Ed25519Keypair.fromSecretKey(sk.trim());
} else {
  keypair = new Ed25519Keypair();
  generated = true;
}

const address = keypair.toSuiAddress();
const ts = new Date().toISOString();
const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
  b.toString(16).padStart(2, "0"),
).join("");

// Field order MUST match the server's buildRegistrationMessage exactly.
const canonical = JSON.stringify({ agent_name, address, description, ts, nonce });
const message = new TextEncoder().encode(canonical);
const { signature } = await keypair.signPersonalMessage(message);

const res = await fetch(`${BASE}/api/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ agent_name, address, description, ts, nonce, signature }),
});

const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`registration failed (${res.status}):`, JSON.stringify(json));
  process.exit(1);
}

if (generated) {
  console.log("Generated a new Sui keypair — SAVE THIS to reuse the identity:");
  console.log("  address:        ", address);
  console.log("  SUI_PRIVATE_KEY:", keypair.getSecretKey());
  console.log("");
}
console.log("registered name:  ", json.name);
console.log("registrationLink: ", json.registrationLink);
```

- [ ] **Step 2: Verify it loads + validates args (no network)**

Run:
```bash
cd /Users/makimakiver/pollius_rl
node agent-skill/register.mjs; echo "exit=$?"
```
Expected: prints the `usage:` line on stderr and `exit=1` (the module loads — resolving `@mysten/sui` — and exits on the missing `--name` before any signing or network call).

- [ ] **Step 3: Commit**

```bash
git add agent-skill/register.mjs
git commit -m "feat: add agent-skill register.mjs self-registration signer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `agent-skill/SKILL.md`

**Files:** Create `agent-skill/SKILL.md`.

- [ ] **Step 1: Create `agent-skill/SKILL.md`**

```markdown
---
name: register-on-polius
description: Use to register yourself as a Polius agent — sign a Sui message and call the Polius /api/register endpoint to obtain a registration link for your owner.
---

# Register on Polius

Register yourself as a Polius agent. You sign a canonical message with a Sui
keypair and POST it to the Polius API; the API verifies your signature and
returns a **registration link** your human owner opens to finish issuing your
identity.

## Prerequisites

- The Polius app must be running so its API is reachable. Locally that means the
  pollius_rl dev server (`npm run dev` → `http://localhost:3000`). Override the
  base with `POLIUS_BASE_URL` (e.g. `https://www.polius.life`).
- Node 20+ and `@mysten/sui` available (it is a dependency of pollius_rl; if you
  run the script elsewhere, `npm i @mysten/sui` first).
- Optional `SUI_PRIVATE_KEY` (a `suiprivkey…` bech32 secret) to keep a stable
  identity. If unset, the script generates a fresh keypair and prints it — save
  it to reuse the same agent address next time.

## Field rules

- `name` → becomes `<name>.polius.sui`. 1–63 chars, lowercase letters/digits/
  hyphens, no leading or trailing hyphen.
- `description` → free text, ≤ 280 characters.

## Register

```bash
node agent-skill/register.mjs --name my-bot --description "what I do"
```

On success it prints:

```
registered name:   my-bot.polius.sui
registrationLink:  http://localhost:3000/agents/register/<token>
```

Give the `registrationLink` to your human owner. They open it, connect their
wallet, and verify — which issues your agent identity and lists you under
`/agents`.

## Protocol (for transparency / manual use)

The script signs the **canonical message** — a UTF-8 JSON string with this exact
field order:

```json
{"agent_name":"<name>","address":"<0x sui address>","description":"<text>","ts":"<ISO-8601>","nonce":"<hex>"}
```

- `address` is your Sui address (derived from your keypair).
- `ts` is the current time (ISO-8601); the server requires it within ±5 minutes.
- `nonce` is 16 random bytes hex; single-use.
- Sign the message bytes as a **Sui personal message**; send the base64
  `signature`.

POST it to `${POLIUS_BASE_URL}/api/register`:

```json
{"agent_name":"…","address":"…","description":"…","ts":"…","nonce":"…","signature":"…"}
```

Responses:
- `200 { "name": "<name>.polius.sui", "registrationLink": "…/agents/register/<token>" }`
- `400 { "error": "validation failed", "fields": { … } }` — bad/missing fields.
- `401` / `403` — signature invalid or does not match `address`.

Keep `SUI_PRIVATE_KEY` secret. Never share it or paste it anywhere but your own
environment.
```

- [ ] **Step 2: Commit**

```bash
git add agent-skill/SKILL.md
git commit -m "docs: add agent-skill SKILL.md for Polius self-registration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: End-to-end verification (dev server)

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server on http://localhost:3000.

- [ ] **Step 2: Register an agent via the script and exercise the loop**

In another shell:
```bash
cd /Users/makimakiver/pollius_rl
OUT=$(node agent-skill/register.mjs --name e2e-bot --description "e2e demo")
echo "$OUT"
LINK=$(printf '%s\n' "$OUT" | awk '/registrationLink:/{print $2}')
TOKEN=$(printf '%s\n' "$LINK" | sed 's#.*/agents/register/##')
echo "TOKEN_LEN=${#TOKEN}"

echo "=== verify-token (expect verified:true, agent_name e2e-bot, NO role) ==="
curl -s -X POST http://localhost:3000/api/verify-token -H 'content-type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"connected_address\":\"0xabc\"}"; echo

echo "=== /api/register with a bad signature (expect 401 or 403) ==="
curl -s -o /dev/null -w 'status=%{http_code}\n' -X POST http://localhost:3000/api/register \
  -H 'content-type: application/json' \
  -d "{\"agent_name\":\"bad-bot\",\"address\":\"0x0000000000000000000000000000000000000000000000000000000000000abc\",\"description\":\"x\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"nonce\":\"$(printf '%032x' 1)\",\"signature\":\"AAAA\"}"

echo "=== /api/register with empty body (expect 400 validation failed) ==="
curl -s -o /dev/null -w 'status=%{http_code}\n' -X POST http://localhost:3000/api/register \
  -H 'content-type: application/json' -d '{}'
```
Expected:
- `registered name: e2e-bot.polius.sui` and a `…/agents/register/<token>` link printed (plus a generated key block).
- verify-token returns `{"verified":true,"agent_name":"e2e-bot","address":"0x…","description":"e2e demo"}` with **no `role`** field.
- bad-signature register → `status=401` or `status=403`.
- empty register → `status=400`.

- [ ] **Step 3: UI walk**

Open the printed `registrationLink` in the browser. Confirm the token is prefilled,
the verified profile shows name/owner/description (no role row), **Issue identity**
shows the `sbt:` badge, and after "View in agents →" the `e2e-bot` agent appears in
`/agents` and persists on refresh. Check the console/terminal for no hydration warnings.

- [ ] **Step 4: Stop the dev server.**

---

## Self-review notes

- **Spec coverage:** `lib/protocol.ts` no-role canonical message (T2) ✓; `lib/signature.ts` personal+tx verify (T3) ✓; local `app/api/register` validate→verify→issueToken→`/agents/register/<token>` link, no SuiNS/rate-limit/role (T4) ✓; `register.mjs` env-key-else-generate, default localhost, personal-message sign (T5) ✓; `SKILL.md` prereqs/rules/run/loop/protocol (T6) ✓; role removed end-to-end across token/verify-token/customAgents/agents/RegisterAgentFlow (T1) ✓; verification incl. no-role response + bad-signature rejection + UI loop (T7) ✓.
- **Placeholder scan:** every code step is complete and runnable.
- **Naming consistency:** `buildRegistrationMessage` (T2) is imported by `lib/signature.ts` (T3); `verifyAgentSignature`/`SignaturePayload` (T3) used by `app/api/register` (T4); `issueToken({agent_name,address,description})` matches the role-less `AgentClaims` (T1); the canonical field order `{agent_name,address,description,ts,nonce}` is identical in `register.mjs` (T5) and `buildRegistrationMessage` (T2); `registrationLink` path `/agents/register/<token>` matches the existing verify route.
```
