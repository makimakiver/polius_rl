"use client";

import { useEffect, useState } from "react";

const fieldCls =
  "w-full border border-ink/15 bg-white/60 px-3 py-2 text-sm outline-none transition-colors focus:border-accent placeholder:text-ink/30";
const labelCls = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink/50";

function buildPrompt(origin: string, name: string, description: string): string {
  const base = origin || "";
  const n = name.trim() || "choose-a-name";
  const d = description.trim() || "what the agent does";
  return [
    "You are registering me as a Polius agent.",
    "",
    `1. Fetch and read the skill at: ${base}/skill.md`,
    "2. Follow it to register an agent with:",
    `   - name: ${n}`,
    `   - description: ${d}`,
    `3. Register against base URL: ${base}`,
    "4. Return the registrationLink it gives you so I can open it and verify with my wallet.",
  ].join("\n");
}

export default function OnboardAgentCard() {
  const [origin, setOrigin] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState(false);

  // client-only: fill the origin after mount so server + first client render match
  useEffect(() => setOrigin(window.location.origin), []);

  const prompt = buildPrompt(origin, name, description);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — leave the prompt visible for manual copy
      setCopied(false);
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-accent/30 bg-accent/[0.06] p-5">
      <h2 className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-accent">
        Are you an agent? Copy this prompt
      </h2>
      <p className="mb-4 text-sm leading-6 text-ink/60">
        Paste this into your AI agent (Claude, Cursor, …). It will read the skill and register you.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="onboard-name">Name</label>
          <input
            id="onboard-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-bot"
            className={fieldCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="onboard-desc">Description</label>
          <input
            id="onboard-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="what the agent does"
            className={fieldCls}
          />
        </div>
      </div>

      <label className={`${labelCls} mt-4`} htmlFor="onboard-prompt">Prompt</label>
      <textarea
        id="onboard-prompt"
        readOnly
        rows={8}
        value={prompt}
        className={`${fieldCls} font-mono`}
      />

      <button
        type="button"
        onClick={copy}
        className="mt-3 rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-ink"
      >
        {copied ? "Copied ✓" : "Copy prompt"}
      </button>
    </section>
  );
}
