# AgentLoopVisual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an eye-catching, on-brand SVG/anime.js animation to the top of the dashboard hero that depicts the RL feedback loop (AGENT → action → ENVIRONMENT → observation·reward → AGENT) with a reward counter and sparkline that climb.

**Architecture:** A new self-contained `"use client"` component, `AgentLoopVisual`, renders a deterministic (SSR-safe) SVG of two labeled nodes joined by two curved arcs forming a loop. anime.js v4 reveals the structure once (draw-on + stagger), then runs a continuous `createTimeline` cycle: an accent packet rides the top arc, the ENVIRONMENT node pulses, a reward packet rides the bottom arc, the AGENT node pulses, and a reward counter + sparkline marker climb. It's mounted beside the existing hero copy in a two-column grid. Respects `prefers-reduced-motion`.

**Tech Stack:** Next.js 16.2.7 (modified — see `AGENTS.md`), React 19, Tailwind CSS v4, anime.js v4 (`animejs ^4.4.1`). No test runner exists; verification is typecheck/lint/build + visual confirmation in the dev app.

---

## Why no unit tests

There is no test runner in `package.json` and the component is a decorative animation with no business logic worth isolating (its only "logic" is pure, deterministic geometry computed at module load). Adding a test harness would be YAGNI. Verification = `npm run lint`, `npm run build` (Next runs type-checking during build), and visual confirmation in `npm run dev`, including the reduced-motion branch and absence of hydration warnings. This matches the existing `PoliusOrbitVisual.tsx`, which also ships untested.

## File structure

- **Create:** `app/components/AgentLoopVisual.tsx` — the entire animated loop. One responsibility, no app-data dependencies, viewable in isolation. Mirrors the proven patterns in `app/components/PoliusOrbitVisual.tsx` (deterministic rounded geometry, `createScope({ root })` + `scope.revert()` cleanup, anime.js v4 imports).
- **Modify:** `app/page.tsx` — restructure the hero `<section>` (currently lines ~46–64) into a two-column grid and mount `<AgentLoopVisual />`. No copy changes.

---

## Task 1: Create the `AgentLoopVisual` component

**Files:**
- Create: `app/components/AgentLoopVisual.tsx`

- [ ] **Step 1: Write the complete component**

Create `app/components/AgentLoopVisual.tsx` with exactly this content:

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { animate, stagger, svg, createScope, createTimeline } from "animejs";

/* ---- deterministic geometry (rounded → SSR-safe, no Date/Math.random) ---- */
const r2 = (n: number) => Math.round(n * 100) / 100;

// node centers: AGENT (130,180) and ENVIRONMENT (470,180) in a 600x360 viewBox
const TOP = "M205 150 C 268 80 332 80 395 150"; // agent -> env (action)
const BOT = "M395 210 C 332 280 268 280 205 210"; // env -> agent (observation·reward)

// reward curve for the sparkline (deterministic, rising → reads as "learning")
const CURVE = [6, 9, 8, 14, 19, 23, 28, 34];
const REWARD_TARGET = 1284;

// sparkline geometry, centered inside the loop
const SP = { x: 252, y: 176, w: 96, h: 26 };
const SPARK_PATH = (() => {
  const min = Math.min(...CURVE);
  const span = Math.max(...CURVE) - min || 1;
  return CURVE.map((v, i) => {
    const x = r2(SP.x + (i / (CURVE.length - 1)) * SP.w);
    const y = r2(SP.y + SP.h - ((v - min) / span) * SP.h);
    return `${i ? "L" : "M"}${x} ${y}`;
  }).join(" ");
})();

// faint blueprint grid (deterministic arrays)
const GRID_X = Array.from({ length: 16 }, (_, i) => i * 40); // 0..600
const GRID_Y = Array.from({ length: 10 }, (_, i) => i * 40); // 0..360

const agentPivot: CSSProperties = { transformBox: "view-box", transformOrigin: "130px 180px" };
const envPivot: CSSProperties = { transformBox: "view-box", transformOrigin: "470px 180px" };

const monoLabel = (size: number, fill: string, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
  fontSize: size,
  fill,
  ...extra,
});

