// Sample data for the Pollius RL platform. In a real app this would come from
// an indexer / on-chain registry of user-deployed environments.

export type EnvStatus = "Training" | "Evaluating" | "Idle";

export interface RlEnvironment {
  id: string;
  name: string;
  description: string;
  /** Sui address of the user who deployed the environment. */
  deployer: string;
  status: EnvStatus;
  /** Cumulative reward, in $SUI. */
  reward: number;
  episodes: number;
  /** 0..1 */
  successRate: number;
  algorithm: string;
  observationSpace: string;
  actionSpace: string;
  hyperparameters: { label: string; value: string }[];
  /** Normalized reward-curve samples (0..1) for the sparkline / chart. */
  rewardCurve: number[];
  tags: string[];
}

export const environments: RlEnvironment[] = [
  {
    id: "lean-proof",
    name: "Lean Theorem Proving",
    description:
      "Self-guided self-play (SGS): the conjecturer mines confidently-wrong proofs into synthetic theorems; the solver post-trains against the Lean verifier. Powers the inference market.",
    deployer: "0x9f1c4a7e2b8d6f3019ac55e7b1d2c8f40a6e7b91c3d2f5a8b4c6d7e9f0a1b2c3d",
    status: "Training",
    reward: 0,
    episodes: 0,
    successRate: 0.33,
    algorithm: "GRPO + CISPO (SGS)",
    observationSpace: "Lean theorem (text)",
    actionSpace: "Lean proof (text)",
    hyperparameters: [
      { label: "Base model", value: "Qwen2.5-0.5B" },
      { label: "Verifier", value: "Lean 4 / lake" },
      { label: "Conjecturer", value: "SPG (g_φ)" },
      { label: "Adapter", value: "LoRA → Walrus" },
    ],
    rewardCurve: [0.2, 0.32, 0.44, 0.55, 0.63],
    tags: ["lean", "sgs", "self-play"],
  },
  {
    id: "cartpole-swarm",
    name: "CartPole Swarm",
    description:
      "Classic control benchmark scaled to a 64-agent swarm with shared reward shaping.",
    deployer: "0x9f1c4a7e2b8d6f3019ac55e7b1d2c8f40a6e7b91c3d2f5a8b4c6d7e9f0a1b2c3d",
    status: "Training",
    reward: 18432.5,
    episodes: 124_500,
    successRate: 0.94,
    algorithm: "PPO",
    observationSpace: "Box(4,)",
    actionSpace: "Discrete(2)",
    hyperparameters: [
      { label: "Learning rate", value: "3e-4" },
      { label: "Gamma", value: "0.99" },
      { label: "Batch size", value: "2048" },
      { label: "Clip range", value: "0.2" },
    ],
    rewardCurve: [0.05, 0.12, 0.18, 0.3, 0.42, 0.55, 0.61, 0.68, 0.79, 0.86, 0.91, 0.94],
    tags: ["control", "discrete"],
  },
  {
    id: "lunar-lander-mainnet",
    name: "Lunar Lander",
    description:
      "Continuous-control landing task with fuel-penalty rewards settled on-chain.",
    deployer: "0x3a2b1c0d9e8f7061524d3c2b1a0998877665544332211ffeeddccbbaa99887766",
    status: "Evaluating",
    reward: 9921.0,
    episodes: 58_200,
    successRate: 0.81,
    algorithm: "SAC",
    observationSpace: "Box(8,)",
    actionSpace: "Box(2,)",
    hyperparameters: [
      { label: "Learning rate", value: "1e-3" },
      { label: "Tau", value: "0.005" },
      { label: "Buffer size", value: "1e6" },
      { label: "Entropy", value: "auto" },
    ],
    rewardCurve: [0.1, 0.08, 0.2, 0.28, 0.25, 0.4, 0.52, 0.5, 0.63, 0.7, 0.76, 0.81],
    tags: ["control", "continuous"],
  },
  {
    id: "atari-breakout",
    name: "Atari Breakout",
    description:
      "Pixel-based agent learning brick-breaking from raw frames with frame stacking.",
    deployer: "0x77665544332211009988aabbccddeeff00112233445566778899aabbccddeeff0",
    status: "Training",
    reward: 31204.75,
    episodes: 412_000,
    successRate: 0.88,
    algorithm: "Rainbow DQN",
    observationSpace: "Box(84,84,4)",
    actionSpace: "Discrete(4)",
    hyperparameters: [
      { label: "Learning rate", value: "6.25e-5" },
      { label: "Gamma", value: "0.99" },
      { label: "Replay", value: "1e6" },
      { label: "n-step", value: "3" },
    ],
    rewardCurve: [0.02, 0.06, 0.05, 0.14, 0.22, 0.33, 0.48, 0.55, 0.66, 0.74, 0.83, 0.88],
    tags: ["vision", "discrete"],
  },
  {
    id: "mujoco-humanoid",
    name: "MuJoCo Humanoid",
    description:
      "High-dimensional locomotion: keep a 17-DoF humanoid upright and moving forward.",
    deployer: "0xaabbccddeeff00112233445566778899aabbccddeeff001122334455667788990",
    status: "Idle",
    reward: 5402.25,
    episodes: 22_900,
    successRate: 0.63,
    algorithm: "TD3",
    observationSpace: "Box(376,)",
    actionSpace: "Box(17,)",
    hyperparameters: [
      { label: "Learning rate", value: "3e-4" },
      { label: "Policy delay", value: "2" },
      { label: "Noise", value: "0.2" },
      { label: "Batch size", value: "256" },
    ],
    rewardCurve: [0.04, 0.1, 0.15, 0.21, 0.29, 0.34, 0.4, 0.47, 0.51, 0.57, 0.6, 0.63],
    tags: ["robotics", "continuous"],
  },
  {
    id: "trading-bandit",
    name: "Market Maker Bandit",
    description:
      "Multi-armed bandit allocating liquidity across pools to maximize fee capture.",
    deployer: "0x12af34be56cd78ef90ab12cd34ef56ab78cd90ef12ab34cd56ef78ab90cd12ef",
    status: "Training",
    reward: 47210.0,
    episodes: 980_400,
    successRate: 0.91,
    algorithm: "Thompson Sampling",
    observationSpace: "Box(12,)",
    actionSpace: "Discrete(8)",
    hyperparameters: [
      { label: "Prior", value: "Beta(1,1)" },
      { label: "Horizon", value: "10k" },
      { label: "Decay", value: "0.995" },
      { label: "Arms", value: "8" },
    ],
    rewardCurve: [0.2, 0.31, 0.4, 0.46, 0.55, 0.62, 0.7, 0.77, 0.82, 0.86, 0.89, 0.91],
    tags: ["finance", "bandit"],
  },
  {
    id: "grid-world-maze",
    name: "Grid World Maze",
    description:
      "Sparse-reward navigation with curiosity-driven exploration bonuses.",
    deployer: "0xdeadbeef00cafe11feed22face33beef44cafe55feed66face77beef88cafe990",
    status: "Idle",
    reward: 2104.5,
    episodes: 14_300,
    successRate: 0.57,
    algorithm: "A2C + ICM",
    observationSpace: "Box(16,16,3)",
    actionSpace: "Discrete(4)",
    hyperparameters: [
      { label: "Learning rate", value: "7e-4" },
      { label: "Gamma", value: "0.97" },
      { label: "Curiosity", value: "0.01" },
      { label: "Workers", value: "16" },
    ],
    rewardCurve: [0.01, 0.03, 0.02, 0.08, 0.12, 0.19, 0.26, 0.31, 0.4, 0.46, 0.52, 0.57],
    tags: ["navigation", "sparse"],
  },
];

export function getEnvironment(id: string): RlEnvironment | undefined {
  return environments.find((env) => env.id === id);
}

// Re-exported for back-compat; the implementation now lives in lib/format.
export { shortAddress } from "../lib/format";
