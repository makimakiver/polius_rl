import pytest
from verifier.orchestrator import plan_promotions


def test_plan_orders_and_validates():
    plan = plan_promotions([("v0", 2000), ("v1", 3500), ("v2", 8000), ("v3", 10000)])
    assert [b for b, _ in plan] == ["v0", "v1", "v2", "v3"]
    assert all(plan[i][1] < plan[i + 1][1] for i in range(len(plan) - 1))


def test_plan_sorts_unordered_input():
    plan = plan_promotions([("v2", 8000), ("v0", 2000), ("v3", 10000), ("v1", 3500)])
    assert [bps for _, bps in plan] == [2000, 3500, 8000, 10000]


def test_plan_rejects_empty():
    with pytest.raises(ValueError):
        plan_promotions([])


def test_plan_rejects_non_increasing():
    with pytest.raises(ValueError):
        plan_promotions([("v0", 5000), ("v1", 5000)])
