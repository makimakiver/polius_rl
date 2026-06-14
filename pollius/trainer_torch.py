"""TorchTrainer -- the real training loop: rollout -> reward -> advantage ->
torch loss -> backward -> optimizer step.

The policy is injected (any object with generate/logprobs/parameters/device), so
the loop is testable with a fake policy. The advantage box is REUSED from the
numpy side (advantages are constants w.r.t. the policy -- no autograd needed);
only the loss is torch. pass@k is logged per problem-group each step.
"""

from __future__ import annotations

from typing import Dict, List

import numpy as np
import torch

from pollius.advantage import get_advantage_fn
from pollius.environments.dispatch import compute_rewards
from pollius.losses_torch import get_torch_policy_loss_fn
from pollius.metrics import pass_at_k


class TorchTrainer:
    def __init__(self, config, policy, environments: Dict[str, object]) -> None:
        self.config = config
        self.policy = policy
        self.envs = environments
        self.device = getattr(policy, "device", torch.device("cpu"))
        self.optimizer = torch.optim.Adam(policy.parameters(), lr=config.lr)
        self.loss_fn = get_torch_policy_loss_fn(config.policy_loss)
        self.adv_fn = get_advantage_fn(config.adv_estimator)
        self._rng = np.random.default_rng(config.seed)

    def _sample_tasks(self) -> list:
        pool = []
        for name in self.envs:
            pool.extend(
                self.envs[name].sample_tasks(self.config.num_prompts_per_step, self._rng)
            )
        return pool[: self.config.num_prompts_per_step]

    def train_step(self) -> dict:
        cfg = self.config
        tasks = self._sample_tasks()
        if not tasks:
            raise RuntimeError(
                f"No tasks from environments {tuple(self.envs)} under data_dir="
                f"'{cfg.data_dir}'. Check the data folders exist."
            )

        self.optimizer.zero_grad()
        total_loss = None
        all_rewards: List[float] = []
        all_groups: List[int] = []
        kls, clipfracs, mean_ratios = [], [], []

        for gi, task in enumerate(tasks):
            gen = self.policy.generate(task.prompt, cfg.group_size)
            rewards = np.array(
                compute_rewards(
                    [task] * len(gen.response_texts), gen.response_texts, self.envs, cfg
                ),
                dtype=np.float64,
            )
            mask_np = gen.response_mask.detach().cpu().numpy()
            adv_np = self.adv_fn(
                rewards, np.zeros(len(rewards), dtype=int), mask_np, cfg
            )
            adv = torch.tensor(
                adv_np, dtype=gen.response_mask.dtype, device=gen.response_mask.device
            )

            with torch.no_grad():
                old_logp = self.policy.logprobs(gen)
            logp = self.policy.logprobs(gen)
            loss, m = self.loss_fn(old_logp, logp, adv, gen.response_mask, cfg)

            total_loss = loss if total_loss is None else total_loss + loss
            all_rewards.extend(rewards.tolist())
            all_groups.extend([gi] * len(rewards))
            kls.append(m.approx_kl)
            clipfracs.append(m.clipfrac)
            mean_ratios.append(m.mean_ratio)

        total_loss = total_loss / len(tasks)
        total_loss.backward()
        torch.nn.utils.clip_grad_norm_(self.policy.parameters(), cfg.grad_clip)
        self.optimizer.step()

        group_ids = np.array(all_groups)
        rewards_arr = np.array(all_rewards)
        passk = {k: pass_at_k(rewards_arr, group_ids, k)[1] for k in cfg.pass_at_k_values}
        return {
            "loss": float(total_loss.item()),
            "mean_reward": float(np.mean(all_rewards)) if all_rewards else 0.0,
            "pass_at_k": passk,
            "approx_kl": float(np.mean(kls)) if kls else 0.0,
            "clipfrac": float(np.mean(clipfracs)) if clipfracs else 0.0,
        }

    def fit(self) -> List[dict]:
        history = []
        for step in range(self.config.num_steps):
            m = self.train_step()
            history.append(m)
            pk = " ".join(f"pass@{k}={v:.2f}" for k, v in m["pass_at_k"].items())
            print(
                f"[step {step:>3}] loss={m['loss']:+.4f} "
                f"mean_reward={m['mean_reward']:.3f} {pk} "
                f"kl={m['approx_kl']:+.4f} clipfrac={m['clipfrac']:.3f}"
            )
        return history
