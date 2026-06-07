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
      {/* sparkline stroke — also used as the motion-path guide for .al-spark-dot */}
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
