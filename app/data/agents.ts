// Autonomous "Hermes" agents. An agent joins one or more RL environments; its
// per-RL results are aggregated for the summary view.

import { environments, getEnvironment, type EnvStatus } from "./environments";

export type AgentStatus = "Active" | "Training" | "Idle";

export interface Agent {
  id: string;
  name: string;
  model: string;
  status: AgentStatus;
  uptime: string;
  /** unclaimed reward available to withdraw, in $SUI */
  claimable: number;
  /** the RL environments this agent has joined */
  envIds: string[];
  // ---- identity (set for user-registered agents) ----------------------
  /** human description */
  description?: string;
  /** owner wallet address */
  owner?: string;
  /** mocked soulbound identity id, e.g. "sbt:1a2b3c4d" */
  identityId?: string;
}

export interface AgentRun {
  envId: string;
  envName: string;
  curve: number[];
  reward: number;
  successRate: number;
  status: EnvStatus;
}

export const agents: Agent[] = [
  { id: "hermes-gamma", name: "Hermes-Gamma", model: "Hermes v1.8", status: "Active", uptime: "99.9%", claimable: 1240.5, envIds: environments.map((e) => e.id) },
  { id: "hermes-alpha", name: "Hermes-Alpha", model: "Hermes v2.1", status: "Active", uptime: "99.4%", claimable: 860.0, envIds: ["cartpole-swarm", "lunar-lander-mainnet", "atari-breakout", "trading-bandit"] },
  { id: "hermes-sigma", name: "Hermes-Sigma", model: "Hermes v2.1", status: "Active", uptime: "99.0%", claimable: 540.25, envIds: ["cartpole-swarm", "mujoco-humanoid", "grid-world-maze"] },
  { id: "hermes-beta", name: "Hermes-Beta", model: "Hermes v2.1", status: "Training", uptime: "98.1%", claimable: 0, envIds: ["lunar-lander-mainnet", "atari-breakout"] },
  { id: "hermes-omega", name: "Hermes-Omega", model: "Hermes v1.8", status: "Idle", uptime: "97.3%", claimable: 310.0, envIds: ["trading-bandit", "grid-world-maze"] },
  { id: "hermes-delta", name: "Hermes-Delta", model: "Hermes v2.0", status: "Idle", uptime: "95.2%", claimable: 0, envIds: ["mujoco-humanoid"] },
];

export function getAgent(id: string): Agent | undefined {
  return agents.find((a) => a.id === id);
}

/** All agents that have joined a given RL environment. */
export function agentsInEnvironment(envId: string): Agent[] {
  return agents.filter((a) => a.envIds.includes(envId));
}

/** The agent's per-RL runs (one per environment it joined). */
export function agentRuns(agent: Agent): AgentRun[] {
  return agent.envIds
    .map((id) => getEnvironment(id))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => ({
      envId: e.id,
      envName: e.name,
      curve: e.rewardCurve,
      reward: e.reward,
      successRate: e.successRate,
      status: e.status,
    }));
}

/** Average of the run curves → the aggregated result shown on the card. */
export function aggregateCurve(runs: AgentRun[]): number[] {
  const len = runs[0]?.curve.length ?? 0;
  if (!runs.length) return [];
  return Array.from({ length: len }, (_, i) =>
    runs.reduce((s, r) => s + (r.curve[i] ?? 0), 0) / runs.length
  );
}

export function agentReward(runs: AgentRun[]): number {
  return runs.reduce((s, r) => s + r.reward, 0);
}
export function agentSuccess(runs: AgentRun[]): number {
  return runs.length ? runs.reduce((s, r) => s + r.successRate, 0) / runs.length : 0;
}
