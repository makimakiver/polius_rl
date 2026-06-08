# Onboard-Agent Copy-Prompt + Served Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the agent skill at `/skill.md` and add a copy-prompt "onboard your agent" card to `/agents/register` that generates a paste-ready prompt pointing an AI agent at the skill.

**Architecture:** A Node GET route reads `agent-skill/SKILL.md` and returns it as `text/markdown` (single source). A client `OnboardAgentCard` generates a prompt from editable name/description + `window.location.origin`, with copy-to-clipboard. `RegisterAgentFlow` mounts the card only on the base `/agents/register` (no `initialToken`).

**Tech Stack:** Next.js 16.2.7 (modified — see `AGENTS.md`), React 19, Tailwind v4. No test runner — verification is `npm run build`, a `node` fs check, and a dev-server walk.

---

## Why no unit tests

No test runner exists. Verification uses `npm run build` (type-checks the route + component), a `node` fs read check for the route's file path, and a dev-server curl + Playwright walk. Consistent with the rest of this codebase.

## File structure

- **New** `app/skill.md/route.ts` — GET handler serving `agent-skill/SKILL.md` as markdown.
- **New** `app/agents/register/OnboardAgentCard.tsx` — client copy-prompt card.
- **Edit** `app/agents/register/RegisterAgentFlow.tsx` — mount the card when `!initialToken`.

---

## Task 1: Serve the skill at `/skill.md`

**Files:** Create `app/skill.md/route.ts`.

