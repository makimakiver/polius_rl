# "Onboard your agent" copy-prompt + served skill — design

**Date:** 2026-06-08
**Status:** Approved (brainstorming)

## Summary

Add a front-end way to onboard an AI agent for self-registration: serve the agent
skill over HTTP at `/skill.md` (matching `polius.life/skill.md`), and add a card on
`/agents/register` that shows a ready-to-paste **prompt**. The user edits a name +
description, clicks **Copy prompt**, and pastes it into their AI agent (Claude, Cursor,
etc.); the prompt instructs the agent to fetch `<origin>/skill.md` and register against
the local API, then return the `registrationLink`.

This builds on the already-shipped agent self-registration: `agent-skill/SKILL.md`,
`agent-skill/register.mjs`, and the local `/api/register` + `/agents/register/<token>`
verify flow.

## Goals

- The skill is fetchable over HTTP at `/skill.md` so a prompt can reference a real URL.
- A copy-prompt card on `/agents/register` generates a clear, self-contained onboarding
  prompt from user-entered name/description and the current origin.
- Single source of truth for the skill text (no duplicated markdown).

## Non-goals (YAGNI)

- No backend for the card (pure client + clipboard).
- No change to the registration protocol, `register.mjs`, or `/api/register`.
- No auth/storage; the prompt is generated on the fly.
- The card is not added to other pages (only `/agents/register`, base view).

## Architecture

### 1. Serve the skill — `app/skill.md/route.ts` (new)

A GET route handler that returns the skill markdown.

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

- Path: the App Router segment folder `app/skill.md/` → URL `/skill.md`.
- Reads the single source `agent-skill/SKILL.md` from `process.cwd()` (works under
  `next dev` and `next start` from the repo root). Node runtime (fs access).
- Content type `text/markdown; charset=utf-8` (mirrors the live site).

### 2. Copy-prompt card — `app/agents/register/OnboardAgentCard.tsx` (new, client)

A self-contained client component.

- State: `name` (string), `description` (string), `copied` (boolean).
- Computes `origin` from `window.location.origin` after mount (client-only; default to
  empty string during SSR/first render to avoid hydration mismatch, then fill in a
  `useEffect`). The prompt text uses the origin once known.
- Renders, in the existing themed style (`fieldCls`/`labelCls`, rounded border card):
  - Heading: "Are you an agent? Copy this prompt."
  - Short hint: "Paste this into your AI agent (Claude, Cursor, …) — it will read the
    skill and register you."
  - `name` input (placeholder e.g. `my-bot`) and `description` input.
  - A read-only `<textarea>`/`<pre>` showing the generated prompt.
  - A **Copy prompt** button: `navigator.clipboard.writeText(prompt)` then show
    "Copied ✓" for ~2s.
- Prompt template (uses origin + entered values, with sensible placeholders when blank):

  ```
  You are registering me as a Polius agent.

  1. Fetch and read the skill at: <origin>/skill.md
  2. Follow it to register an agent with:
     - name: <name or "choose-a-name">
     - description: <description or "what the agent does">
  3. Register against base URL: <origin>
  4. Return the registrationLink it gives you so I can open it and verify with my wallet.
  ```

  When `origin` is not yet known (pre-mount), the textarea may briefly show a relative
  `/skill.md`; after mount it shows the absolute origin. Copy uses the post-mount value.

### 3. Mount — `app/agents/register/RegisterAgentFlow.tsx` (edit)

`RegisterAgentFlow` is the shared client component for both `/agents/register` (no token)
and `/agents/register/[token]` (prefilled token). Render `<OnboardAgentCard />` at the top
of the page **only when there is no `initialToken`** (i.e., the base register page), so the
deep-link verify page (owner mid-verify) stays focused on verification.

```tsx
{!initialToken && <OnboardAgentCard />}
```

(placed just under the page heading/intro, above the "1 · Registration token" section.)

## Data flow

1. User opens `/agents/register`, sees the OnboardAgentCard, types a name + description.
2. The prompt updates live with those values and `<origin>/skill.md`.
3. User clicks **Copy prompt** → clipboard holds the prompt → pastes into their AI agent.
4. The agent fetches `<origin>/skill.md`, follows it (runs `register.mjs` or the manual
   protocol) to POST `/api/register`, and returns the `registrationLink`.
5. The user (or agent) opens that link → existing verify page → identity issued.

## Error handling

- `/skill.md` route: 404 with a plain message if the file can't be read.
- Card: if `navigator.clipboard` is unavailable, fall back to selecting the textarea
  content (or show the prompt for manual copy); never throw.
- SSR safety: `window`/`navigator` accessed only after mount (in handlers/`useEffect`),
  so no hydration mismatch.

## Testing / verification

No test runner; verification is `npm run build` + a dev-server check:
- `curl -s -i http://localhost:3000/skill.md` → 200, `content-type: text/markdown…`, body
  is the `agent-skill/SKILL.md` content.
- On `/agents/register`: the card renders; editing name/description updates the prompt; the
  prompt contains `http://localhost:3000/skill.md`; Copy works (no console error).
- On `/agents/register/<token>`: the card is absent; the verify flow is unchanged.
- No hydration warnings.

## Files

- New: `app/skill.md/route.ts`, `app/agents/register/OnboardAgentCard.tsx`.
- Edit: `app/agents/register/RegisterAgentFlow.tsx` (mount the card when `!initialToken`).

## Risks / notes

- Non-standard Next.js 16.2.7 (`AGENTS.md`); a GET route handler + a client component are
  standard App Router (low risk). A route segment folder named `skill.md` (with a dot) is a
  valid path segment.
- The `/skill.md` route reads from `process.cwd()`; this is fine for `next dev`/`next start`
  from the repo root (our local/self-hosted scope). If later deployed to a bundler that
  doesn't include source files, switch to a static `public/skill.md` or inlined content.
- The served `SKILL.md` references `agent-skill/register.mjs` (a repo path); its "Protocol"
  section is self-contained for web agents without the repo. Making the web copy fully
  script-free is a possible later refinement, out of scope here.
