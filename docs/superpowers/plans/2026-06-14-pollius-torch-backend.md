# pollius Torch Backend (real Qwen training) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real torch training backend that loads the open-source `Qwen/Qwen2.5-0.5B-Instruct`, generates candidate answers, scores them with the Environment box, and runs a genuine `loss.backward(); optimizer.step()` update on MPS/CPU.

**Architecture:** A `TorchPolicy` wraps the HF model+tokenizer (generation + differentiable per-token log-probs). A `TorchTrainer` takes an *injected* policy, draws tasks from environments, scores with `compute_rewards`, computes GRPO advantages by reusing the existing numpy advantage box, and applies a torch-autograd policy loss. Dependency-injecting the policy lets the whole loop be unit-tested with a tiny fake policy (no model download); the real Qwen run is a separate env-gated E2E test plus a driver.

**Tech Stack:** Python 3.13, torch 2.10 (MPS), transformers 5.2, numpy. Reuses `pollius.advantage` (numpy), `pollius.metrics.pass_at_k`, `pollius.environments.dispatch`.

**Spec:** `docs/superpowers/specs/2026-06-14-pollius-environments-torch-training-design.md` (phases 5–6). Builds on the merged phases 1–4 (Environment box).

**Key design notes:**
- On-policy single update: `old_log_probs` and `log_probs` come from the same model state, so the importance ratio starts at ~1.0; the gradient still flows through `log_prob` (real weight update). This is correct for one update per rollout.
- The policy/trainer interface: `policy.generate(prompt_text, group_size) -> GenGroup` and `policy.logprobs(gen) -> Tensor (G, R)`; `policy.parameters()` for the optimizer; `policy.device`.
- `GenGroup` carries `response_texts`, `sequences`, `prompt_len`, `response_mask` — no transformers dependency, so importing `pollius.policy` stays cheap (transformers is imported lazily inside `TorchPolicy.__init__`).

---

### Task 1: Torch config fields

**Files:**
- Modify: `pollius/config.py`
- Test: `tests/test_config_torch.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_config_torch.py`:

```python
"""Run: python3 -m pytest tests/test_config_torch.py -q"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.config import PolliusConfig


def test_torch_config_defaults():
    c = PolliusConfig()
    assert c.model_name == "Qwen/Qwen2.5-0.5B-Instruct"
    assert c.device == "auto"
    assert c.max_new_tokens == 64
    assert c.temperature == 1.0
    assert c.top_p == 1.0
    assert c.grad_clip == 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_config_torch.py -q`
Expected: FAIL (AttributeError: 'PolliusConfig' object has no attribute 'model_name')

- [ ] **Step 3: Add the fields**

In `pollius/config.py`, add this block immediately after the existing `# --- environments / data / eval (phase 1-4) ---` block (before `__post_init__`):

```python
    # --- torch backend (phase 5) ------------------------------------------
    model_name: str = "Qwen/Qwen2.5-0.5B-Instruct"
    device: str = "auto"            # "auto" -> mps -> cuda -> cpu
    max_new_tokens: int = 64
    temperature: float = 1.0
    top_p: float = 1.0
    grad_clip: float = 1.0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_config_torch.py -q`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add pollius/config.py tests/test_config_torch.py
git commit -m "feat: add torch backend config fields"
```

---

### Task 2: Torch policy-loss functions

**Files:**
- Create: `pollius/losses_torch.py`
- Test: `tests/test_losses_torch.py`

- [ ] **Step 1: Write the failing test** (numerical equivalence to the numpy losses)

Create `tests/test_losses_torch.py`:

```python
"""Run: python3 -m pytest tests/test_losses_torch.py -q"""

from __future__ import annotations

import math
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.config import PolliusConfig
from pollius import losses as np_losses
from pollius import losses_torch as t_losses


def _inputs():
    rng = np.random.default_rng(0)
    old = rng.uniform(-2, -0.1, size=(2, 4))
    new = old + rng.uniform(-0.3, 0.3, size=(2, 4))
    adv = rng.uniform(-1, 1, size=(2, 4))
    mask = np.ones((2, 4))
    return old, new, adv, mask


def _to_torch(*arrays):
    return [torch.tensor(a, dtype=torch.float64) for a in arrays]


def test_registry_lists_torch_losses():
    assert set(["cispo", "ppo", "reinforce"]).issubset(set(t_losses.TORCH_POLICY_LOSS_REGISTRY))


