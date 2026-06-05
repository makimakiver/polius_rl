import type { EnvStatus } from "../data/environments";

const fill: Record<EnvStatus, string> = {
  Training: "bg-accent",
  Evaluating: "bg-ink/50",
  Idle: "bg-transparent border border-ink/40",
};

export default function StatusPill({ status }: { status: EnvStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink/60">
      <span className={`h-1.5 w-1.5 rounded-full ${fill[status]}`} />
      {status}
    </span>
  );
}
