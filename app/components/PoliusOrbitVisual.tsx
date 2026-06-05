"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { animate, stagger, svg, createScope } from "animejs";

/* ---- geometry helpers (deterministic, rounded → SSR-safe) ---- */
const VC = 500; // center
const R = 220; // ring radius (small, fully visible)
const r2 = (n: number) => Math.round(n * 100) / 100;
const P = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [r2(VC + r * Math.cos(a)), r2(VC + r * Math.sin(a))];
};
const arc = (r: number, a0: number, a1: number) => {
  const [x0, y0] = P(r, a0);
  const [x1, y1] = P(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
};

// three rays, exactly 120° apart
const RAYS = [210, 330, 90];
// segmented ring (black)
const RING = [
  [34, 116],
  [140, 200],
  [218, 300],
  [318, 372],
] as const;
const INNER = [
  [40, 108],
  [222, 296],
  [326, 366],
] as const;
const NOTCHES = [116, 140, 200, 300];
// blue glow on the ring — strictly subsets of the black arcs above
const GLOW = [
  [44, 104],
  [150, 192],
  [226, 290],
  [330, 366],
] as const;

const RAY_OUT = 470; // light reaches outward (inside viewBox → no clipping)

const pivot: CSSProperties = {
  transformBox: "view-box",
  transformOrigin: "500px 500px",
};

/**
 * Detailed HUD ring (SVG). Blue light sits only on the black lines (ring arcs +
 * rays), is emitted outward along the three 120°-spaced rays, and the ring
 * rotates anti-clockwise while the light rotates clockwise. anime.js v4.
 */
export default function PoliusOrbitVisual() {
  const root = useRef<SVGSVGElement>(null);
  const scope = useRef<ReturnType<typeof createScope> | null>(null);

  useEffect(() => {
    if (!root.current) return;
    scope.current = createScope({ root }).add(() => {
      animate(root.current!, { opacity: [0, 1], duration: 400, ease: "outQuad" });

      const drawables = svg.createDrawable(".l-draw");
      animate(drawables, { draw: ["0 0", "0 1"], duration: 1300, delay: stagger(60), ease: "inOutSine" });

      animate(".l-fade", { opacity: [0, 1], duration: 700, delay: 900, ease: "outQuad" });

      animate(".l-glow", { opacity: [0, 1], duration: 800, delay: 1100, ease: "outQuad" });
      animate(".l-glow", { opacity: [1, 0.45, 1], duration: 3400, delay: 1900, ease: "inOutSine", loop: true });

      // light emitted outward along the rays
      animate(".l-rayflow", {
        strokeDashoffset: [100, 0],
        duration: 1700,
        delay: 1100,
        ease: "inOutSine",
        loop: true,
      });

      // counter-rotation: ring anti-clockwise, light clockwise
      animate(".l-ring", { rotate: [0, -360], duration: 95000, ease: "linear", loop: true });
      animate(".l-light", { rotate: [0, 360], duration: 72000, ease: "linear", loop: true });
    });
    return () => scope.current?.revert();
  }, []);

  return (
    <svg
      ref={root}
      viewBox="0 0 1000 1000"
      className="polius-visual hidden sm:block"
      style={{ opacity: 0 }}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <filter id="ringGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* THE CIRCLE — black ring, rotates anti-clockwise (blue glow rides its arcs) */}
      <g className="l-ring" style={pivot}>
        <g stroke="#5b6573" strokeOpacity={0.6} strokeLinecap="round">
          {RING.map((s, i) => (
            <path key={`r${i}`} className="l-draw" d={arc(R, s[0], s[1])} strokeWidth={1.4} />
          ))}
          {INNER.map((s, i) => (
            <path key={`i${i}`} className="l-draw" d={arc(R - 12, s[0], s[1])} strokeWidth={1} strokeOpacity={0.4} />
          ))}
          {NOTCHES.map((a, i) => {
            const [x0, y0] = P(R, a);
            const [x1, y1] = P(R + 14, a);
            return <path key={`n${i}`} className="l-draw" d={`M${x0} ${y0} L${x1} ${y1}`} strokeWidth={1.2} />;
          })}
        </g>

        {/* decorative tick dots */}
        <g className="l-fade" fill="#4b5563" stroke="none" style={{ opacity: 0 }}>
          {[270, 90].map((a, i) => {
            const [x, y] = P(R + 22, a);
            return <circle key={`d${i}`} cx={x} cy={y} r={3} fillOpacity={0.5} />;
          })}
        </g>

        {/* blue glow — only on the black ring arcs */}
        <g className="l-glow" style={{ opacity: 0 }} strokeLinecap="round">
          {GLOW.map((s, i) => (
            <g key={`g${i}`}>
              <path d={arc(R, s[0], s[1])} stroke="#6aa9ff" strokeOpacity={0.55} strokeWidth={6} filter="url(#ringGlow)" />
              <path d={arc(R, s[0], s[1])} stroke="#bcd6ff" strokeWidth={1.6} />
            </g>
          ))}
        </g>
      </g>

      {/* THE LIGHT — three rays 120° apart, emitted outward; rotates clockwise */}
      <g className="l-light" style={pivot}>
        {/* black ray lines + node squares */}
        <g stroke="#5b6573" strokeOpacity={0.55} strokeLinecap="round">
          {RAYS.map((a, i) => {
            const [x0, y0] = P(R, a);
            const [x1, y1] = P(RAY_OUT, a);
            return <path key={`ray${i}`} className="l-draw" d={`M${x0} ${y0} L${x1} ${y1}`} strokeWidth={1} />;
          })}
        </g>
        <g className="l-fade" fill="#4b5563" stroke="none" style={{ opacity: 0 }}>
          {RAYS.map((a, i) => {
            const [x, y] = P(R, a);
            return <rect key={i} x={x - 6} y={y - 6} width={12} height={12} />;
          })}
        </g>

        {/* blue light — only on the black rays, emitted outward */}
        <g className="l-glow" style={{ opacity: 0 }} strokeLinecap="round">
          {RAYS.map((a, i) => {
            const [x0, y0] = P(R, a);
            const [x1, y1] = P(RAY_OUT, a);
            const d = `M${x0} ${y0} L${x1} ${y1}`;
            return (
              <g key={`rf${i}`}>
                <path d={d} stroke="#6aa9ff" strokeOpacity={0.4} strokeWidth={4} filter="url(#ringGlow)" />
                <path
                  className="l-rayflow"
                  d={d}
                  pathLength={100}
                  strokeDasharray="30 70"
                  stroke="#cfe3ff"
                  strokeWidth={1.6}
                />
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
}
