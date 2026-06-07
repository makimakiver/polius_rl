# Deploy Environment On-Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `/deploy` form to a real `world::create_world_entry` Sui transaction, backed by a central `NEXT_PUBLIC_`-driven contract-config layer.

**Architecture:** A typed config module reads on-chain IDs from `.env.local`. The deploy page gains a "World parameters" section (the 4 real `u64` decay params), builds a `Transaction` with one `moveCall`, signs+executes it via dapp-kit, and renders a real receipt (Environment + EnvironmentCap object IDs + explorer link). RL fields stay cosmetic.

**Tech Stack:** Next.js 16.2.7 (modified — see `node_modules/next/dist/docs/`), React 19, `@mysten/dapp-kit` ^1.0.6 (`useSignAndExecuteTransaction`), `@mysten/sui` ^2.17.0 (`Transaction` from `@mysten/sui/transactions`), TypeScript, Tailwind v4.

**Discovered on-chain values (Sui testnet, verified from publish tx `CCc8AGLjTQeCHD5EQV1G6HGxoB4WwWiDRD78dsYdAKAJ`):**
- Package: `0x22878c182f7b764e8ea3f97e943c421f5ef3781710f8965231cb070c366b1428`
- `agent::AgentBook` (shared): `0x6e78fd3f13809f61df86924146fcc192e33b21fb5fbe4c4fc496634097a81653`
- `enclave::EnclaveConfig<REGISTER>` (shared): `0x3d4abe736001776b6d3255712ca2f9f6d0c408a49e3fae9d5a8cabfb7a0fe418`
- `register::AgentRegistry`: **not created at publish** (created later via `register::initialize_registry`) — leave blank until that's run.
- `Clock`: `0x6` (well-known).

---

## File Structure

