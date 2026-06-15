"""Minimal sanity checks for the real math. Run: python3 tests/test_sanity.py

No pytest required -- plain asserts so the skeleton stays dependency-light.
"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.advantage import ADVANTAGE_REGISTRY, grpo_advantage
from pollius.config import PolliusConfig
from pollius.losses import POLICY_LOSS_REGISTRY, cispo_loss
from pollius.reward import get_reward_fn
from pollius.trainer import PolliusTrainer
from pollius.rollout import MockRollout
from pollius.types import Sample


def test_null_reward_is_zero():
    fn = get_reward_fn("null")
    s = Sample(0, 0, np.zeros(3), np.zeros(4), np.ones(4))
    assert fn(s) == 0.0
    print("ok: null reward returns 0.0")


def test_grpo_constant_group_is_zero():
    cfg = PolliusConfig(group_size=4)
    rewards = np.array([5.0, 5.0, 5.0, 5.0])          # identical -> no advantage
    groups = np.array([0, 0, 0, 0])
    mask = np.ones((4, 6))
    adv = grpo_advantage(rewards, groups, mask, cfg)
    assert np.allclose(adv, 0.0), adv
    print("ok: GRPO advantage of a constant group is ~0")


def test_grpo_normalizes_within_group():
    cfg = PolliusConfig(group_size=2)
    rewards = np.array([1.0, 0.0, 1.0, 0.0])          # two groups of 2
    groups = np.array([0, 0, 1, 1])
    mask = np.ones((4, 3))
    adv = grpo_advantage(rewards, groups, mask, cfg)
    assert np.allclose(adv[0], 1.0) and np.allclose(adv[1], -1.0), adv
    print("ok: GRPO normalizes within each group independently")


def test_cispo_zero_advantage_zero_loss():
    cfg = PolliusConfig()
    old = np.full((2, 4), -1.0)
    new = np.full((2, 4), -0.5)
    adv = np.zeros((2, 4))
    mask = np.ones((2, 4))
    loss, m = cispo_loss(old, new, adv, mask, cfg)
    assert loss == 0.0 and m.clipfrac >= 0.0
    print("ok: CISPO loss is 0 when advantages are 0")


def test_cispo_clipfrac_rises_with_divergence():
    cfg = PolliusConfig(clip_ratio_low=0.2, clip_ratio_high=0.2)
    old = np.zeros((1, 5))
    adv = np.ones((1, 5))
    mask = np.ones((1, 5))
    near = cispo_loss(old, old + 0.01, adv, mask, cfg)[1].clipfrac   # ratio ~1
    far = cispo_loss(old, old + 2.0, adv, mask, cfg)[1].clipfrac     # ratio ~7 -> clipped
    assert far > near, (near, far)
    print(f"ok: CISPO clipfrac rises with divergence ({near:.2f} -> {far:.2f})")


def test_trainer_runs_end_to_end():
    cfg = PolliusConfig(num_steps=3, num_prompts_per_step=2, group_size=4)
    history = PolliusTrainer(cfg, MockRollout(cfg)).fit()
    assert len(history) == 3
    print("ok: trainer runs end-to-end")


def test_registered_combo_runs_end_to_end():
    for adv in sorted(ADVANTAGE_REGISTRY):
        for loss in sorted(POLICY_LOSS_REGISTRY):
            cfg = PolliusConfig(
                adv_estimator=adv, policy_loss=loss, num_steps=1, group_size=4
            )
            assert len(PolliusTrainer(cfg, MockRollout(cfg)).fit()) == 1, (adv, loss)
    print("ok: registered advantage x loss combinations run end-to-end")


if __name__ == "__main__":
    test_null_reward_is_zero()
    test_grpo_constant_group_is_zero()
    test_grpo_normalizes_within_group()
    test_cispo_zero_advantage_zero_loss()
    test_cispo_clipfrac_rises_with_divergence()
    test_trainer_runs_end_to_end()
    test_registered_combo_runs_end_to_end()
    print("\nall sanity checks passed")
