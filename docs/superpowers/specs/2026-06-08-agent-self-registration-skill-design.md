# Agent self-registration skill (local /api/register) — design

**Date:** 2026-06-08
**Status:** Approved (brainstorming)

## Summary

Give an autonomous agent a `SKILL.md` it can read plus a runnable script that registers
the agent *itself* against **pollius_rl's own local `/api/register`** endpoint. The agent
holds a Sui keypair, signs a canonical registration message, and POSTs it; the local API
verifies the signature and issues a short-lived token, returning a `registrationLink` to
the existing verify page. This closes the registration loop entirely on localhost.

The `role` field is removed from the registration protocol end-to-end (it previously
existed in the verify flow built earlier this session).

## The loop (all local)

1. Agent runs `agent-skill/register.mjs --name <label> --description <text>`.
2. Script signs the canonical message and `POST http://localhost:3000/api/register`.
3. Local `/api/register` verifies the Sui signature and `issueToken({agent_name,address,description})`.
4. Response: `{ name: "<agent>.polius.sui", registrationLink: "http://localhost:3000/agents/register/<token>" }`.
5. The owner opens the `registrationLink` → the existing verify page prefills the token →
   `/api/verify-token` → mock soulbound identity issued → agent appears in `/agents`.

## Reference

Ports from `/Users/makimakiver/polius_small`:
- `lib/protocol.ts` — `buildRegistrationMessage` (canonical message) + role types (role dropped here).
- `lib/signature.ts` — `verifyAgentSignature` (personal-message + tx-wrap modes).
- `app/api/register/route.ts` — the register endpoint (SuiNS + rate-limiting dropped here).
- `lib/protocol.ts`'s `registerAgent` client helper is the model for `register.mjs`.

The live API at `https://www.polius.life` was confirmed to match the reference contract;
this design targets localhost by default, with `POLIUS_BASE_URL` to override.

## Goals

- An agent-readable `SKILL.md` + a deterministic runnable script for self-registration.
- A real, self-contained local `/api/register` that performs genuine Sui signature
  verification (the meaningful security step) and issues a token.
- Reuse the existing verify page / token / identity flow (no duplication).
- Remove `role` from the protocol end-to-end.

## Non-goals (YAGNI)

- No SuiNS name-availability check (`@mysten/suins`); no new dependency, no external lookup.
- No rate limiting.
- No on-chain mint; the soulbound identity remains the existing localStorage mock.
- No `agent-profile`/enclave path.
- The script uses personal-message signing; `verifyAgentSignature` retains tx-mode only
  because it is a faithful port, not because the script needs it.

## Architecture

### Ported libs

