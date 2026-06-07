// User-registered agents, persisted client-side in localStorage. These are a
// mock stand-in for the real soulbound-identity registry; the `identityId`
// field marks the (mocked) soulbound token.

import type { Agent } from "./agents";

const KEY = "pollius.customAgents";

export interface VerifiedClaims {
  agent_name: string;
  address: string;
  role: string;
  description: string;
}

export function loadCustomAgents(): Agent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Agent[]) : [];
  } catch {
    return [];
  }
}

export function addCustomAgent(agent: Agent): void {
  if (typeof window === "undefined") return;
  const list = loadCustomAgents().filter((a) => a.id !== agent.id);
  list.push(agent);
  window.localStorage.setItem(KEY, JSON.stringify(list));
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Deterministic mock soulbound id from owner + agent name (FNV-1a 32-bit). */
export function deriveIdentityId(owner: string, agentName: string): string {
  let h = 0x811c9dc5;
  const input = `${owner}:${agentName}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "sbt:" + (h >>> 0).toString(16).padStart(8, "0");
}

export function agentFromClaims(claims: VerifiedClaims): Agent {
  return {
    id: slugify(claims.agent_name) || "agent",
    name: claims.agent_name,
    model: "custom",
    status: "Idle",
    uptime: "new",
    claimable: 0,
    envIds: [],
    role: claims.role,
    description: claims.description,
    owner: claims.address,
    identityId: deriveIdentityId(claims.address, claims.agent_name),
  };
}
