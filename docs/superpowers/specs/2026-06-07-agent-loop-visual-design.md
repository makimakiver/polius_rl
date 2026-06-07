# AgentLoopVisual — RL feedback-loop hero animation

**Date:** 2026-06-07
**Status:** Approved (brainstorming)
**Author:** brainstorming session

## Summary

Add an eye-catching, on-brand animation to the **top of the dashboard** (`app/page.tsx`)
that literally depicts the reinforcement-learning feedback loop at the heart of Pollius:
an **agent** acts in an **environment**, receives an **observation + reward**, and adapts.
The animation reinforces the product's core idea ("a marketplace of RL environments and the
Hermes agents that learn in them") in the first thing a visitor sees.

The visual is a new self-contained client component, `AgentLoopVisual`, built with SVG +
anime.js v4, mounted beside the existing hero copy in a two-column layout.

## Goals

- Visualize the agent ↔ environment loop clearly and literally (not abstractly).
- Read as eye-catching but stay within the existing minimalist / blueprint-grid aesthetic.
- Be fully self-contained, decorative, and SSR-safe (deterministic geometry, no live data).
- Respect `prefers-reduced-motion`.

## Non-goals (YAGNI)

- No real on-chain or live telemetry data wiring. The reward numbers/curve are decorative.
- No interactivity, hover controls, or play/pause UI.
- No configuration props beyond an optional `className` for sizing.
- No changes to `PoliusOrbitVisual` (it remains untouched; this is a separate component).

## Placement & layout

- The existing hero `<section>` in `app/page.tsx` becomes a **two-column grid**:
  - **Left:** existing eyebrow ("Agentic RL · on Sui"), `<h1>`, description, and the
    `DeployButton` / "Browse environments" CTAs — unchanged copy.
  - **Right:** the new `<AgentLoopVisual />`.
- Responsive: single column on small screens; the visual renders **below** the text with a
  capped height. It is not hidden on mobile (it is the requested centerpiece), but it is
  height-constrained to avoid pushing content down excessively.
- Grid breakpoint mirrors existing dashboard usage (e.g. `lg:grid-cols-[...]`), matching the
  page's existing Tailwind v4 conventions.

## Component: `app/components/AgentLoopVisual.tsx`

- `"use client"` component, no required props; optional `className?: string`.
- Single responsibility: render the animated RL loop. No dependence on app data, so it can be
  understood, viewed, and tested in isolation. Sole consumer is the hero in `app/page.tsx`.
- Follows the established patterns in `app/components/PoliusOrbitVisual.tsx`:
  - Deterministic, rounded geometry helpers (e.g. a `r2()` round-to-2dp) so server and client
    render identical markup (SSR-safe — avoids hydration mismatches).
  - `createScope({ root })` driven from a `useRef`, with `scope.revert()` in the effect cleanup.
  - anime.js v4 API: `animate`, `stagger`, `svg` (`svg.createDrawable`, `svg.createMotionPath`),
    `createScope` — imported from `"animejs"`.

### Static structure (SVG)

- A faint blueprint-grid backdrop consistent with the app's technical look (subtle, low opacity).
- Two rounded-rectangle nodes:
  - **`AGENT`** — left.
  - **`ENVIRONMENT`** — right.
  - Labels in Geist Mono, uppercase, `text-ink`.
- Two curved connector paths forming a closed loop:
  - **Top arc:** `AGENT → ENVIRONMENT`, labeled `action` (mono, `ink/50`).
  - **Bottom arc:** `ENVIRONMENT → AGENT`, labeled `observation · reward` (mono, `ink/50`).
- A **reward readout** near the loop: a Geist Mono counter (`reward <n>`) plus a small
  5–6 point sparkline that grows as cycles complete.

### Palette

Strictly on-brand, matching `PoliusOrbitVisual` and `globals.css`:

- Structure strokes: `#5b6573` / ink tones.
- Motion + glow: accent `#2b93f0` and lighter tints `#6aa9ff`, `#cfe3ff`.
- Background grid: ink at very low opacity (e.g. `rgba(21,23,28,0.045)` per existing console pages).

### Motion (anime.js v4)

1. **Reveal (plays once on mount):**
   - Nodes fade + scale in.
   - The two arcs draw on via `svg.createDrawable` + `draw: ["0 0", "0 1"]`.
   - Labels stagger in with `stagger(60)`.
   - ~1.3s total, matching the orbit component's reveal feel.
2. **Loop (continuous):**
   - An accent **action packet** (small dot/dash) travels `AGENT → ENVIRONMENT` along the top
     arc using `svg.createMotionPath`.
   - On arrival, the `ENVIRONMENT` node pulses.
   - A **reward packet** travels back `ENVIRONMENT → AGENT` along the bottom arc.
   - On arrival, the `AGENT` node pulses, the **reward counter ticks up**, and the
     **sparkline advances one step**.
   - The counter/sparkline cycle through a **fixed, deterministic, monotonically rising**
     sequence so the loop reads as "learning." When the sequence completes it restarts (or
     holds), keeping motion continuous.
   - ~2.5–3s per full cycle.
3. **Ambient:** a soft accent glow breathing on the arcs, reusing the `inOutSine` looping
   opacity pattern from the orbit component.

### Reduced motion

- Guard inside the `useEffect`: when `window.matchMedia("(prefers-reduced-motion: reduce)")`
  matches, render the fully-revealed static loop (final reward value shown) and skip the
  continuous packets / counter animation.

## Data

- Purely decorative and deterministic. The reward values and sparkline points are a fixed
  seeded array defined in-module. No `Math.random`, no `Date.now`, no network — consistent
  with the repo's SSR-safe conventions. The numbers *represent* training; they are not live.

## Files touched

- **New:** `app/components/AgentLoopVisual.tsx`
- **Edit:** `app/page.tsx` — restructure the hero `<section>` into the two-column layout and
  mount `<AgentLoopVisual />`. No copy changes.

## Testing / verification

- Visual check via the running dev app (the `run` / webapp-testing flow): hero shows the loop
  side-by-side with the text on desktop; stacks on mobile; reveal plays once; packets cycle;
  reward counter ticks and sparkline grows.
- Confirm no hydration warnings in the console (validates SSR-safe deterministic geometry).
- Confirm `prefers-reduced-motion` shows the static, fully-revealed loop with no looping motion.
- Confirm the existing hero copy and CTAs remain intact and functional.

## Risks / notes

- This Next.js (16.2.7) is a modified build with breaking changes (per `AGENTS.md`); consult
  `node_modules/next/dist/docs/` before introducing any new framework-level patterns. This
  feature is component-level (client component + Tailwind), so risk is low, but the warning applies.
- Tailwind v4 is in use — match existing utility conventions rather than introducing config.
- anime.js v4 motion-path / drawable APIs are already proven in `PoliusOrbitVisual.tsx`; reuse
  those exact import + scope patterns to stay consistent and SSR-safe.