**`lib/protocol.ts`** (new) — no `role`:
```ts
export interface AgentRegistration {
  agent_name: string;
  address: string;
  description: string;
}
export interface SignedAgentRegistration extends AgentRegistration {
  ts: string;
  nonce: string;
  signature: string;
}
export interface CheckSubnameResponse { name: string; registrationLink: string; }
export function buildRegistrationMessage(input: {
  agent_name: string; address: string; description: string; ts: string; nonce: string;
}): Uint8Array;
```
`buildRegistrationMessage` returns `TextEncoder().encode(JSON.stringify({agent_name, address, description, ts, nonce}))` — field order fixed and identical on both sides. (The reference's `registerAgent`/`cryptoRandomHex` client helpers and the `Ed25519Keypair` import are NOT ported here; `register.mjs` covers signing.)

**`lib/signature.ts`** (new) — ported `verifyAgentSignature(payload)` with `SignaturePayload`
dropping `role`. Personal mode: `verifyPersonalMessageSignature(message, signature)`,
recovered address must equal `payload.address` (else 403); invalid signature → 401. Tx mode
(when `tx_bcs_b64` present): verify tx signature, decode the single Pure input as
`bcs.vector(bcs.u8())`, and require it to equal the canonical message bytes. Uses
`@mysten/sui/verify`, `@mysten/sui/transactions`, `@mysten/sui/bcs` (all in `@mysten/sui`,
already a dependency) + `buildRegistrationMessage`.

### Local API route

**`app/api/register/route.ts`** (new) — ported, with SuiNS + rate-limiting removed:
- `POST` JSON body `{ agent_name, address, description, ts, nonce, signature, tx_bcs_b64? }`.
- Validation (400 `{error:"validation failed", fields}` on any failure):
  - `agent_name`: trimmed/lowercased, required, matches `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`.
  - `address`: required, matches `^0x[0-9a-fA-F]{1,64}$`.
  - `description`: required, ≤ 280 chars.
  - `ts`: required ISO-8601, within ±5 min of server time.
  - `nonce`: required, `^[a-f0-9]{8,128}$` (case-insensitive).
  - `signature`: required.
  - (No `role`.)
- On valid body: `verifyAgentSignature(...)`; on failure return its `{status,error,detail}`.
- On success: `const token = issueToken({ agent_name, address, description })` (existing
  `lib/token.ts`; `AUTH_SECRET` already set), and return
  `{ name: \`${agent_name}.polius.sui\`, registrationLink: \`${new URL(req.url).origin}/agents/register/${encodeURIComponent(token)}\` }`.

### Agent script

**`agent-skill/register.mjs`** (new) — Node ESM, uses `@mysten/sui` (installed):
- Base URL: `process.env.POLIUS_BASE_URL ?? "http://localhost:3000"`.
- Args: `--name` (required), `--description` (default `""`). No `--role`.
- Keypair: if `process.env.SUI_PRIVATE_KEY` set → `Ed25519Keypair.fromSecretKey(it)`; else
  `new Ed25519Keypair()` and print `address` + `keypair.getSecretKey()` (bech32 `suiprivkey…`)
  with a "save this to reuse the identity" note.
- `address = keypair.toSuiAddress()`, `ts = new Date().toISOString()`, `nonce` = 16 random
  bytes hex (`crypto.getRandomValues`).
- `message = TextEncoder().encode(JSON.stringify({agent_name, address, description, ts, nonce}))`
  (identical field order to `buildRegistrationMessage`), `signature = (await keypair.signPersonalMessage(message)).signature`.
- `POST ${base}/api/register` with `{agent_name, address, description, ts, nonce, signature}`.
- On `!res.ok` print status + body and exit 1; else print `name` + `registrationLink`.

### Skill doc

**`agent-skill/SKILL.md`** (new) — agent-facing instructions:
- Purpose: register yourself as a Polius agent and obtain a registration link for your owner.
- Prerequisites: the pollius_rl dev server running (so `localhost:3000/api/register` is live);
  Node 20+; `@mysten/sui` available; optional `SUI_PRIVATE_KEY`; optional `POLIUS_BASE_URL`.
- Naming/field rules: `agent_name` 1–63 lowercase letters/digits/hyphens, no leading/trailing
  hyphen (becomes `<name>.polius.sui`); `description` ≤ 280 chars. No role.
- Run: `node agent-skill/register.mjs --name my-bot --description "what I do"`.
- Output: `name` + `registrationLink`; hand the link to your human owner to open and verify
  with their wallet. Describe the full loop.
- Raw protocol section (for transparency / manual use): canonical message shape + field order,
  Sui personal-message signing, endpoint contract, error codes, ±5 min `ts` window, single-use
  nonce, keep `SUI_PRIVATE_KEY` secret.

### Role-removal cascade (edits to files built earlier this session)

- `lib/token.ts` — `AgentClaims` → `{ agent_name, address, description }` (drop `role`). This
  intentionally diverges from the `polius_small` reference.
- `app/api/verify-token/route.ts` — response no longer includes `role`.
- `app/data/customAgents.ts` — `VerifiedClaims` drops `role`; `agentFromClaims` no longer sets `role`.
- `app/data/agents.ts` — remove the optional `role` field from `Agent`.
- `app/agents/register/RegisterAgentFlow.tsx` — remove `role` from `setClaims` and remove the
  role row from the verified-profile display.

## Error handling

- `/api/register`: 400 invalid JSON / validation failure (with `fields`); 401 invalid
  signature; 403 signature/address mismatch or bad tx layout; 200 with `{name, registrationLink}`
  on success.
- `register.mjs`: non-2xx prints status + body and exits 1; missing `--name` prints usage and
  exits 1.

## Testing / verification

No test runner; verification is `npm run build`, `npm run lint`, and a live local walk:
1. Start `npm run dev`.
2. `node agent-skill/register.mjs --name e2e-bot --description "e2e"` →
   prints generated key + `name: e2e-bot.polius.sui` + a `…/agents/register/<token>` link.
3. `POST /api/verify-token` with that token → `{verified:true, agent_name:"e2e-bot", ...}` (no `role`).
4. A tampered/forged signature to `/api/register` → 401 or 403.
5. The existing `/agents/register/<token>` page issues the identity and it appears in `/agents`.

## Files

- New: `lib/protocol.ts`, `lib/signature.ts`, `app/api/register/route.ts`,
  `agent-skill/register.mjs`, `agent-skill/SKILL.md`.
- Edit: `lib/token.ts`, `app/api/verify-token/route.ts`, `app/data/customAgents.ts`,
  `app/data/agents.ts`, `app/agents/register/RegisterAgentFlow.tsx`.

## Risks / notes

- Non-standard Next.js 16.2.7 (`AGENTS.md`); a POST route handler is standard App Router.
- `@mysten/sui` subpaths (`/verify`, `/transactions`, `/bcs`, `/keypairs/ed25519`) are all part
  of the installed `@mysten/sui@^2.17.0`.
- `register.mjs` relies on `@mysten/sui` being resolvable from the repo's `node_modules`
  (true in pollius_rl); the SKILL.md notes `npm i @mysten/sui` if run elsewhere.
- Removing `role` is an intentional protocol divergence from `polius_small`.
