"""Run: python3 -m pytest tests/test_losses_torch.py -q"""

from __future__ import annotations

import math
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.core import PolliusConfig
from pollius import algorithms as np_losses
from pollius.backends import torch_llm as t_losses


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
    assert "cispo" in t_losses.TORCH_POLICY_LOSS_REGISTRY


def test_cispo_matches_numpy():
    cfg = PolliusConfig()
    old, new, adv, mask = _inputs()
    np_loss, _ = np_losses.cispo_loss(old, new, adv, mask, cfg)
    t_old, t_new, t_adv, t_mask = _to_torch(old, new, adv, mask)
    t_loss, m = t_losses.cispo_loss(t_old, t_new, t_adv, t_mask, cfg)
    assert math.isclose(float(t_loss.item()), np_loss, rel_tol=1e-9, abs_tol=1e-9)
    assert math.isfinite(m.approx_kl) and 0.0 <= m.clipfrac <= 1.0


def test_cispo_is_differentiable():
    cfg = PolliusConfig()
    old, new, adv, mask = _inputs()
    t_old, t_new, t_adv, t_mask = _to_torch(old, new, adv, mask)
    t_new.requires_grad_(True)
    t_loss, _ = t_losses.cispo_loss(t_old, t_new, t_adv, t_mask, cfg)
    t_loss.backward()
    assert t_new.grad is not None and torch.isfinite(t_new.grad).all()
