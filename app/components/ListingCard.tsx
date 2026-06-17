import Link from "next/link";
import Sparkline from "./Sparkline";
import { StatusDot } from "./StatusPill";
import {
  type Listing,
  maxVersion,
  passCurve,
  passPct,
  versionAt,
} from "../data/market";

/** A deployed inference model, summarized. Clicking opens its detail page. */
export default function ListingCard({ listing }: { listing: Listing }) {
  const model = versionAt(listing, listing.currentVersion);
  const curve = passCurve(listing, listing.currentVersion);
  const training = listing.currentVersion < maxVersion(listing);

  return (
    <Link
      href={`/market/${listing.id}`}
      className="group flex flex-col rounded-lg border border-ink/15 p-5 transition-colors hover:border-accent/40 hover:bg-accent/[0.03]"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-medium">{listing.modelName}</div>
          <div className="mt-0.5 font-mono text-[11px] text-ink/45">{listing.task}</div>
        </div>
        <StatusDot
          label={training ? "training" : "stable"}
          dotClass={training ? "bg-accent" : "bg-ink/40"}
        />
      </div>

      <div className="mt-4">
        <Sparkline data={curve.length > 1 ? curve : [...curve, ...curve]} height={48} className="text-accent" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-[11px]">
        <div>
          <div className="text-base text-ink">v{model.v}</div>
          <div className="text-ink/40">version</div>
        </div>
        <div>
          <div className="text-base text-accent">{passPct(model.passRateBps)}</div>
          <div className="text-ink/40">pass rate</div>
        </div>
        <div>
          <div className="text-base text-ink">{listing.priceSui}</div>
          <div className="text-ink/40">SUI / call</div>
        </div>
      </div>

      {/* verifier: on-chain (PnL) vs off-chain (Lean) — a property of the model */}
      <div className="mt-4">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] ${
            listing.verifier.kind === "onchain"
              ? "border-accent/40 bg-accent/[0.08] text-accent"
              : "border-ink/20 bg-white/50 text-ink/60"
          }`}
          title={listing.verifier.detail}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              listing.verifier.kind === "onchain" ? "bg-accent" : "bg-ink/40"
            }`}
          />
          {listing.verifier.kind === "onchain" ? "on-chain verifier" : "off-chain verifier"} ·{" "}
          {listing.verifier.name}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-ink/10 pt-3 font-mono text-[11px] text-ink/40">
        <span>{listing.totalCalls.toLocaleString()} calls</span>
        <span className="text-accent opacity-0 transition-opacity group-hover:opacity-100">
          view inference →
        </span>
      </div>
    </Link>
  );
}
