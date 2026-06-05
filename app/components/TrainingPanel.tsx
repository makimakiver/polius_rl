"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import Sparkline from "./Sparkline";
import StatusPill from "./StatusPill";
import type { RlEnvironment } from "../data/environments";

const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export default function TrainingPanel({ env }: { env: RlEnvironment }) {
  const account = useCurrentAccount();
  const [running, setRunning] = useState(env.status === "Training");
  const [episodes, setEpisodes] = useState(env.episodes);
  const [reward, setReward] = useState(env.reward);
  const [successRate, setSuccessRate] = useState(env.successRate);
  const [curve, setCurve] = useState<number[]>(env.rewardCurve);
  const lastRef = useRef(env.rewardCurve[env.rewardCurve.length - 1] ?? 0.5);

  // Simulate a live training loop while running.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setEpisodes((e) => e + Math.round(40 + Math.random() * 120));
      setReward((r) => r + Math.random() * 60);
      setSuccessRate((s) => Math.min(0.99, s + (Math.random() - 0.35) * 0.01));
      setCurve((c) => {
        const next = Math.max(
          0,
          Math.min(1, lastRef.current + (Math.random() - 0.4) * 0.12)
        );
        lastRef.current = next;
        return [...c.slice(-40), next];
      });
    }, 900);
    return () => clearInterval(id);
  }, [running]);

  const status = running ? "Training" : env.status === "Training" ? "Idle" : env.status;

  const metrics = [
    { label: "reward", value: `${compactFmt.format(reward)} SUI` },
    { label: "episodes", value: compactFmt.format(episodes) },
    { label: "success", value: `${(successRate * 100).toFixed(1)}%` },
  ];

  return (
    <div className="border border-ink/15 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide">Training console</h2>
          <StatusPill status={status} />
        </div>

        <button
          type="button"
          disabled={!account}
          onClick={() => setRunning((r) => !r)}
          className={`rounded-full border border-ink px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
            running
              ? "bg-transparent text-ink hover:bg-ink hover:text-background"
              : "bg-ink text-background hover:bg-transparent hover:text-ink"
          }`}
        >
          {running ? "■ stop" : "▶ start"}
        </button>
      </div>

      {!account && (
        <p className="mt-3 font-mono text-[11px] text-ink/50">
          connect your sui wallet to control this run.
        </p>
      )}

      <div className="mt-5 border border-ink/15 bg-ink/[0.03] p-4">
        <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-ink/50">
          <span>reward curve {running && <span className="text-accent">· live</span>}</span>
          <span>last {curve.length} pts</span>
        </div>
        <Sparkline data={curve} height={150} className="text-ink" fill={false} />
      </div>

      <div className="mt-5 grid grid-cols-3 border border-ink/15">
        {metrics.map((m, i) => (
          <div key={m.label} className={`p-4 ${i > 0 ? "border-l border-ink/15" : ""}`}>
            <div className="font-mono text-lg">{m.value}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-ink/40">
              {m.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