- [ ] **Step 1: Create `app/skill.md/route.ts`**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET() {
  try {
    const md = await readFile(join(process.cwd(), "agent-skill", "SKILL.md"), "utf8");
    return new Response(md, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  } catch {
    return new Response("skill not found", { status: 404 });
  }
}
```

- [ ] **Step 2: Verify the file path the route reads resolves**

Run:
```bash
cd /Users/makimakiver/pollius_rl
node -e "require('fs').promises.readFile(require('path').join(process.cwd(),'agent-skill','SKILL.md'),'utf8').then(s=>console.log('READ_OK', s.length>0)).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: `READ_OK true`.

- [ ] **Step 3: Build (route registration + types)**

Run: `npm run build`
Expected: succeeds; `/skill.md` appears in the route list with no errors.

- [ ] **Step 4: Commit**

```bash
git add app/skill.md/route.ts
git commit -m "feat: serve agent skill at /skill.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `OnboardAgentCard` component

**Files:** Create `app/agents/register/OnboardAgentCard.tsx`.

- [ ] **Step 1: Create `app/agents/register/OnboardAgentCard.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

const fieldCls =
  "w-full border border-ink/15 bg-white/60 px-3 py-2 text-sm outline-none transition-colors focus:border-accent placeholder:text-ink/30";
const labelCls = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink/50";

function buildPrompt(origin: string, name: string, description: string): string {
  const base = origin || "";
  const n = name.trim() || "choose-a-name";
  const d = description.trim() || "what the agent does";
  return [
    "You are registering me as a Polius agent.",
    "",
    `1. Fetch and read the skill at: ${base}/skill.md`,
    "2. Follow it to register an agent with:",
    `   - name: ${n}`,
    `   - description: ${d}`,
    `3. Register against base URL: ${base}`,
    "4. Return the registrationLink it gives you so I can open it and verify with my wallet.",
  ].join("\n");
}

export default function OnboardAgentCard() {
  const [origin, setOrigin] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState(false);

  // client-only: fill the origin after mount so server + first client render match
  useEffect(() => setOrigin(window.location.origin), []);

  const prompt = buildPrompt(origin, name, description);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — leave the prompt visible for manual copy
      setCopied(false);
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-accent/30 bg-accent/[0.06] p-5">
      <h2 className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-accent">
        Are you an agent? Copy this prompt
      </h2>
      <p className="mb-4 text-sm leading-6 text-ink/60">
        Paste this into your AI agent (Claude, Cursor, …). It will read the skill and register you.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="onboard-name">Name</label>
          <input
            id="onboard-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-bot"
            className={fieldCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="onboard-desc">Description</label>
          <input
            id="onboard-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="what the agent does"
            className={fieldCls}
          />
        </div>
      </div>

      <label className={`${labelCls} mt-4`} htmlFor="onboard-prompt">Prompt</label>
      <textarea
        id="onboard-prompt"
        readOnly
        rows={8}
        value={prompt}
        className={`${fieldCls} font-mono`}
      />

      <button
        type="button"
        onClick={copy}
        className="mt-3 rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-ink"
      >
        {copied ? "Copied ✓" : "Copy prompt"}
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds with no type errors. (Lint will report the accepted `react-hooks/set-state-in-effect` for the `setOrigin` effect — the same pattern already present in the codebase; no other new errors.)

- [ ] **Step 3: Commit**

```bash
git add app/agents/register/OnboardAgentCard.tsx
git commit -m "feat: add OnboardAgentCard copy-prompt component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Mount the card on the base register page

**Files:** Modify `app/agents/register/RegisterAgentFlow.tsx`.

- [ ] **Step 1: Import the component**

In `app/agents/register/RegisterAgentFlow.tsx`, add this import after the existing data import (currently line 9, `import { agentFromClaims, addCustomAgent, type VerifiedClaims } from "../../data/customAgents";`):

```tsx
import OnboardAgentCard from "./OnboardAgentCard";
```

- [ ] **Step 2: Mount the card (base page only)**

Find the intro block + Step-1 section (currently lines 81–87):

```tsx
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink/60">
          Verify your agent&apos;s registration token to issue its soulbound identity. The
          identity is bound to your wallet and cannot be transferred.
        </p>

        {/* Step 1 — token */}
        <section className="mt-8 rounded-xl border border-ink/15 p-5">
```

Replace it with (inserts the card between the intro and Step 1, rendered only when there is no prefilled token):

```tsx
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink/60">
          Verify your agent&apos;s registration token to issue its soulbound identity. The
          identity is bound to your wallet and cannot be transferred.
        </p>

        {!initialToken && <OnboardAgentCard />}

        {/* Step 1 — token */}
        <section className="mt-8 rounded-xl border border-ink/15 p-5">
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds with no type errors; `/agents/register` and `/agents/register/[token]` still build.

- [ ] **Step 4: Commit**

```bash
git add app/agents/register/RegisterAgentFlow.tsx
git commit -m "feat: mount OnboardAgentCard on base /agents/register

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: End-to-end verification (dev server)

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server on http://localhost:3000.

- [ ] **Step 2: Verify `/skill.md` is served as markdown**

Run:
```bash
curl -s -i http://localhost:3000/skill.md | head -20
```
Expected: `HTTP/... 200`, a `content-type: text/markdown; charset=utf-8` header, and the body begins with the SKILL.md frontmatter (`name: register-on-polius`).

- [ ] **Step 3: Verify the card on the base page and its absence on the token deep link**

Save this to `/tmp/verify_onboard.py` and run it with `python /tmp/verify_onboard.py` (the dev server from Step 1 must be running):

```python
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))

    # base register page → card present, prompt references <origin>/skill.md
    pg.goto(f"{BASE}/agents/register")
    pg.wait_for_load_state("networkidle")
    pg.wait_for_timeout(600)
    has_card = pg.get_by_text("Are you an agent? Copy this prompt").count() > 0
    print("CARD_PRESENT", has_card)
    pg.fill("#onboard-name", "demo-bot")
    pg.wait_for_timeout(150)
    prompt_val = pg.input_value("#onboard-prompt")
    print("PROMPT_HAS_SKILL_URL", f"{BASE}/skill.md" in prompt_val)
    print("PROMPT_HAS_NAME", "demo-bot" in prompt_val)

    # token deep link → card absent
    pg.goto(f"{BASE}/agents/register/dummytoken")
    pg.wait_for_load_state("networkidle")
    pg.wait_for_timeout(600)
    card_on_token = pg.get_by_text("Are you an agent? Copy this prompt").count() > 0
    print("CARD_ABSENT_ON_TOKEN", not card_on_token)

    hyd = [e for e in errs if any(k in e.lower() for k in ("hydrat", "did not match", "server rendered"))]
    print("HYDRATION", hyd or "NONE")
    b.close()
print("DONE")
```
Expected: `CARD_PRESENT True`, `PROMPT_HAS_SKILL_URL True`, `PROMPT_HAS_NAME True`, `CARD_ABSENT_ON_TOKEN True`, `HYDRATION NONE`.

- [ ] **Step 4: Stop the dev server.**

---

## Self-review notes

- **Spec coverage:** `/skill.md` Node route reading `agent-skill/SKILL.md` as `text/markdown` (T1) ✓; `OnboardAgentCard` with editable name/description, origin-after-mount, generated prompt referencing `<origin>/skill.md`, copy-to-clipboard with feedback, SSR-safe (T2) ✓; mounted on base `/agents/register` only (`!initialToken`), hidden on `/[token]` (T3) ✓; verification incl. markdown content-type, card present/absent, prompt content, no hydration (T4) ✓.
- **Placeholder scan:** every code step is complete and runnable.
- **Naming consistency:** `OnboardAgentCard` default export (T2) matches the import + usage in T3; the prompt's `${base}/skill.md` matches the route path from T1; input ids `onboard-name`/`onboard-desc`/`onboard-prompt` used in the T4 Playwright checks match the component.
