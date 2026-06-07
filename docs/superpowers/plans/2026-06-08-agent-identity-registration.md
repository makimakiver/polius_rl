# Agent Identity Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agents page's `+ New agent` button lead to a real verify-token registration flow that issues a (mocked) soulbound agent identity and adds the agent to the `/agents` list.

**Architecture:** Port the `polius_small` token library + `/api/verify-token` verifier (rate-limiting stripped) into pollius_rl. A themed `/agents/register` page (with a `/agents/register/[token]` deep-link variant) lets the owner paste a registration token, verify it against the connected wallet, and then "issue" a mocked soulbound identity persisted to `localStorage`. The `/agents` page merges those custom agents. A dev-only script mints valid tokens so the flow is demoable.

**Tech Stack:** Next.js 16.2.7 (modified — see `AGENTS.md`), React 19, Tailwind v4, `@mysten/dapp-kit`, `node:crypto` (HMAC). No test runner — verification is `npm run lint`, `npm run build`, `npx tsx` checks, and a dev-server walk.

---

## Why no unit tests

No test runner exists in `package.json`. Verification uses: `npx tsx` round-trip checks for pure logic (token HMAC, id derivation), `npm run build` (Next type-checks routes/pages/components during build), `npm run lint`, and a final dev-server end-to-end walk. This matches existing project practice (`PoliusOrbitVisual`, the Move contracts).

## File structure

- **New** `lib/token.ts` — HMAC issue/verify of registration tokens (ported verbatim). One responsibility: token crypto. Reads `AUTH_SECRET`.
- **New** `app/api/verify-token/route.ts` — POST verifier (ported, rate-limiting removed). Depends on `lib/token`.
- **New** `scripts/issue-token.ts` — dev-only token minter. Depends on `lib/token`.
- **New** `app/data/customAgents.ts` — localStorage persistence + claims→Agent mapping + id helpers. Depends on the `Agent` type.
- **New** `app/agents/register/RegisterAgentFlow.tsx` — the client UI (shared by both routes).
- **New** `app/agents/register/page.tsx` — renders the flow with no token.
- **New** `app/agents/register/[token]/page.tsx` — renders the flow with a prefilled token.
- **Edit** `app/data/agents.ts` — extend `Agent` with optional identity fields.
- **Edit** `app/components/DeployButton.tsx` — optional `href` prop.
- **Edit** `app/agents/page.tsx` — pass `href`, merge custom agents.
- **Edit** `.env.local` (gitignored) + `.env.local.example` — `AUTH_SECRET`.

---

## Task 1: Port the token library + AUTH_SECRET env

**Files:**
- Create: `lib/token.ts`
- Modify: `.env.local`, `.env.local.example`

- [ ] **Step 1: Create `lib/token.ts`**

```ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function loadSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    throw new Error(
      "AUTH_SECRET is not set. Add it to .env.local — generate with: openssl rand -hex 32",
    );
  }
  if (s.length < 32) {
    throw new Error(
      `AUTH_SECRET is too short (${s.length} chars). Use at least 32 characters.`,
    );
  }
  return s;
}

const SECRET = loadSecret();

export interface AgentClaims {
  agent_name: string;
  address: string;
  description: string;
  role: string;
}

interface SignedPayload extends AgentClaims {
  exp: number;
  jti: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function issueToken(claims: AgentClaims, ttlSeconds = 600): string {
  const payload: SignedPayload = {
    ...claims,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    jti: randomBytes(8).toString("hex"),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token: string): SignedPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = b64url(createHmac("sha256", SECRET).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString()) as SignedPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add `AUTH_SECRET` to `.env.local` (generate a real secret)**

Run:
```bash
cd /Users/makimakiver/pollius_rl
SECRET=$(openssl rand -hex 32)
printf '\n# HMAC secret for agent registration tokens (>=32 chars). openssl rand -hex 32\nAUTH_SECRET=%s\n' "$SECRET" >> .env.local
```

- [ ] **Step 3: Document the var in `.env.local.example`**

Append to `/Users/makimakiver/pollius_rl/.env.local.example`:

```
# HMAC secret for agent registration tokens (>=32 chars).
# Generate with: openssl rand -hex 32
AUTH_SECRET=
```

- [ ] **Step 4: Verify the token round-trip**

Run (sources `.env.local` so `AUTH_SECRET` is present; `npx` may download `tsx` once):
```bash
cd /Users/makimakiver/pollius_rl
set -a; . ./.env.local; set +a
npx --yes tsx -e "import {issueToken,verifyToken} from './lib/token'; const t=issueToken({agent_name:'demo',address:'0x1',description:'d',role:'trader'}); const v=verifyToken(t); console.log('ROUNDTRIP', !!v && v.agent_name==='demo'); console.log('TAMPER_REJECTED', verifyToken(t.slice(0,-2)+'zz')===null);"
```
Expected: `ROUNDTRIP true` and `TAMPER_REJECTED true`.

- [ ] **Step 5: Commit** (`.env.local` is gitignored — only `lib/token.ts` + example are committed)

```bash
git add lib/token.ts .env.local.example
git commit -m "feat: port HMAC agent registration token library

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Dev-only token issuer script

