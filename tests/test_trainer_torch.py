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

from pollius.core import PolliusConfig
from pollius.environments.dispatch import load_environments
from pollius.backends.torch_llm import GenGroup
from pollius.backends.torch_llm import TorchTrainer


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