- **Create** `app/config/contracts.ts` — typed reader/validator over `process.env.NEXT_PUBLIC_*`; exports `CONTRACTS` + `target()`.
- **Create** `app/config/contracts.test.ts` — unit checks for `target()` and missing-required-key behavior.
- **Create** `.env.local` — real testnet values (git-ignored).
- **Create** `.env.example` — committed template documenting every key.
- **Create** `app/deploy/explorer.ts` — tiny helper building a Suiscan testnet object URL (kept separate so it's trivially testable + reusable by later features).
- **Modify** `app/deploy/page.tsx` — add World-parameters inputs + validation, replace the fake submit with a real tx + receipt.
- **Modify** `package.json` — add a minimal test runner script (`node --test`) if none exists.

---

## Task 1: Contract config module

**Files:**
- Create: `app/config/contracts.ts`
- Test: `app/config/contracts.test.ts`
- Modify: `package.json` (add test script)

- [ ] **Step 1: Confirm Next.js env-var handling**

Per `AGENTS.md` this is a modified Next.js. Before coding, read the env-var guidance:
Run: `ls node_modules/next/dist/docs/01-app && grep -rl "NEXT_PUBLIC" node_modules/next/dist/docs/ | head`
Expected: confirm `NEXT_PUBLIC_`-prefixed vars are still inlined into the client bundle. If the docs say otherwise, stop and surface the difference before continuing.

- [ ] **Step 2: Add a test script to package.json**

In `package.json` `"scripts"`, add:
```json
"test": "node --test --import tsx app/**/*.test.ts"
```
If `tsx` is not installed, run: `npm i -D tsx` first. (Node's built-in test runner needs a TS loader.)

- [ ] **Step 3: Write the failing test**

Create `app/config/contracts.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("target() composes package::module::function", async () => {
  process.env.NEXT_PUBLIC_SUI_NETWORK = "testnet";
  process.env.NEXT_PUBLIC_PACKAGE_ID = "0xpkg";
  process.env.NEXT_PUBLIC_CLOCK_ID = "0x6";
  const { target } = await import("./contracts.ts");
  assert.equal(target("world", "create_world_entry"), "0xpkg::world::create_world_entry");
});

test("loading throws a clear error when PACKAGE_ID is missing", async () => {
  delete process.env.NEXT_PUBLIC_PACKAGE_ID;
  process.env.NEXT_PUBLIC_SUI_NETWORK = "testnet";
  process.env.NEXT_PUBLIC_CLOCK_ID = "0x6";
  await assert.rejects(
    () => import(`./contracts.ts?bust=${process.hrtime.bigint()}`),
    /NEXT_PUBLIC_PACKAGE_ID/,
  );
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './contracts.ts'`.

- [ ] **Step 5: Write the implementation**

Create `app/config/contracts.ts`:
```ts
// Central registry of on-chain contract identifiers, read from NEXT_PUBLIC_*
// env vars (see .env.example). All values here are public on-chain IDs — no
// secrecy required. Required keys are validated at module load so a
// misconfiguration fails loudly instead of producing a malformed transaction.

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing required env var ${key}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return v;
}

function optional(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : undefined;
}

export const CONTRACTS = Object.freeze({
  network: required("NEXT_PUBLIC_SUI_NETWORK"),
  packageId: required("NEXT_PUBLIC_PACKAGE_ID"),
  clockId: required("NEXT_PUBLIC_CLOCK_ID"),
  // Included for forthcoming agent features; not required for deploy.
  agentBookId: optional("NEXT_PUBLIC_AGENT_BOOK_ID"),
  agentRegistryId: optional("NEXT_PUBLIC_AGENT_REGISTRY_ID"),
  enclaveConfigId: optional("NEXT_PUBLIC_ENCLAVE_CONFIG_ID"),
});

export function target(module: string, fn: string): string {
  return `${CONTRACTS.packageId}::${module}::${fn}`;
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npm test`
Expected: PASS for both tests.

- [ ] **Step 7: Commit**

```bash
git add app/config/contracts.ts app/config/contracts.test.ts package.json package-lock.json
git commit -m "feat(config): central NEXT_PUBLIC contract config module"
```

---

## Task 2: Env files

**Files:**
- Create: `.env.example`
- Create: `.env.local`

- [ ] **Step 1: Write `.env.example` (committed template)**

Create `.env.example`:
```
# Sui network the app targets.
NEXT_PUBLIC_SUI_NETWORK=testnet

# Published pols_core package (contracts/Published.toml -> published-at).
NEXT_PUBLIC_PACKAGE_ID=0x0000000000000000000000000000000000000000000000000000000000000000

# Well-known shared Clock object.
NEXT_PUBLIC_CLOCK_ID=0x6

# Shared objects created at publish (needed by later agent features, not deploy).
NEXT_PUBLIC_AGENT_BOOK_ID=
NEXT_PUBLIC_ENCLAVE_CONFIG_ID=

# AgentRegistry — created by calling register::initialize_registry (not at publish).
NEXT_PUBLIC_AGENT_REGISTRY_ID=
```

- [ ] **Step 2: Write `.env.local` (git-ignored, real testnet values)**

Create `.env.local`:
```
NEXT_PUBLIC_SUI_NETWORK=testnet
NEXT_PUBLIC_PACKAGE_ID=0x22878c182f7b764e8ea3f97e943c421f5ef3781710f8965231cb070c366b1428
NEXT_PUBLIC_CLOCK_ID=0x6
NEXT_PUBLIC_AGENT_BOOK_ID=0x6e78fd3f13809f61df86924146fcc192e33b21fb5fbe4c4fc496634097a81653
NEXT_PUBLIC_ENCLAVE_CONFIG_ID=0x3d4abe736001776b6d3255712ca2f9f6d0c408a49e3fae9d5a8cabfb7a0fe418
NEXT_PUBLIC_AGENT_REGISTRY_ID=
```

- [ ] **Step 3: Verify `.env.local` is git-ignored**

Run: `git check-ignore .env.local && git status --porcelain .env.local`
Expected: first command prints `.env.local`; second prints nothing (untracked-but-ignored).

- [ ] **Step 4: Commit the example only**

```bash
git add .env.example
git commit -m "docs(config): add .env.example documenting contract env vars"
```

---

## Task 3: Explorer URL helper

**Files:**
- Create: `app/deploy/explorer.ts`
- Test: `app/deploy/explorer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/deploy/explorer.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { explorerObjectUrl } from "./explorer.ts";

test("builds a testnet object url", () => {
  assert.equal(
    explorerObjectUrl("0xabc", "testnet"),
    "https://suiscan.xyz/testnet/object/0xabc",
  );
});

test("mainnet has no network segment", () => {
  assert.equal(
    explorerObjectUrl("0xabc", "mainnet"),
    "https://suiscan.xyz/mainnet/object/0xabc",
  );
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './explorer.ts'`.

- [ ] **Step 3: Write the implementation**

Create `app/deploy/explorer.ts`:
```ts
// Builds a Suiscan URL for an on-chain object on the given network.
export function explorerObjectUrl(objectId: string, network: string): string {
  return `https://suiscan.xyz/${network}/object/${objectId}`;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test`
Expected: PASS (all tests across the suite).

- [ ] **Step 5: Commit**

```bash
git add app/deploy/explorer.ts app/deploy/explorer.test.ts
git commit -m "feat(deploy): add Suiscan explorer URL helper"
```

---

## Task 4: World-parameter inputs + validation

**Files:**
- Modify: `app/deploy/page.tsx`

This task is UI-only (no tx yet) so the form change is reviewable in isolation.

- [ ] **Step 1: Add state for the four world params**

In `DeployPage`, alongside the existing `useState` calls (after `const [tags, setTags] = useState("")`), add:
```tsx
const [decayBps, setDecayBps] = useState("100");
const [floor, setFloor] = useState("0");
const [ceil, setCeil] = useState("10000");
const [initValue, setInitValue] = useState("5000");
```

- [ ] **Step 2: Add a parser + validation helper**

Above the `return`, add:
```tsx
const parseU64 = (s: string): number | null => {
  if (!/^\d+$/.test(s.trim())) return null;
  const n = Number(s.trim());
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

const p = {
  decayBps: parseU64(decayBps),
  floor: parseU64(floor),
  ceil: parseU64(ceil),
  initValue: parseU64(initValue),
};
const worldParamsValid =
  p.decayBps !== null && p.floor !== null && p.ceil !== null && p.initValue !== null;
const rangeValid =
  worldParamsValid && p.floor! <= p.initValue! && p.initValue! <= p.ceil!;
const worldError = !worldParamsValid
  ? "All world parameters must be non-negative whole numbers."
  : !rangeValid
    ? "Requires floor ≤ initial value ≤ ceiling."
    : null;
```

Then change the existing `canDeploy` line to:
```tsx
const canDeploy = name.trim().length > 1 && rangeValid;
```

- [ ] **Step 3: Render the World-parameters section**

Immediately inside `<form ...>`, before the existing `<Section title="Basics">`, insert:
```tsx
<Section title="World parameters (on-chain)">
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label className={labelCls}>Decay rate (bps/day)</label>
      <input className={fieldCls} value={decayBps} onChange={(e) => setDecayBps(e.target.value)} inputMode="numeric" />
      <p className="mt-1 text-[11px] text-ink/40">Basis points the value decays per day (100 = 1%).</p>
    </div>
    <div>
      <label className={labelCls}>Initial value</label>
      <input className={fieldCls} value={initValue} onChange={(e) => setInitValue(e.target.value)} inputMode="numeric" />
      <p className="mt-1 text-[11px] text-ink/40">Starting world-state value.</p>
    </div>
    <div>
      <label className={labelCls}>Floor</label>
      <input className={fieldCls} value={floor} onChange={(e) => setFloor(e.target.value)} inputMode="numeric" />
      <p className="mt-1 text-[11px] text-ink/40">Below this the world delists.</p>
    </div>
    <div>
      <label className={labelCls}>Ceiling</label>
      <input className={fieldCls} value={ceil} onChange={(e) => setCeil(e.target.value)} inputMode="numeric" />
      <p className="mt-1 text-[11px] text-ink/40">Upper clamp on the value.</p>
    </div>
  </div>
  {worldError && (
    <p className="border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-600">{worldError}</p>
  )}
</Section>
```

- [ ] **Step 4: Show the params in the live preview**

In the right-hand `<aside>` preview, after the existing `algorithm`/spaces line block, add:
```tsx
<div className="mt-2 font-mono text-[11px] text-ink/40">
  decay {decayBps}bps · floor {floor} · init {initValue} · ceil {ceil}
</div>
```

- [ ] **Step 5: Verify it renders and validates**

Run: `npm run dev` and open `/deploy`.
Expected: the new section appears first; setting floor `>` ceil shows the red range error and disables the deploy button; valid values clear it.

- [ ] **Step 6: Commit**

```bash
git add app/deploy/page.tsx
git commit -m "feat(deploy): add on-chain world-parameter inputs and validation"
```

---

## Task 5: Real transaction + receipt

**Files:**
- Modify: `app/deploy/page.tsx`

- [ ] **Step 1: Add imports + hooks**

At the top of `app/deploy/page.tsx`, update the imports:
```tsx
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { CONTRACTS, target } from "../config/contracts";
import { explorerObjectUrl } from "./explorer";
```
Inside `DeployPage`, add:
```tsx
const { mutate: signAndExecute } = useSignAndExecuteTransaction();
const [status, setStatus] = useState<"idle" | "signing">("idle");
const [txError, setTxError] = useState<string | null>(null);
const [result, setResult] = useState<{ envId: string; capId: string } | null>(null);
```

- [ ] **Step 2: Replace `handleSubmit` with the real tx**

Replace the existing `handleSubmit` body with:
```tsx
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  if (!account) { open(); return; }
  if (!canDeploy || !worldParamsValid) return;

  setStatus("signing");
  setTxError(null);

  const tx = new Transaction();
  tx.moveCall({
    target: target("world", "create_world_entry"),
    arguments: [
      tx.pure.u64(p.decayBps!),
      tx.pure.u64(p.floor!),
      tx.pure.u64(p.ceil!),
      tx.pure.u64(p.initValue!),
      tx.object(CONTRACTS.clockId),
    ],
  });

  signAndExecute(
    { transaction: tx },
    {
      onSuccess: ({ effects }) => {
        const created = effects?.created ?? [];
        // The shared Environment vs. the owned EnvironmentCap, told apart by owner.
        const isShared = (o: { owner?: unknown }) =>
          typeof o.owner === "object" && o.owner !== null && "Shared" in (o.owner as object);
        const env = created.find(isShared);
        const cap = created.find((o) => !isShared(o));
        setResult({
          envId: env?.reference?.objectId ?? "(unknown)",
          capId: cap?.reference?.objectId ?? "(unknown)",
        });
        setStatus("idle");
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setTxError(
          /reject|denied|cancel/i.test(msg)
            ? "Transaction was rejected in your wallet."
            : "Transaction failed. Check your testnet balance and try again.",
        );
        setStatus("idle");
      },
    },
  );
};
```

Note: `signAndExecute` returns only digest+effects by default; `effects.created[].reference.objectId` is present. If `effects` is undefined in this dapp-kit version, pass `{ transaction: tx, options: { showEffects: true } }` — verify at Step 5 and adjust.

- [ ] **Step 3: Drive the submit button from status**

Replace the submit button's `disabled` and label expressions with:
```tsx
disabled={(!!account && !canDeploy) || status === "signing"}
```
```tsx
{status === "signing" ? "Deploying…" : account ? "Deploy environment" : "Connect to deploy"}
```

- [ ] **Step 4: Render tx error + swap success source**

Change the success branch condition from `deployed ?` to `result ?`, and render `<DeployedSuccess>` from real data. Replace the `DeployedSuccess` call and component with:
```tsx
{result ? (
  <DeployedSuccess name={name} envId={result.envId} capId={result.capId} />
) : (
```
And replace the `DeployedSuccess` component definition with:
```tsx
function DeployedSuccess({ name, envId, capId }: { name: string; envId: string; capId: string }) {
  return (
    <div className="mt-10 border border-ink/15 bg-white/50 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h2 className="mt-4 text-xl font-medium tracking-tight">Environment deployed</h2>
      <p className="mt-2 text-sm text-ink/60">
        <span className="font-medium text-ink">{name || "Your environment"}</span> is live on Sui testnet.
      </p>
      <dl className="mx-auto mt-4 max-w-md space-y-2 text-left font-mono text-xs">
        <div className="flex items-center justify-between gap-3 border border-ink/10 px-3 py-2">
          <dt className="text-ink/40">Environment</dt>
          <dd className="truncate">
            <a href={explorerObjectUrl(envId, CONTRACTS.network)} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">{envId}</a>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 border border-ink/10 px-3 py-2">
          <dt className="text-ink/40">Cap</dt>
          <dd className="truncate">
            <a href={explorerObjectUrl(capId, CONTRACTS.network)} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">{capId}</a>
          </dd>
        </div>
      </dl>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link href="/" className="bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-black">View dashboard</Link>
        <Link href="/deploy" className="border border-ink/15 px-5 py-2.5 text-sm transition-colors hover:border-accent">Deploy another</Link>
      </div>
    </div>
  );
}
```
Add the tx error display just above the submit button row:
```tsx
{txError && (
  <p className="border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-600">{txError}</p>
)}
```
Remove the now-unused `deployed`/`setDeployed` state and the `id`/`slugify` usage if no longer referenced (keep `id` only if still shown anywhere; otherwise delete to avoid an unused-var lint error).

- [ ] **Step 5: Manual end-to-end verification**

Run: `npm run dev`, connect a funded testnet wallet, deploy with defaults.
Expected: wallet prompts; on approval the success panel shows two real `0x…` IDs; the Environment link opens a live shared object on Suiscan whose type is `…::world::Environment`. Rejecting in the wallet shows the rejection message and re-enables the form. If `effects` was undefined, apply the `options: { showEffects: true }` fix from Step 2's note and re-test.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors (fix any unused-variable warnings from removed mock code).

- [ ] **Step 7: Commit**

```bash
git add app/deploy/page.tsx
git commit -m "feat(deploy): broadcast real create_world_entry tx with on-chain receipt"
```

---

## Self-Review Notes

- **Spec coverage:** Config layer → Task 1+2. World-param form + validation (`floor ≤ init ≤ ceil`) → Task 4. Real tx via `useSignAndExecuteTransaction` + `pure.u64` ×4 + Clock → Task 5. Receipt with Environment/Cap IDs + explorer link → Task 3 (helper) + Task 5. Distinct reject vs. failure errors → Task 5. RL fields cosmetic, no indexer/persistence → respected (untouched). Next.js docs check → Task 1 Step 1.
- **AgentRegistry** intentionally absent (not created at publish); documented in `.env.example` and the config treats it as optional — no task depends on it.
- **dapp-kit effects shape** is the one risk point; Task 5 Steps 2 & 5 carry an explicit verify-and-adjust note rather than assuming.