**Files:**
- Create: `scripts/issue-token.ts`

- [ ] **Step 1: Create `scripts/issue-token.ts`**

```ts
/**
 * Dev-only: mint a valid agent registration token for walking the
 * /agents/register flow locally. Requires AUTH_SECRET in the environment
 * (source .env.local first). NOT for production use.
 *
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/issue-token.ts --name demo-agent --address 0xabc --role trader --desc "demo"
 */
import { issueToken, verifyToken } from "../lib/token";

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const claims = {
  agent_name: arg("--name", "demo-agent"),
  address: arg(
    "--address",
    "0x0000000000000000000000000000000000000000000000000000000000000abc",
  ),
  role: arg("--role", "trader"),
  description: arg("--desc", "a demo agent"),
};

const token = issueToken(claims);
const ok = !!verifyToken(token);

console.log("\nclaims:", claims);
console.log("\ntoken:\n" + token);
console.log("\nlink:\n/agents/register/" + encodeURIComponent(token));
console.log("\nroundtrip verify:", ok ? "OK" : "FAILED");
```

- [ ] **Step 2: Verify the script runs and prints a valid token**

Run:
```bash
cd /Users/makimakiver/pollius_rl
set -a; . ./.env.local; set +a
npx tsx scripts/issue-token.ts --name demo-agent --role trader --desc "a demo agent"
```
Expected: prints `claims`, a `token`, a `/agents/register/<token>` link, and `roundtrip verify: OK`.

- [ ] **Step 3: Commit**

```bash
git add scripts/issue-token.ts
git commit -m "feat: dev-only agent registration token issuer script

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Port `/api/verify-token` route (rate-limiting stripped)

**Files:**
- Create: `app/api/verify-token/route.ts`

- [ ] **Step 1: Create `app/api/verify-token/route.ts`**

```ts
import { verifyToken } from "@/lib/token";

function normalize(addr: string) {
  if (!addr.startsWith("0x")) return null;
  const hex = addr.slice(2).toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length === 0 || hex.length > 64) return null;
  return "0x" + hex.padStart(64, "0");
}

