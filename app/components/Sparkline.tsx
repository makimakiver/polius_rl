interface SparklineProps {
  /** Values normalized to 0..1. */
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Tailwind text-* color drives the stroke via currentColor. */
  strokeWidth?: number;
  fill?: boolean;
}

export default function Sparkline({
  data,
  width = 220,
  height = 56,
  className = "text-cyan-400",
  strokeWidth = 2,
  fill = true,
}: SparklineProps) {
  if (data.length === 0) return null;

  const pad = strokeWidth;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - Math.max(0, Math.min(1, v))) * innerH;
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${
    height - pad
  } L${points[0][0].toFixed(1)},${height - pad} Z`;

  const gradientId = `spark-${data.length}-${Math.round(data[0] * 1000)}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`${className} w-full`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Reward curve"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gradientId})`} stroke="none" />}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
