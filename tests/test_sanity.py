"""Minimal sanity checks for the real math. Run: python3 tests/test_sanity.py

No pytest required -- plain asserts so the skeleton stays dependency-light.
"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.advantage import (
    ADVANTAGE_REGISTRY,
    dr_grpo_advantage,
    grpo_advantage,
    rloo_advantage,
)
from pollius.config import PolliusConfig
from pollius.losses import POLICY_LOSS_REGISTRY, cispo_loss, ppo_loss, reinforce_loss
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
    # per group, std-normalized: [+1,-1]; broadcast across 3 tokens
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


# --- the algorithms added alongside grpo/cispo -------------------------------

def test_dr_grpo_centers_but_does_not_std_normalize():
    cfg = PolliusConfig(group_size=2)
    rewards = np.array([3.0, 1.0])                    # one group, mean 2.0
    groups = np.array([0, 0])
    mask = np.ones((2, 3))
    adv = dr_grpo_advantage(rewards, groups, mask, cfg)
    # mean-subtract only -> [+1, -1]; GRPO would std-normalize to the same here,
    # so use an asymmetric group to prove the std divide is absent:
    rewards2 = np.array([4.0, 0.0, 2.0])              # mean 2, std sqrt(8/3)~1.63
    groups2 = np.array([0, 0, 0])
    mask2 = np.ones((3, 2))
    dr = dr_grpo_advantage(rewards2, groups2, mask2, cfg)
    gr = grpo_advantage(rewards2, groups2, mask2, cfg)
    assert np.allclose(adv[0], 1.0) and np.allclose(adv[1], -1.0), adv
    assert np.allclose(dr[:, 0], [2.0, -2.0, 0.0]), dr      # raw centered values
    assert not np.allclose(dr, gr)                          # std divide changes grpo
    print("ok: dr_grpo centers without std-normalizing")


def test_rloo_uses_leave_one_out_baseline():
    cfg = PolliusConfig(group_size=4)
    rewards = np.array([4.0, 0.0, 0.0, 0.0])          # one group of 4
    groups = np.array([0, 0, 0, 0])
    mask = np.ones((4, 2))
    adv = rloo_advantage(rewards, groups, mask, cfg)
    # sample 0: 4 - mean(0,0,0)=4 ; samples 1-3: 0 - mean(4,0,0)=-4/3
    assert np.allclose(adv[0], 4.0), adv
    assert np.allclose(adv[1:], -4.0 / 3.0), adv
    print("ok: rloo uses leave-one-out baseline")


def test_zero_advantage_zero_loss_for_all_losses():
    cfg = PolliusConfig()
    old = np.full((2, 4), -1.0)
    new = np.full((2, 4), -0.5)
    adv = np.zeros((2, 4))
    mask = np.ones((2, 4))
    for name in sorted(POLICY_LOSS_REGISTRY):
        loss, m = POLICY_LOSS_REGISTRY[name](old, new, adv, mask, cfg)
        assert loss == 0.0, (name, loss)
    print("ok: every registered loss is 0 when advantages are 0")


def test_reinforce_loss_ignores_ratio():
    cfg = PolliusConfig()
    adv = np.ones((1, 3))
    mask = np.ones((1, 3))
    # two very different "old" policies, same current log_prob -> same loss,
    # because vanilla PG never looks at old_log_prob.
    new = np.full((1, 3), -0.5)
    a = reinforce_loss(np.full((1, 3), -1.0), new, adv, mask, cfg)[0]
    b = reinforce_loss(np.full((1, 3), -5.0), new, adv, mask, cfg)[0]
    assert a == b == float(-(adv * new).mean()), (a, b)
    print("ok: reinforce loss ignores the importance ratio")


def test_ppo_clip_caps_the_objective():
    cfg = PolliusConfig(clip_ratio_low=0.2, clip_ratio_high=0.2)
    old = np.zeros((1, 4))
    new = old + 2.0                                   # ratio ~7.4, well past 1.2
    adv = np.ones((1, 4))                             # positive adv -> clip binds
    mask = np.ones((1, 4))
    loss, m = ppo_loss(old, new, adv, mask, cfg)
    # clipped surrogate uses min(ratio*A, 1.2*A) = 1.2 -> loss = -1.2
    assert np.allclose(loss, -1.2), loss
    assert m.clipfrac == 1.0, m.clipfrac
    print("ok: ppo clip caps the objective at the clip bound")


def test_every_registered_combo_runs_end_to_end():
    for adv in sorted(ADVANTAGE_REGISTRY):
        for loss in sorted(POLICY_LOSS_REGISTRY):
            cfg = PolliusConfig(
                adv_estimator=adv, policy_loss=loss, num_steps=1, group_size=4
            )
            history = PolliusTrainer(cfg, MockRollout(cfg)).fit()
            assert len(history) == 1, (adv, loss)
    n = len(ADVANTAGE_REGISTRY) * len(POLICY_LOSS_REGISTRY)
    print(f"ok: all {n} advantage x loss combinations run end-to-end")


if __name__ == "__main__":
    test_null_reward_is_zero()
    test_grpo_constant_group_is_zero()
    test_grpo_normalizes_within_group()
    test_cispo_zero_advantage_zero_loss()
    test_cispo_clipfrac_rises_with_divergence()
    test_trainer_runs_end_to_end()
    test_dr_grpo_centers_but_does_not_std_normalize()
    test_rloo_uses_leave_one_out_baseline()
    test_zero_advantage_zero_loss_for_all_losses()
    test_reinforce_loss_ignores_ratio()
    test_ppo_clip_caps_the_objective()
    test_every_registered_combo_runs_end_to_end()
    print("\nall sanity checks passed")
