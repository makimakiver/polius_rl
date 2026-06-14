"""Evaluation metrics. pass@k uses the unbiased Codex estimator.

For a problem with n samples of which c pass:

    pass@k = 1 - C(n-c, k) / C(n, k)

computed via math.comb (exact integers, no factorial overflow). Groups with
n < k are skipped (reported as NaN and excluded from the mean).
"""

from __future__ import annotations

from math import comb
from typing import Dict, Tuple

import numpy as np


def _pass_at_k_single(n: int, c: int, k: int) -> float:
    if k > n:
        return float("nan")
    if c == 0:
        return 0.0
    if n - c < k:        # too few failures to fill k slots -> a pass is guaranteed
        return 1.0
    return 1.0 - comb(n - c, k) / comb(n, k)


def pass_at_k(rewards, group_ids, k: int) -> Tuple[Dict[int, float], float]:
    """Per-problem pass@k and the mean over problems.

    `rewards` are per-sample scores; any value > 0 counts as a pass. Returns
    ``(per_problem: {group_id -> pass@k}, mean over non-NaN problems)``.
    """
    rewards = np.asarray(rewards, dtype=np.float64)
    group_ids = np.asarray(group_ids)

    per_problem: Dict[int, float] = {}
    for g in np.unique(group_ids):
        members = group_ids == g
        n = int(members.sum())
        c = int((rewards[members] > 0).sum())
        per_problem[int(g)] = _pass_at_k_single(n, c, k)

    valid = [v for v in per_problem.values() if not np.isnan(v)]
    mean = float(np.mean(valid)) if valid else float("nan")
    return per_problem, mean