export async function POST(req: Request) {
  let body: { token?: string; connected_address?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { token, connected_address } = body;
  if (!token) return Response.json({ error: "missing token" }, { status: 400 });
  if (!connected_address)
    return Response.json({ error: "missing connected_address" }, { status: 400 });

  const claims = verifyToken(token);
  if (!claims)
    return Response.json({ error: "token invalid or expired" }, { status: 401 });

  const b = normalize(claims.address);

  // Address-match enforcement intentionally disabled for now (mirrors the
  // polius_small reference). Re-enable to require the connected wallet to equal
  // the token's address:
  //   const a = normalize(connected_address);
  //   if (!a || !b) return Response.json({ error: "invalid address format" }, { status: 400 });
  //   if (a !== b) return Response.json({ error: "connected wallet does not match token address", expected: b, got: a }, { status: 403 });

  return Response.json({
    verified: true,
    agent_name: claims.agent_name,
    address: b,
    description: claims.description,
    role: claims.role,
  });
}
```

- [ ] **Step 2: Build to type-check + compile the route**

Run: `npm run build`
Expected: build succeeds; the route `/api/verify-token` appears in the route list with no errors. (Build loads `.env.local`, so `AUTH_SECRET` is present and `lib/token` imports cleanly.)

- [ ] **Step 3: Commit**

```bash
git add app/api/verify-token/route.ts
git commit -m "feat: add /api/verify-token route (rate-limiting stripped)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Data layer — extend `Agent` + custom-agents store

**Files:**
- Modify: `app/data/agents.ts`
- Create: `app/data/customAgents.ts`

- [ ] **Step 1: Extend the `Agent` interface**

In `app/data/agents.ts`, replace the `Agent` interface (currently lines 8–18):

```ts
export interface Agent {
  id: string;
  name: string;
  model: string;
  status: AgentStatus;
  uptime: string;
  /** unclaimed reward available to withdraw, in $SUI */
  claimable: number;
  /** the RL environments this agent has joined */
  envIds: string[];
}
```

with:

```ts
export interface Agent {
  id: string;
  name: string;
  model: string;
  status: AgentStatus;
  uptime: string;
  /** unclaimed reward available to withdraw, in $SUI */
  claimable: number;
  /** the RL environments this agent has joined */
  envIds: string[];
  // ---- identity (set for user-registered agents) ----------------------
  /** agent role, e.g. "trader" */
  role?: string;
  /** human description */
  description?: string;
  /** owner wallet address */
  owner?: string;
  /** mocked soulbound identity id, e.g. "sbt:1a2b3c4d" */
  identityId?: string;
}
```

- [ ] **Step 2: Create `app/data/customAgents.ts`**

```ts
// User-registered agents, persisted client-side in localStorage. These are a
// mock stand-in for the real soulbound-identity registry; the `identityId`
// field marks the (mocked) soulbound token.

import type { Agent } from "./agents";

const KEY = "pollius.customAgents";

export interface VerifiedClaims {
  agent_name: string;
  address: string;
  role: string;
  description: string;
}

export function loadCustomAgents(): Agent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Agent[]) : [];
  } catch {
    return [];
  }
}

export function addCustomAgent(agent: Agent): void {
  if (typeof window === "undefined") return;
  const list = loadCustomAgents().filter((a) => a.id !== agent.id);
  list.push(agent);
  window.localStorage.setItem(KEY, JSON.stringify(list));
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Deterministic mock soulbound id from owner + agent name (FNV-1a 32-bit). */
export function deriveIdentityId(owner: string, agentName: string): string {
  let h = 0x811c9dc5;
  const input = `${owner}:${agentName}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "sbt:" + (h >>> 0).toString(16).padStart(8, "0");
}

export function agentFromClaims(claims: VerifiedClaims): Agent {
  return {
    id: slugify(claims.agent_name) || "agent",
    name: claims.agent_name,
    model: "custom",
    status: "Idle",
    uptime: "new",
    claimable: 0,
    envIds: [],
    role: claims.role,
    description: claims.description,
    owner: claims.address,
    identityId: deriveIdentityId(claims.address, claims.agent_name),
  };
}
```

- [ ] **Step 3: Verify the pure helpers**

Run:
```bash
cd /Users/makimakiver/pollius_rl
npx --yes tsx -e "import {slugify,deriveIdentityId,agentFromClaims} from './app/data/customAgents'; console.log('SLUG', slugify('Hermes Delta!')==='hermes-delta'); console.log('STABLE', deriveIdentityId('0xabc','hermes')===deriveIdentityId('0xabc','hermes') && deriveIdentityId('0xabc','hermes').startsWith('sbt:')); const a=agentFromClaims({agent_name:'hermes-x',address:'0xabc',role:'trader',description:'d'}); console.log('AGENT', a.id==='hermes-x' && a.envIds.length===0 && a.identityId===deriveIdentityId('0xabc','hermes-x'));"
```
Expected: `SLUG true`, `STABLE true`, `AGENT true`.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors in `app/data/agents.ts` or `app/data/customAgents.ts` (pre-existing issues in other files are acceptable).

- [ ] **Step 5: Commit**

```bash
git add app/data/agents.ts app/data/customAgents.ts
git commit -m "feat: custom-agents localStorage store + Agent identity fields

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `DeployButton` optional `href`

**Files:**
- Modify: `app/components/DeployButton.tsx`

- [ ] **Step 1: Add an optional `href` prop**

Replace the whole component body of `app/components/DeployButton.tsx` with:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useWalletModal } from "./wallet";