def test_cispo_matches_numpy():
    cfg = PolliusConfig()
    old, new, adv, mask = _inputs()
    np_loss, _ = np_losses.cispo_loss(old, new, adv, mask, cfg)
    t_old, t_new, t_adv, t_mask = _to_torch(old, new, adv, mask)
    t_loss, m = t_losses.cispo_loss(t_old, t_new, t_adv, t_mask, cfg)
    assert math.isclose(float(t_loss.item()), np_loss, rel_tol=1e-9, abs_tol=1e-9)
    assert math.isfinite(m.approx_kl) and 0.0 <= m.clipfrac <= 1.0


def test_ppo_matches_numpy():
    cfg = PolliusConfig()
    old, new, adv, mask = _inputs()
    np_loss, _ = np_losses.ppo_loss(old, new, adv, mask, cfg)
    t_old, t_new, t_adv, t_mask = _to_torch(old, new, adv, mask)
    t_loss, _ = t_losses.ppo_loss(t_old, t_new, t_adv, t_mask, cfg)
    assert math.isclose(float(t_loss.item()), np_loss, rel_tol=1e-9, abs_tol=1e-9)


def test_reinforce_matches_numpy():
    cfg = PolliusConfig()
    old, new, adv, mask = _inputs()
    np_loss, _ = np_losses.reinforce_loss(old, new, adv, mask, cfg)
    t_old, t_new, t_adv, t_mask = _to_torch(old, new, adv, mask)
    t_loss, _ = t_losses.reinforce_loss(t_old, t_new, t_adv, t_mask, cfg)
    assert math.isclose(float(t_loss.item()), np_loss, rel_tol=1e-9, abs_tol=1e-9)


def test_cispo_is_differentiable():
    cfg = PolliusConfig()
    old, new, adv, mask = _inputs()
    t_old, t_new, t_adv, t_mask = _to_torch(old, new, adv, mask)
    t_new.requires_grad_(True)
    t_loss, _ = t_losses.cispo_loss(t_old, t_new, t_adv, t_mask, cfg)
    t_loss.backward()
    assert t_new.grad is not None and torch.isfinite(t_new.grad).all()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_losses_torch.py -q`
Expected: FAIL (ModuleNotFoundError: No module named 'pollius.losses_torch')

- [ ] **Step 3: Write the implementation**

Create `pollius/losses_torch.py`:

```python
"""Torch (autograd) policy losses -- mirror pollius/losses.py for real training.

Same math and same numbers as the numpy versions, but built from torch ops so
the loss is differentiable through `log_prob`. The "stop-gradient" on CISPO's
clipped ratio is a real `.detach()` here. Returns ``(loss_tensor, LossMetrics)``.
"""

from __future__ import annotations

import torch

from pollius.registry import make_registry
from pollius.types import LossMetrics

register_torch_policy_loss, get_torch_policy_loss_fn, TORCH_POLICY_LOSS_REGISTRY = (
    make_registry("torch policy loss")
)