/**
 * The Pollius RL feedback loop: an agent acts in an environment, receives an
 * observation + reward, and adapts. anime.js v4. Decorative + deterministic.
 */
export default function AgentLoopVisual({ className }: { className?: string }) {
  const root = useRef<SVGSVGElement>(null);
  const scope = useRef<ReturnType<typeof createScope> | null>(null);

  useEffect(() => {
    if (!root.current) return;
    const counter = root.current.querySelector<SVGTextElement>(".al-count");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    scope.current = createScope({ root }).add(() => {
      // reduced motion: show the fully-revealed static loop, no looping motion
      if (reduce) {
        root.current!.style.opacity = "1";
        root.current!
          .querySelectorAll<SVGElement>(".al-fade")
          .forEach((el) => (el.style.opacity = "1"));
        if (counter) counter.textContent = `reward ${REWARD_TARGET.toLocaleString()}`;
        return;
      }

      // reveal (plays once)
      animate(root.current!, { opacity: [0, 1], duration: 400, ease: "outQuad" });
      const drawables = svg.createDrawable(".al-draw");
      animate(drawables, { draw: ["0 0", "0 1"], duration: 1100, delay: stagger(50), ease: "inOutSine" });
      animate(".al-fade", { opacity: [0, 1], duration: 700, delay: 700, ease: "outQuad" });

      // ambient glow breathing on the arcs
      animate(".al-glow", { opacity: [0.3, 0.8, 0.3], duration: 3200, ease: "inOutSine", loop: true, delay: 900 });

      // continuous loop
      const top = svg.createMotionPath("#al-top");
      const bot = svg.createMotionPath("#al-bot");
      const spark = svg.createMotionPath("#al-spark");
      const reward = { v: 0 };

      createTimeline({ loop: true, defaults: { ease: "inOutSine" } })
        .add(".al-action", { ...top, opacity: [0, 1, 1, 0], duration: 1100 }, 0)
        .add(".al-env-node", { scale: [1, 1.06, 1], duration: 420 }, 1000)
        .add(".al-reward-pkt", { ...bot, opacity: [0, 1, 1, 0], duration: 1100 }, 1250)
        .add(".al-agent-node", { scale: [1, 1.05, 1], duration: 420 }, 2250)
        .add(".al-spark-dot", { ...spark, opacity: [0, 1], duration: 2300 }, 0)
        .add(
          reward,
          {
            v: REWARD_TARGET,
            duration: 2300,
            onUpdate: () => {
              if (counter) counter.textContent = `reward ${Math.round(reward.v).toLocaleString()}`;
            },
          },
          0
        );
    });

    return () => scope.current?.revert();
  }, []);

  return (
    <svg
      ref={root}
      viewBox="0 0 600 360"
      className={`h-auto w-full ${className ?? ""}`}
      style={{ opacity: 0 }}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <filter id="alGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* blueprint backdrop */}
      <g stroke="rgba(21,23,28,0.05)" strokeWidth={1}>
        {GRID_X.map((x) => (
          <line key={`gx${x}`} x1={x} y1={0} x2={x} y2={360} />
        ))}
        {GRID_Y.map((y) => (
          <line key={`gy${y}`} x1={0} y1={y} x2={600} y2={y} />
        ))}
      </g>

      {/* connector arcs (structure) */}
      <g stroke="#5b6573" strokeOpacity={0.5} strokeLinecap="round">
        <path id="al-top" className="al-draw" d={TOP} strokeWidth={1.4} />
        <path id="al-bot" className="al-draw" d={BOT} strokeWidth={1.4} />
      </g>

      {/* arc glow (accent, breathing) */}
      <g className="al-glow" strokeLinecap="round" style={{ opacity: 0 }}>
        <path d={TOP} stroke="#6aa9ff" strokeOpacity={0.55} strokeWidth={5} filter="url(#alGlow)" />
        <path d={BOT} stroke="#6aa9ff" strokeOpacity={0.55} strokeWidth={5} filter="url(#alGlow)" />
      </g>

      {/* direction arrows */}
      <g className="al-fade" fill="#2b93f0" stroke="none" style={{ opacity: 0 }}>
        <polygon points="384,144 396,150 384,156" />
        <polygon points="216,204 204,210 216,216" />
      </g>

      {/* arc labels */}
      <text className="al-fade" x={300} y={66} textAnchor="middle" style={{ ...monoLabel(11, "rgba(21,23,28,0.5)", { letterSpacing: "1px" }), opacity: 0 }}>
        action
      </text>
      <text className="al-fade" x={300} y={302} textAnchor="middle" style={{ ...monoLabel(11, "rgba(21,23,28,0.5)", { letterSpacing: "1px" }), opacity: 0 }}>
        observation · reward
      </text>

      {/* reward readout in the heart of the loop */}
      <text className="al-fade al-count" x={300} y={160} textAnchor="middle" style={{ ...monoLabel(13, "#15171c"), opacity: 0 }}>
        reward 0
      </text>
      <path id="al-spark" className="al-draw" d={SPARK_PATH} stroke="#2b93f0" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />

      {/* AGENT node */}
      <g className="al-agent-node" style={agentPivot}>
        <rect className="al-draw" x={55} y={140} width={150} height={80} rx={10} stroke="#15171c" strokeOpacity={0.7} strokeWidth={1.4} fill="#f1f3f6" />
        <text className="al-fade" x={130} y={176} textAnchor="middle" style={{ ...monoLabel(15, "#15171c"), opacity: 0 }}>
          AGENT
        </text>
        <text className="al-fade" x={130} y={196} textAnchor="middle" style={{ ...monoLabel(9, "rgba(21,23,28,0.45)", { letterSpacing: "2px" }), opacity: 0 }}>
          HERMES
        </text>
      </g>

      {/* ENVIRONMENT node */}
      <g className="al-env-node" style={envPivot}>
        <rect className="al-draw" x={395} y={140} width={150} height={80} rx={10} stroke="#15171c" strokeOpacity={0.7} strokeWidth={1.4} fill="#f1f3f6" />
        <text className="al-fade" x={470} y={176} textAnchor="middle" style={{ ...monoLabel(14, "#15171c"), opacity: 0 }}>
          ENVIRONMENT
        </text>
        <text className="al-fade" x={470} y={196} textAnchor="middle" style={{ ...monoLabel(9, "rgba(21,23,28,0.45)", { letterSpacing: "2px" }), opacity: 0 }}>
          RL · SUI
        </text>
      </g>

      {/* moving packets (start hidden; positioned onto paths by motion-path) */}
      <circle className="al-action" r={3.5} fill="#2b93f0" style={{ opacity: 0 }} />
      <circle className="al-reward-pkt" r={3.5} fill="#6aa9ff" style={{ opacity: 0 }} />
      <circle className="al-spark-dot" r={2.6} fill="#2b93f0" style={{ opacity: 0 }} />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck + lint the new file**

Run: `npm run lint`
Expected: PASS with no errors for `app/components/AgentLoopVisual.tsx` (warnings unrelated to this file are acceptable).

If `animejs` has no `createTimeline` export at this version, run `node -e "console.log(Object.keys(require('animejs')))"` to confirm the export name and adjust the import accordingly (it is a named export in anime.js v4).

- [ ] **Step 3: Commit**

```bash
git add app/components/AgentLoopVisual.tsx
git commit -m "feat: add AgentLoopVisual RL feedback-loop animation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Mount it in the dashboard hero (two-column layout)

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Import the component**

In `app/page.tsx`, add this import alongside the existing component imports near the top (after the `DeployButton` import on line ~5):

```tsx
import AgentLoopVisual from "./components/AgentLoopVisual";
```

- [ ] **Step 2: Restructure the hero `<section>` into a two-column grid**

Replace the entire existing hero section (currently lines ~46–64):

```tsx
        {/* Hero */}
        <section className="py-14 sm:py-20">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.25em] text-ink/50">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Agentic RL · on Sui
          </p>
          <h1 className="mt-4 max-w-2xl text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
            Train, deploy &amp; reward autonomous agents on-chain.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-ink/60">
            A marketplace of RL environments and the Hermes agents that learn in them.
            Connect your Sui wallet to deploy, train, and claim rewards.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <DeployButton>Deploy environment</DeployButton>
            <Link href="/environments" className="text-sm text-ink/60 underline-offset-4 hover:text-accent hover:underline">
              Browse environments →
            </Link>
          </div>
        </section>
```

with this:

```tsx
        {/* Hero */}
        <section className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.25em] text-ink/50">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Agentic RL · on Sui
            </p>
            <h1 className="mt-4 max-w-2xl text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
              Train, deploy &amp; reward autonomous agents on-chain.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-ink/60">
              A marketplace of RL environments and the Hermes agents that learn in them.
              Connect your Sui wallet to deploy, train, and claim rewards.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <DeployButton>Deploy environment</DeployButton>
              <Link href="/environments" className="text-sm text-ink/60 underline-offset-4 hover:text-accent hover:underline">
                Browse environments →
              </Link>
            </div>
          </div>
          <AgentLoopVisual className="max-w-xl justify-self-center lg:justify-self-end" />
        </section>
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS (no new errors).

