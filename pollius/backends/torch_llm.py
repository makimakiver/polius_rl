"""Torch backend -- the real path: load an HF model, generate, score, backprop.

Three pieces, all here:
  * TorchPolicy  -- wraps a causal LM (generation + differentiable log-probs)
  * cispo_loss   -- the autograd mirror of pollius.algorithms.cispo (same numbers)
  * TorchTrainer -- rollout -> reward (env) -> advantage (numpy, reused) -> torch
                    loss -> loss.backward(); optimizer.step()

transformers is imported lazily inside TorchPolicy.__init__, so importing this
module stays cheap (the trainer's unit tests inject a fake policy, no model).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

import numpy as np
import torch

from pollius.algorithms import get_advantage_fn, pass_at_k
from pollius.core import LossMetrics
from pollius.environments.dispatch import compute_rewards
from pollius.registry import make_registry


# ----------------------------------------------------------------------------
# Policy (Qwen / any HF causal LM)
# ----------------------------------------------------------------------------
@dataclass
class GenGroup:
    """One prompt's worth of generations + what's needed to score them."""

    response_texts: List[str]
    sequences: torch.Tensor      # (G, L) full prompt+response token ids
    prompt_len: int              # number of prompt tokens (shared across the group)
    response_mask: torch.Tensor  # (G, R) 1.0 for real response tokens


def _select_device(pref: str) -> torch.device:
    if pref and pref != "auto":
        return torch.device(pref)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


class TorchPolicy:
    def __init__(self, config) -> None:
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.config = config
        self.device = _select_device(config.device)
        self.tokenizer = AutoTokenizer.from_pretrained(config.model_name)
        if self.tokenizer.pad_token_id is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        self.model = AutoModelForCausalLM.from_pretrained(
            config.model_name, dtype=torch.float32
        ).to(self.device)

    def parameters(self):
        return self.model.parameters()

    def generate(self, prompt_text: str, group_size: int) -> GenGroup:
        messages = [{"role": "user", "content": prompt_text}]
        enc = self.tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, return_tensors="pt", return_dict=True
        )
        ids = enc["input_ids"].to(self.device)
        attention_mask = enc["attention_mask"].to(self.device)
        prompt_len = ids.shape[1]
        with torch.no_grad():
            out = self.model.generate(
                ids,
                attention_mask=attention_mask,
                do_sample=True,
                temperature=self.config.temperature,
                top_p=self.config.top_p,
                max_new_tokens=self.config.max_new_tokens,
                num_return_sequences=group_size,
                pad_token_id=self.tokenizer.pad_token_id,
            )
        response_ids = out[:, prompt_len:]
        response_mask = (response_ids != self.tokenizer.pad_token_id).float()
        texts = self.tokenizer.batch_decode(response_ids, skip_special_tokens=True)
        return GenGroup(texts, out, prompt_len, response_mask)

    def logprobs(self, gen: GenGroup) -> torch.Tensor:
        seq = gen.sequences
        attn = (seq != self.tokenizer.pad_token_id).long()
        logits = self.model(seq, attention_mask=attn).logits      # (G, L, V)
        logp_all = torch.log_softmax(logits[:, :-1, :], dim=-1)    # (G, L-1, V)
        targets = seq[:, 1:].unsqueeze(-1)                         # (G, L-1, 1)
        tok_logp = torch.gather(logp_all, 2, targets).squeeze(-1)  # (G, L-1)
        return tok_logp[:, gen.prompt_len - 1:]                    # (G, R)


# ----------------------------------------------------------------------------
# Policy loss (torch autograd) -- CISPO
# ----------------------------------------------------------------------------
register_torch_policy_loss, get_torch_policy_loss_fn, TORCH_POLICY_LOSS_REGISTRY = (
    make_registry("torch policy loss")
)


def masked_mean(values, mask):
    denom = mask.sum()
    if float(denom) == 0.0:
        return values.sum() * 0.0
    return (values * mask).sum() / denom


@register_torch_policy_loss("cispo")
def cispo_loss(old_log_prob, log_prob, advantages, response_mask, config):
    """Differentiable CISPO; the clipped ratio's stop-gradient is a real .detach()."""
    neg_approx_kl = torch.clamp(log_prob - old_log_prob, -20.0, 20.0)
    ratio = torch.exp(neg_approx_kl)
    low, high = 1.0 - config.clip_ratio_low, 1.0 + config.clip_ratio_high
    clipped_ratio = torch.clamp(ratio, low, high)
    per_token_loss = -clipped_ratio.detach() * advantages * log_prob
    loss = masked_mean(per_token_loss, response_mask)
    metrics = LossMetrics(
        loss=float(loss.item()),
        clipfrac=float(masked_mean((ratio != clipped_ratio).float(), response_mask).item()),
        approx_kl=float(masked_mean(-neg_approx_kl, response_mask).item()),
        mean_ratio=float(masked_mean(ratio, response_mask).item()),
    )
    return loss, metrics


# ----------------------------------------------------------------------------
# Trainer (real backward/step)
# ----------------------------------------------------------------------------
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
            adv_np = self.adv_fn(rewards, np.zeros(len(rewards), dtype=int), mask_np, cfg)
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