def masked_mean(values: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    denom = mask.sum()
    if float(denom) == 0.0:
        return values.sum() * 0.0
    return (values * mask).sum() / denom


def _ratio(log_prob, old_log_prob):
    neg_approx_kl = torch.clamp(log_prob - old_log_prob, -20.0, 20.0)
    return torch.exp(neg_approx_kl), neg_approx_kl


def _metrics(loss, ratio, clipped_ratio, neg_approx_kl, mask) -> LossMetrics:
    return LossMetrics(
        loss=float(loss.item()),
        clipfrac=float(masked_mean((ratio != clipped_ratio).double(), mask).item()),
        approx_kl=float(masked_mean(-neg_approx_kl, mask).item()),
        mean_ratio=float(masked_mean(ratio, mask).item()),
    )


@register_torch_policy_loss("cispo")
def cispo_loss(old_log_prob, log_prob, advantages, response_mask, config):
    ratio, neg_approx_kl = _ratio(log_prob, old_log_prob)
    low, high = 1.0 - config.clip_ratio_low, 1.0 + config.clip_ratio_high
    clipped_ratio = torch.clamp(ratio, low, high)
    per_token_loss = -clipped_ratio.detach() * advantages * log_prob
    loss = masked_mean(per_token_loss, response_mask)
    return loss, _metrics(loss, ratio, clipped_ratio, neg_approx_kl, response_mask)


@register_torch_policy_loss("ppo")
def ppo_loss(old_log_prob, log_prob, advantages, response_mask, config):
    ratio, neg_approx_kl = _ratio(log_prob, old_log_prob)
    low, high = 1.0 - config.clip_ratio_low, 1.0 + config.clip_ratio_high
    clipped_ratio = torch.clamp(ratio, low, high)
    per_token_loss = -torch.minimum(ratio * advantages, clipped_ratio * advantages)
    loss = masked_mean(per_token_loss, response_mask)
    return loss, _metrics(loss, ratio, clipped_ratio, neg_approx_kl, response_mask)


@register_torch_policy_loss("reinforce")
def reinforce_loss(old_log_prob, log_prob, advantages, response_mask, config):
    ratio, neg_approx_kl = _ratio(log_prob, old_log_prob)
    per_token_loss = -advantages * log_prob
    loss = masked_mean(per_token_loss, response_mask)
    return loss, _metrics(loss, ratio, ratio, neg_approx_kl, response_mask)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_losses_torch.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add pollius/losses_torch.py tests/test_losses_torch.py
git commit -m "feat: add torch autograd policy losses (cispo/ppo/reinforce)"
```

---

### Task 3: TorchPolicy (Qwen wrapper) + GenGroup

**Files:**
- Create: `pollius/policy.py`
- Test: `tests/test_policy.py`

- [ ] **Step 1: Write the failing test** (device selection is model-free; real-model tests are env-gated)

Create `tests/test_policy.py`:

```python
"""Run: python3 -m pytest tests/test_policy.py -q

The real-model tests download Qwen (~1GB); they only run when
POLLIUS_RUN_TORCH_E2E=1. The device-selection and GenGroup tests always run.
"""

from __future__ import annotations

import math
import os
import sys

import pytest
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.config import PolliusConfig
from pollius.policy import GenGroup, _select_device

E2E = os.environ.get("POLLIUS_RUN_TORCH_E2E") == "1"


def test_select_device_explicit_cpu():
    assert _select_device("cpu") == torch.device("cpu")


def test_select_device_auto_returns_a_device():
    dev = _select_device("auto")
    assert isinstance(dev, torch.device)
    assert dev.type in ("mps", "cuda", "cpu")


def test_gengroup_holds_fields():
    g = GenGroup(response_texts=["a"], sequences=torch.zeros(1, 3), prompt_len=1,
                 response_mask=torch.ones(1, 2))
    assert g.response_texts == ["a"] and g.prompt_len == 1


@pytest.mark.skipif(not E2E, reason="set POLLIUS_RUN_TORCH_E2E=1 to run (downloads Qwen)")
def test_real_generate_and_logprobs_shapes():
    from pollius.policy import TorchPolicy
    cfg = PolliusConfig(max_new_tokens=8)
    policy = TorchPolicy(cfg)
    gen = policy.generate("Reply with 'Answer: yes'.", group_size=2)
    assert len(gen.response_texts) == 2
    lp = policy.logprobs(gen)
    assert lp.shape == gen.response_mask.shape
    assert torch.isfinite(lp).all()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_policy.py -q`
Expected: FAIL (ModuleNotFoundError: No module named 'pollius.policy')

- [ ] **Step 3: Write the implementation**

Create `pollius/policy.py`:

```python
"""TorchPolicy -- wraps an HF causal LM for generation + differentiable log-probs.

`generate` samples `group_size` responses for one prompt (chat-templated).
`logprobs` does a forward pass and returns per-token log-probs over the response
region only, shape (G, R). transformers is imported lazily so importing this
module stays cheap (the trainer's unit tests use a fake policy, no model).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

import torch


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
            config.model_name, torch_dtype=torch.float32
        ).to(self.device)

    def parameters(self):
        return self.model.parameters()

    def generate(self, prompt_text: str, group_size: int) -> GenGroup:
        messages = [{"role": "user", "content": prompt_text}]
        ids = self.tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, return_tensors="pt"
        ).to(self.device)
        prompt_len = ids.shape[1]
        with torch.no_grad():
            out = self.model.generate(
                ids,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_policy.py -q`
Expected: PASS (3 passed, 1 skipped) — the real-model test is skipped without the env var.

- [ ] **Step 5: Commit**

```bash
git add pollius/policy.py tests/test_policy.py
git commit -m "feat: add TorchPolicy (Qwen generation + log-probs) and GenGroup"
```

---

### Task 4: TorchTrainer (the real training loop)

**Files:**
- Create: `pollius/trainer_torch.py`
- Test: `tests/test_trainer_torch.py`

- [ ] **Step 1: Write the failing test** (uses a FAKE policy with one trainable param — no model)

Create `tests/test_trainer_torch.py`:

```python
"""Run: python3 -m pytest tests/test_trainer_torch.py -q

Uses a fake policy whose log-probs depend on one trainable parameter, so the
whole training loop (reward -> advantage -> torch loss -> backward -> step) is
exercised WITHOUT downloading a model.
"""

from __future__ import annotations

import math
import os
import sys

import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.config import PolliusConfig
from pollius.environments.dispatch import load_environments
from pollius.policy import GenGroup
from pollius.trainer_torch import TorchTrainer


class FakePolicy:
    """Mixed correct/wrong canned answers + a single trainable parameter."""

    def __init__(self):
        self.device = torch.device("cpu")
        self.w = torch.nn.Parameter(torch.zeros(1))

    def parameters(self):
        return [self.w]

    def generate(self, prompt_text, group_size):
        # half correct ("Answer: odd"), half wrong -> non-constant reward in the group
        texts = ["Answer: odd" if i % 2 == 0 else "Answer: wrong" for i in range(group_size)]
        mask = torch.ones(group_size, 3)
        seq = torch.zeros(group_size, 5)
        return GenGroup(texts, seq, prompt_len=2, response_mask=mask)

    def logprobs(self, gen):
        # Per-sample-VARYING log-probs scaled by w. Must vary across samples:
        # GRPO advantages are zero-centered, so a uniform log-prob would make the
        # gradient w.r.t. w vanish (mean(adv) == 0) and the weight wouldn't move.
        g, r = gen.response_mask.shape
        per_sample = torch.arange(g, dtype=torch.float32).unsqueeze(1).expand(g, r)
        return per_sample * self.w - 1.0  # depends on w, differs per sample


def _cfg():
    return PolliusConfig(
        data_dir="data", environments=("logic_quiz",), group_size=4,
        num_prompts_per_step=2, num_steps=1, policy_loss="cispo",
        adv_estimator="grpo", lr=0.1, pass_at_k_values=(1, 2),
    )


def test_train_step_updates_parameter():
    cfg = _cfg()
    envs = load_environments(cfg.environments, cfg)
    policy = FakePolicy()
    before = policy.w.detach().clone()
    metrics = TorchTrainer(cfg, policy, envs).train_step()
    after = policy.w.detach().clone()
    assert not torch.allclose(before, after), "weight did not change -> no real gradient step"


def test_train_step_reports_metrics():
    cfg = _cfg()
    envs = load_environments(cfg.environments, cfg)
    metrics = TorchTrainer(cfg, FakePolicy(), envs).train_step()
    assert math.isfinite(metrics["loss"])
    assert 0.0 <= metrics["mean_reward"] <= 1.0
    assert set(cfg.pass_at_k_values).issubset(metrics["pass_at_k"].keys())


def test_fit_runs_multiple_steps():
    cfg = _cfg()
    cfg.num_steps = 2
    envs = load_environments(cfg.environments, cfg)
    history = TorchTrainer(cfg, FakePolicy(), envs).fit()
    assert len(history) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_trainer_torch.py -q`
Expected: FAIL (ModuleNotFoundError: No module named 'pollius.trainer_torch')

- [ ] **Step 3: Write the implementation**

Create `pollius/trainer_torch.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_trainer_torch.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add pollius/trainer_torch.py tests/test_trainer_torch.py
git commit -m "feat: add TorchTrainer (real backward/step, injected policy)"
```

---

### Task 5: Driver + README + real Qwen smoke run

**Files:**
- Create: `train_pollius_torch.py`
- Modify: `README.md`

- [ ] **Step 1: Write the driver**

Create `train_pollius_torch.py`:

```python
"""Driver: real local-LLM training with Qwen on environment rewards.

    python3 train_pollius_torch.py --steps 1 --group-size 2 --max-new-tokens 32

Downloads Qwen/Qwen2.5-0.5B-Instruct on first run (~1GB) and trains on MPS/CPU.
Uses the logic_quiz environment by default (no Lean toolchain needed).
"""

from __future__ import annotations

import argparse

from pollius.config import PolliusConfig
from pollius.environments.dispatch import load_environments
from pollius.losses_torch import TORCH_POLICY_LOSS_REGISTRY
from pollius.advantage import ADVANTAGE_REGISTRY


def main() -> None:
    p = argparse.ArgumentParser(description="Real Qwen RL training on env rewards.")
    p.add_argument("--model", default=PolliusConfig.model_name)
    p.add_argument("--environments", default="logic_quiz")
    p.add_argument("--steps", type=int, default=1)
    p.add_argument("--num-prompts", type=int, default=2)
    p.add_argument("--group-size", type=int, default=2)
    p.add_argument("--max-new-tokens", type=int, default=32)
    p.add_argument("--lr", type=float, default=1e-5)
    p.add_argument("--policy-loss", default="cispo", choices=sorted(TORCH_POLICY_LOSS_REGISTRY))
    p.add_argument("--adv-estimator", default="grpo", choices=sorted(ADVANTAGE_REGISTRY))
    p.add_argument("--device", default="auto")
    args = p.parse_args()

    cfg = PolliusConfig(
        model_name=args.model,
        environments=tuple(args.environments.split(",")),
        num_steps=args.steps,
        num_prompts_per_step=args.num_prompts,
        group_size=args.group_size,
        max_new_tokens=args.max_new_tokens,
        lr=args.lr,
        policy_loss=args.policy_loss,
        adv_estimator=args.adv_estimator,
        device=args.device,
    )

    from pollius.policy import TorchPolicy
    from pollius.trainer_torch import TorchTrainer

    print(f"model={cfg.model_name}  envs={cfg.environments}  loss={cfg.policy_loss}")
    policy = TorchPolicy(cfg)
    print(f"device={policy.device}")
    envs = load_environments(cfg.environments, cfg)
    TorchTrainer(cfg, policy, envs).fit()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify the driver parses (no model download) — argparse smoke**

Run: `python3 train_pollius_torch.py --help`
Expected: prints usage including `--policy-loss {cispo,ppo,reinforce}` and `--adv-estimator {dr_grpo,grpo,reinforce,rloo}`. (No model loads for `--help`.)

- [ ] **Step 3: Update the README**

In `README.md`, add this section immediately after the "## Environments (the 4th box)" section (before the next `##` heading):

```markdown
## Real local-LLM training (torch backend)

The numpy path above is a mock. The torch backend actually trains a local model:

```bash
python3 train_pollius_torch.py --steps 1 --group-size 2 --max-new-tokens 32
```

It loads `Qwen/Qwen2.5-0.5B-Instruct` (open-source, ~1GB on first run), generates
candidate answers, scores them with the chosen environment's reward, computes
GRPO advantages, and runs a real `loss.backward(); optimizer.step()` on MPS/CPU.
A 0.5B model rarely solves hard tasks, so rewards start low — the point is a real
RL loop with a verifiable reward, not SOTA accuracy.

| Piece | File |
|-------|------|
| model wrapper (generate + log-probs) | `pollius/policy.py` |
| torch autograd losses | `pollius/losses_torch.py` |
| training loop (real backward/step) | `pollius/trainer_torch.py` |
| driver | `train_pollius_torch.py` |

The loop is unit-tested with a fake policy (no download); the real-model tests run
only with `POLLIUS_RUN_TORCH_E2E=1`.
```

IMPORTANT: this markdown block contains a nested ```bash fenced block — preserve it exactly inside the section. Read README.md first to place the section correctly.

- [ ] **Step 4: Run the full offline suite**

Run: `python3 -m pytest tests/ -q`
Expected: all green (the prior 38 + new config/losses_torch/policy/trainer_torch tests; the Qwen E2E tests are skipped). Confirm 0 failures.

- [ ] **Step 5: Commit**

```bash
git add train_pollius_torch.py README.md
git commit -m "feat: add torch training driver and README section"
```

- [ ] **Step 6: REAL Qwen smoke run (controller-executed final verification)**

This step actually downloads and trains Qwen. Run it once to prove the loop genuinely updates the model:

```bash
POLLIUS_RUN_TORCH_E2E=1 python3 -m pytest tests/test_policy.py tests/test_trainer_torch.py -q
python3 train_pollius_torch.py --steps 1 --group-size 2 --max-new-tokens 24
```
Expected: the pytest E2E generates real text and finite log-probs; the driver prints a `[step 0] loss=... mean_reward=... pass@1=...` line. (Slow: minutes on MPS, plus the one-time ~1GB download.) Do NOT commit downloaded weights (they live in the HF cache, outside the repo).

---

## Notes for the implementer

- **transformers is imported lazily** inside `TorchPolicy.__init__` — never import it at module top level in `policy.py`, or the trainer's fake-policy tests would pull in the model stack unnecessarily.
- **Do not download the model in any always-on test.** Only the `POLLIUS_RUN_TORCH_E2E=1`-gated tests and the driver may load Qwen.
- **The advantage box is reused as numpy** — convert its output to a torch tensor on the response_mask's device/dtype. Do not reimplement GRPO in torch.
- Keep `pollius/losses.py`, `trainer.py`, `rollout.py` (the numpy mock path) untouched.
- Run `python3 -m pytest tests/ -q` after each task; keep the offline suite green.
```