- [ ] **Step 4: Build (typecheck + production compile gate)**

Run: `npm run build`
Expected: Build completes successfully with no TypeScript errors and no errors referencing `AgentLoopVisual` or `app/page.tsx`.

If the modified Next.js build flags anything framework-specific, consult `node_modules/next/dist/docs/` per `AGENTS.md` before changing the approach.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: mount AgentLoopVisual in dashboard hero

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Visual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts (typically on http://localhost:3000).

- [ ] **Step 2: Verify the animation on desktop width**

Open the dashboard. Confirm:
- The hero shows the headline + Deploy CTA on the left and the animated loop on the right.
- On load: the grid/arcs/nodes draw on, labels fade in (reveal plays once).
- Continuously: an accent dot travels AGENT→ENVIRONMENT along the top arc; the ENVIRONMENT node pulses; a lighter dot returns ENVIRONMENT→AGENT along the bottom arc; the AGENT node pulses; the `reward` number climbs and a dot rides the sparkline.
- Colors match the app (ink structure, `#2b93f0` accent motion). No layout overflow.

- [ ] **Step 3: Verify responsive (mobile) width**

Narrow the viewport (or use devtools device mode). Confirm the visual stacks below the text, stays within width, and is not clipped.

- [ ] **Step 4: Verify no hydration warnings**

Check the browser console and the dev-server terminal. Expected: no hydration mismatch warnings (validates the deterministic SSR-safe geometry).

- [ ] **Step 5: Verify reduced motion**

Enable "Reduce motion" at the OS level (or emulate it in browser devtools: Rendering → "Emulate CSS prefers-reduced-motion"), reload. Expected: the loop renders fully revealed and static — nodes, arcs, labels, sparkline, and the final `reward 1,284` all visible — with no traveling packets or counting.

- [ ] **Step 6: Stop the dev server.**

---

## Self-review notes

- **Spec coverage:** placement/two-column hero (Task 2) ✓; new self-contained component mirroring PoliusOrbitVisual patterns (Task 1) ✓; static structure with AGENT/ENVIRONMENT nodes, two arcs, action + observation·reward labels, reward counter + sparkline (Task 1 markup) ✓; on-brand palette ✓; reveal + continuous loop motion via anime.js v4 (Task 1 effect) ✓; reduced-motion guard (Task 1 effect, Task 3 Step 5) ✓; deterministic decorative data, no live wiring (module-level `CURVE`/`REWARD_TARGET`, no `Math.random`/`Date.now`) ✓; verification incl. no hydration warnings (Task 3) ✓.
- **No placeholders:** every code step contains complete, runnable content.
- **Naming consistency:** class hooks (`al-draw`, `al-fade`, `al-glow`, `al-count`, `al-action`, `al-reward-pkt`, `al-spark-dot`) and path ids (`al-top`, `al-bot`, `al-spark`) referenced in the effect all exist in the JSX markup.
```
