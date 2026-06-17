import type { Verifier } from "../data/market";

/**
 * Shows how THIS model is graded — by an on-chain or off-chain verifier. The kind
 * is a property of the model's environment, not a split within one inference:
 *   off-chain → Lean (compiler verdict, no on-chain activity)
 *   on-chain  → DeFi PnL (realized return settled on Sui)
 * Marketplace settlement (payment + registry) is on Sui either way.
 */
export default function VerifierPanel({
  verifier,
  envName,
}: {
  verifier: Verifier;
  envName: string;
}) {
  const onchain = verifier.kind === "onchain";

  const kinds = [
    {
      kind: "offchain" as const,
      title: "Off-chain verifier",
      example: "Lean theorem proving — the lake compiler accepts/rejects the proof 0/1. No on-chain activity to grade it.",
    },
    {
      kind: "onchain" as const,
      title: "On-chain verifier",
      example: "DeFi trading — realized PnL after gas + slippage, settled on Sui. The chain itself is the verifier.",
    },
  ];

  return (
    <section className="mt-6 rounded-lg border border-ink/15 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide">Verifier</h2>
        <span className="font-mono text-[11px] text-ink/40">how this model is graded</span>
      </div>

      {/* active classification */}
      <div
        className={`rounded-md border p-4 ${
          onchain ? "border-accent/40 bg-accent/[0.06]" : "border-ink/20 bg-white/50"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${onchain ? "bg-accent" : "bg-ink/45"}`} />
          <span className={`font-mono text-sm font-medium ${onchain ? "text-accent" : "text-ink/80"}`}>
            {onchain ? "On-chain verifier" : "Off-chain verifier"} · {verifier.name}
          </span>
        </div>
        <p className="mt-1.5 font-mono text-[11px] leading-5 text-ink/55">{verifier.detail}</p>
        <p className="mt-1 font-mono text-[10px] text-ink/40">environment: {envName}</p>
      </div>

      {/* the two kinds (active one emphasized) */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {kinds.map((k) => {
          const active = k.kind === verifier.kind;
          return (
            <div
              key={k.kind}
              className={`rounded-md border px-3 py-2.5 ${
                active ? "border-ink/25" : "border-dashed border-ink/15 opacity-55"
              }`}
            >
              <div className="font-mono text-[11px] font-medium text-ink/75">
                {k.title} {active && <span className="text-accent">· this model</span>}
              </div>
              <p className="mt-0.5 font-mono text-[10px] leading-4 text-ink/50">{k.example}</p>
            </div>
          );
        })}
      </div>

      <p className="mt-3 font-mono text-[10px] text-ink/40">
        Either way, marketplace settlement (payment + ModelRegistry) is on Sui, and adapters +
        attestations live on Walrus. Only the <span className="text-ink/60">verifier</span> moves
        on/off chain with the task.
      </p>
    </section>
  );
}
