# Agent identity registration (verify-token flow) — design

**Date:** 2026-06-08
**Status:** Approved (brainstorming)

## Summary

Make the agents page's `+ New agent` button lead to a real **agent identity
registration** flow. An agent's identity is a **soulbound token** (non-transferable,
bound to the owner's wallet) that only *qualified* agents receive. Qualification is
proven by a short-lived **HMAC registration token** that the owner verifies against a
**`/api/verify-token`** endpoint (ported from the `polius_small` reference). On
successful verification we issue a **mocked** soulbound identity and add the agent to
the local agents list.

This pass ports the real *verifier* and token library, builds a themed verify page,
and adds a dev-only token issuer so the flow is demoable end-to-end. The real issuer
(`/api/register` with agent signature + SuiNS), the enclave attestation path, and the
on-chain soulbound mint are explicitly **out of scope** and remain mocked/deferred.

## Reference

Mirrors `/Users/makimakiver/polius_small`:
- `lib/token.ts` — HMAC issue/verify of registration tokens.
- `app/api/verify-token/route.ts` — verifies a token against the connected wallet.
- `app/register/[token]/page.tsx` — the owner-facing verify screen (retro-themed there;
  rebuilt clean here).

The reference's full flow is agent-initiated: an agent signs `{agent_name, address,
description, role, ts, nonce}` → `POST /api/register` verifies the signature + SuiNS
availability of `<agent_name>.polius.sui` → issues a 10-min token in a `/register/<token>`
link → the owner opens it, connects a wallet, and verifies via `/api/verify-token`. We
port only the **verify** half.

## Goals

- `+ New agent` → a dedicated registration route, themed to match pollius_rl.
- Faithful, real token verification (real HMAC, real `/api/verify-token` contract).
- A demoable end-to-end path despite not porting the issuer.
- A newly registered agent appears on `/agents` with a soulbound identity badge.

## Non-goals (YAGNI)

- No `/api/register` (agent signature + SuiNS lookup), no `/api/agent-profile`.
- No enclave attestation, no on-chain `register::register_agent`, no real soulbound mint.
- No launch/join-environment steps.
- No rate limiting in the ported endpoint (the reference no-ops it without Upstash; we
  drop the dependency entirely).
- No edit/delete of registered agents; no home-dashboard integration (only `/agents`).

## Architecture

### Ported backend

**`lib/token.ts`** — ported verbatim:
- `AgentClaims = { agent_name: string; address: string; description: string; role: string }`.
- `issueToken(claims, ttlSeconds = 600): string` — `base64url(JSON({...claims, exp, jti}))`
  + `.` + `HMAC-SHA256(body, AUTH_SECRET)`.
- `verifyToken(token): SignedPayload | null` — constant-time sig check + expiry check.
- Requires `AUTH_SECRET` (≥32 chars) from env; throws on load if missing.

**`app/api/verify-token/route.ts`** — ported with rate limiting removed:
- `POST { token, connected_address }`.
- 400 on invalid JSON / missing `token` / missing `connected_address`.
- 401 if `verifyToken` returns null.
- Address normalization helper retained; the address-match enforcement stays
  **commented out** (matches the reference's current behavior).
- Success: `Response.json({ verified: true, agent_name, address, description, role })`
  where `address` is the normalized claims address.

**`scripts/issue-token.ts`** — dev-only issuer (run via `npx tsx scripts/issue-token.ts`):
- Reads `agent_name, address, role, description` (CLI args or sensible defaults), calls
  `issueToken`, prints the token (and a `/agents/register/<token>` link). Uses the same
  `AUTH_SECRET` so the printed token verifies in-app.

### Frontend

**`app/agents/register/page.tsx`** (clean theme, `AppShell`):
- A **paste-token** input (the `+ New agent` button carries no token).
- Connect-wallet gating via the existing wallet hooks/modal.
- **Verify** button → `POST /api/verify-token` `{ token, connected_address: account.address }`.
- States: `idle | verifying | verified | error`. On `verified`, render the profile:
  `<agent_name>.polius.sui`, address, role, description.
- After verify, an **Issue identity** action (see below).

**`app/agents/register/[token]/page.tsx`**:
- Same screen, but prefills the token from the route param (mirrors the reference deep
  link). Implemented by sharing a single client component between the two routes.

**Mocked soulbound identity (payoff)**:
- On **Issue identity**: derive a non-transferable id, `identityId = "sbt:" +` short hash
  of `${owner}:${agent_name}` (deterministic, no `Math.random`). Display it with a
  "soulbound · non-transferable" badge. No transaction.
- Build an `Agent` from the verified claims and persist it (see data layer). Show a
  success panel with **"View in agents →"** linking to `/agents`.

### Data layer

**`app/data/agents.ts`** — extend the `Agent` interface with optional fields:
`role?: string; description?: string; owner?: string; identityId?: string`.

**`app/data/customAgents.ts`** (new):
- `loadCustomAgents(): Agent[]` — read + parse `localStorage["pollius.customAgents"]`
  (returns `[]` on miss/parse error; client-only).
- `addCustomAgent(agent: Agent): void` — append + persist.
- Mapping from claims → `Agent`: `id = slugify(agent_name)`, `name = agent_name`,
  `owner = address`, `role`, `description`, `identityId`; display defaults
  `model: "custom"`, `status: "Idle"`, `uptime: "new"`, `claimable: 0`, `envIds: []`.

**`app/agents/page.tsx`**:
- Pass `href="/agents/register"` to the `+ New agent` button.
- In a `useEffect` (client-only, avoids hydration mismatch), call `loadCustomAgents()`
  and merge into the rendered list (custom agents first or appended; deduped by `id`).

**`app/components/DeployButton.tsx`**:
- Add optional `href?: string` prop (default `/deploy`). When connected, `router.push(href)`;
  when not, open the wallet modal (unchanged gating).

**`.env.local`** — add `AUTH_SECRET=<32+ char hex>` (generate via `openssl rand -hex 32`).
`.env.local` is gitignored; document the var in `.env.local.example` if present.

## Data flow

1. (Dev) `npx tsx scripts/issue-token.ts --name <n> --address <0x..> --role trader --desc "..."`
   prints a token.
2. Owner clicks `+ New agent` → `/agents/register` (or opens `/agents/register/<token>`).
3. Owner connects wallet, pastes token, clicks **Verify** → `/api/verify-token`.
4. On `verified`, owner clicks **Issue identity** → mocked soulbound id derived,
   `addCustomAgent` persists, redirect/link to `/agents`.
5. `/agents` merges custom agents → the new agent shows with its identity badge.

## Error handling

- Verify endpoint errors surface inline (e.g. "token invalid or expired", "missing token").
- Verify disabled until a token is present and a wallet is connected.
- `loadCustomAgents` tolerates malformed `localStorage` (returns `[]`).
- `AUTH_SECRET` missing → the token module throws on import; the API route returns a 500
  and the dev script errors with the generation hint. Documented in setup.

## Testing / verification

No test runner exists; verification is `npm run lint`, `npm run build`, and a manual walk:
- `scripts/issue-token.ts` prints a token; `/api/verify-token` returns `verified: true`
  for it and 401 for a tampered token.
- `/agents/register` (and `/agents/register/<token>`) verify, issue the mock identity,
  and the agent appears on `/agents` after redirect (persists across refresh).
- No hydration warnings on `/agents` from the custom-agent merge.

## Files

- New: `lib/token.ts`, `app/api/verify-token/route.ts`, `app/agents/register/page.tsx`,
  `app/agents/register/[token]/page.tsx`, `app/data/customAgents.ts`, `scripts/issue-token.ts`
- Edit: `app/components/DeployButton.tsx`, `app/agents/page.tsx`, `app/data/agents.ts`,
  `.env.local` (+ `.env.local.example` if present)

## Risks / notes

- Non-standard Next.js 16.2.7 (see `AGENTS.md`); API route handlers + dynamic `[token]`
  routes are standard App Router, low risk. Consult `node_modules/next/dist/docs/` if the
  build flags anything route-specific.
- `lib/token.ts` uses `node:crypto` — fine for a route handler / Node script; the verify
  page itself never imports it (only calls the API), keeping it server-side.
- The mocked soulbound id is illustrative only; the spec deliberately leaves a clean seam
  (`identityId` on `Agent`) for a later real on-chain mint.