export default function DeployButton({
  className = "",
  children = "Deploy an environment",
  href = "/deploy",
}: {
  className?: string;
  children?: React.ReactNode;
  href?: string;
}) {
  const account = useCurrentAccount();
  const { open } = useWalletModal();
  const router = useRouter();

  const base =
    "inline-flex items-center justify-center gap-2 rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-ink";

  return (
    <button
      type="button"
      className={`${base} ${className}`}
      onClick={() => {
        if (account) {
          router.push(href);
        } else {
          // Not connected → open the wallet-selection modal first.
          open();
        }
      }}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds; `/deploy` callers still type-check (the new prop is optional with the same default behavior).

- [ ] **Step 3: Commit**

```bash
git add app/components/DeployButton.tsx
git commit -m "feat: DeployButton optional href prop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Register flow component + routes

**Files:**
- Create: `app/agents/register/RegisterAgentFlow.tsx`
- Create: `app/agents/register/page.tsx`
- Create: `app/agents/register/[token]/page.tsx`

- [ ] **Step 1: Create `app/agents/register/RegisterAgentFlow.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useCurrentAccount } from "@mysten/dapp-kit";
import AppShell from "../../components/AppShell";
import { useWalletModal } from "../../components/wallet";
import { shortAddress } from "../../data/environments";
import { agentFromClaims, addCustomAgent, type VerifiedClaims } from "../../data/customAgents";

const fieldCls =
  "w-full border border-ink/15 bg-white/60 px-3 py-2 text-sm outline-none transition-colors focus:border-accent placeholder:text-ink/30";
const labelCls = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink/50";

type Status = "idle" | "verifying" | "verified" | "issued" | "error";

export default function RegisterAgentFlow({ initialToken = "" }: { initialToken?: string }) {
  const account = useCurrentAccount();
  const { open } = useWalletModal();

  const [token, setToken] = useState(initialToken);
  const [status, setStatus] = useState<Status>("idle");
  const [claims, setClaims] = useState<VerifiedClaims | null>(null);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    if (!account) return open();
    if (!token.trim()) return;
    setStatus("verifying");
    setError(null);
    try {
      const r = await fetch("/api/verify-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim(), connected_address: account.address }),
      });
      const json = await r.json();
      if (!r.ok || !json.verified) {
        setError(json.error ?? "verification failed");
        setStatus("error");
        return;
      }
      setClaims({
        agent_name: json.agent_name,
        address: json.address,
        role: json.role,
        description: json.description,
      });
      setStatus("verified");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function issueIdentity() {
    if (!claims) return;
    const agent = agentFromClaims(claims);
    addCustomAgent(agent);
    setIdentityId(agent.identityId ?? null);
    setStatus("issued");
  }

  const verifyDisabled = account ? !token.trim() || status === "verifying" : false;

  return (
    <AppShell>
      <main className="theme-agent mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8">
        <p className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Agent identity
        </p>
        <h1 className="text-3xl font-medium tracking-tight">Register a new agent</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink/60">
          Verify your agent&apos;s registration token to issue its soulbound identity. The
          identity is bound to your wallet and cannot be transferred.
        </p>

        {/* Step 1 — token */}
        <section className="mt-8 rounded-xl border border-ink/15 p-5">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-ink/50">1 · Registration token</h2>
          <label className={labelCls} htmlFor="token">Token</label>
          <textarea
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={3}
            placeholder="paste the registration token issued to your agent"
            className={`${fieldCls} font-mono`}
          />
        </section>

        {/* Step 2 — wallet + verify */}
        <section className="mt-5 rounded-xl border border-ink/15 p-5">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-ink/50">2 · Verify with wallet</h2>
          <p className="font-mono text-xs text-ink/50">
            {account ? `connected ${shortAddress(account.address, 10, 6)}` : "connect a wallet to verify"}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={verify}
              disabled={verifyDisabled}
              className="rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === "verifying" ? "Verifying…" : account ? "Verify token" : "Connect wallet"}
            </button>
            {status === "error" && <span className="text-xs text-rose-600">⚠ {error}</span>}
          </div>
        </section>

        {/* Verified profile */}
        {(status === "verified" || status === "issued") && claims && (
          <section className="mt-5 rounded-xl border border-accent/30 bg-accent/[0.06] p-5">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-accent">✓ Verified agent</h2>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Row label="name" value={`${claims.agent_name}.polius.sui`} />
              <Row label="role" value={claims.role} />
              <Row label="owner" value={shortAddress(claims.address, 10, 6)} mono />
              <Row label="description" value={claims.description} />
            </dl>
            {status === "verified" && (
              <button
                type="button"
                onClick={issueIdentity}
                className="mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Issue identity
              </button>
            )}
          </section>
        )}

        {/* Issued */}
        {status === "issued" && identityId && (
          <section className="mt-5 rounded-xl border border-ink/15 p-5">
            <h2 className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-ink/50">Identity issued</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs text-accent">
                {identityId}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink/40">soulbound · non-transferable</span>
            </div>
            <Link href="/agents" className="mt-5 inline-block text-sm text-accent underline-offset-4 hover:underline">
              View in agents →
            </Link>
          </section>
        )}
      </main>
    </AppShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wide text-ink/40">{label}</dt>
      <dd className={`${mono ? "font-mono " : ""}text-ink/80`}>{value}</dd>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/agents/register/page.tsx`**

```tsx
import RegisterAgentFlow from "./RegisterAgentFlow";

export default function RegisterAgentPage() {
  return <RegisterAgentFlow />;
}
```

- [ ] **Step 3: Create `app/agents/register/[token]/page.tsx`**

```tsx
import RegisterAgentFlow from "../RegisterAgentFlow";

export default async function RegisterAgentTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <RegisterAgentFlow initialToken={decodeURIComponent(token)} />;
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds; routes `/agents/register` and `/agents/register/[token]` appear with no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/agents/register/RegisterAgentFlow.tsx app/agents/register/page.tsx "app/agents/register/[token]/page.tsx"
git commit -m "feat: agent registration verify-token flow + routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Wire the agents page — button href + merge custom agents

**Files:**
- Modify: `app/agents/page.tsx`

- [ ] **Step 1: Update imports**

In `app/agents/page.tsx`:

Change line 3 from:
```tsx
import { useMemo, useState } from "react";
```
to:
```tsx
import { useMemo, useState, useEffect } from "react";
```

Change line 11 from:
```tsx
import { agents, agentRuns, aggregateCurve, agentReward, agentSuccess, type AgentStatus } from "../data/agents";
```
to:
```tsx
import { agents, agentRuns, aggregateCurve, agentReward, agentSuccess, type AgentStatus, type Agent } from "../data/agents";
import { loadCustomAgents } from "../data/customAgents";
```

- [ ] **Step 2: Add custom-agent state + merged list**

Immediately after the `const [sort, setSort] = useState<SortKey>("reward");` line (currently line 39), insert:

```tsx

  // user-registered agents (mock, persisted in localStorage); loaded client-side
  const [custom, setCustom] = useState<Agent[]>([]);
  useEffect(() => {
    const c = loadCustomAgents();
    setCustom(c);
    setStatuses((s) => ({ ...Object.fromEntries(c.map((a) => [a.id, a.status])), ...s }));
    setClaimable((cl) => ({ ...Object.fromEntries(c.map((a) => [a.id, a.claimable])), ...cl }));
  }, []);
  const allAgents = useMemo(() => [...agents, ...custom], [custom]);
```

- [ ] **Step 3: Use the merged list in derived values**

Replace the `enriched` memo (currently lines 41–48):

```tsx
  const enriched = useMemo(
    () =>
      agents.map((a) => {
        const runs = agentRuns(a);
        return { agent: a, runs, reward: agentReward(runs), success: agentSuccess(runs) };
      }),
    []
  );
```

with:

```tsx
  const enriched = useMemo(
    () =>
      allAgents.map((a) => {
        const runs = agentRuns(a);
        return { agent: a, runs, reward: agentReward(runs), success: agentSuccess(runs) };
      }),
    [allAgents]
  );
```

Replace the `active` line (currently line 61):
```tsx
  const active = agents.filter((a) => statuses[a.id] === "Active").length;
```
with:
```tsx
  const active = allAgents.filter((a) => statuses[a.id] === "Active").length;
```

Replace the `Agents` stat (currently line 67):
```tsx
    { label: "Agents", value: num.format(agents.length) },
```
with:
```tsx
    { label: "Agents", value: num.format(allAgents.length) },
```

Replace the `claimAll` body (currently lines 80–83):
```tsx
  const claimAll = () => {
    if (!account) return open();
    setClaimable(Object.fromEntries(agents.map((a) => [a.id, 0])));
  };
```
with:
```tsx
  const claimAll = () => {
    if (!account) return open();
    setClaimable(Object.fromEntries(allAgents.map((a) => [a.id, 0])));
  };
```

- [ ] **Step 4: Point the button at the register page**

Replace line 113:
```tsx
              <DeployButton>+ New agent</DeployButton>
```
with:
```tsx
              <DeployButton href="/agents/register">+ New agent</DeployButton>
```

- [ ] **Step 5: Build + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds; no new lint errors in `app/agents/page.tsx` (pre-existing issues elsewhere are acceptable).

- [ ] **Step 6: Commit**

```bash
git add app/agents/page.tsx
git commit -m "feat: agents page routes New agent to register + merges custom agents

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: End-to-end verification (dev server)

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts on http://localhost:3000.

- [ ] **Step 2: Mint a token and exercise the API directly**

In another shell:
```bash
cd /Users/makimakiver/pollius_rl
set -a; . ./.env.local; set +a
TOKEN=$(npx tsx scripts/issue-token.ts --name e2e-agent --role trader --desc "e2e" | awk '/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/{print; exit}')
echo "token: $TOKEN"
curl -s -X POST http://localhost:3000/api/verify-token -H "content-type: application/json" -d "{\"token\":\"$TOKEN\",\"connected_address\":\"0xabc\"}"
echo
curl -s -o /dev/null -w "tampered status: %{http_code}\n" -X POST http://localhost:3000/api/verify-token -H "content-type: application/json" -d "{\"token\":\"${TOKEN}zz\",\"connected_address\":\"0xabc\"}"
```
Expected: first curl returns `{"verified":true,"agent_name":"e2e-agent",...}`; tampered status: `401`.

- [ ] **Step 3: Walk the UI**

Open `http://localhost:3000/agents`. Confirm:
- `+ New agent` (after connecting a wallet) navigates to `/agents/register`.
- Pasting the minted token and clicking **Verify token** shows the verified profile (`e2e-agent.polius.sui`, role, owner, description).
- **Issue identity** shows an `sbt:…` badge marked "soulbound · non-transferable" and a "View in agents →" link.
- After clicking through to `/agents`, the new `e2e-agent` card appears and persists across a page refresh.
- The deep link `http://localhost:3000/agents/register/<token>` prefills the token field.
- No hydration warnings in the browser console or dev terminal.

- [ ] **Step 4: Stop the dev server.**

---

## Self-review notes

- **Spec coverage:** ported `lib/token` (T1) ✓; `/api/verify-token` rate-limiting stripped, address-match commented (T3) ✓; dev issuer + `AUTH_SECRET` (T1–T2) ✓; verify page + `[token]` deep link, clean theme, wallet-gated verify (T6) ✓; mocked soulbound identity via `deriveIdentityId`/`agentFromClaims` (T4, T6) ✓; `localStorage` persistence + `/agents` merge (T4, T7) ✓; `Agent` type extension (T4) ✓; `DeployButton` href + button wiring (T5, T7) ✓; `.env.local` + example (T1) ✓; no `/api/register`/enclave/on-chain/launch-join (scope respected) ✓; verification incl. no hydration warnings (T8) ✓.
- **Placeholder scan:** every code step contains complete, runnable content.
- **Naming consistency:** `verifyToken`/`issueToken`/`AgentClaims` (T1) match usage in T2/T3; `loadCustomAgents`/`addCustomAgent`/`agentFromClaims`/`VerifiedClaims`/`slugify`/`deriveIdentityId` (T4) match imports in T6/T7; `Agent` optional fields (`role/description/owner/identityId`) set in `agentFromClaims` and read in the flow; `DeployButton` `href` prop (T5) matches the `href="/agents/register"` call (T7); route `params` typed as `Promise` per the modern App Router (and the `polius_small` reference).
- **Note:** Task 4 Step 3 verifies the pure helpers via three precise boolean assertions (`SLUG`, `STABLE`, `AGENT`).
