"""Tests for the Environment box. Run: python3 -m pytest tests/test_environments.py -q"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.registry import make_registry
from pollius.environments.base import (
    ENVIRONMENT_REGISTRY,
    Task,
    get_environment,
    register_environment,
)


def test_task_defaults_extra_to_empty_dict():
    t = Task(env="x", problem_id="p1", prompt="q")
    assert t.extra == {}
    assert t.env == "x" and t.problem_id == "p1" and t.prompt == "q"


def test_environment_registry_register_and_get():
    reg, get, table = make_registry("tmp-env")

    @reg("demo")
    class DemoEnv:
        name = "demo"

    assert get("demo") is DemoEnv
    assert "demo" in table


def test_module_level_register_and_get_environment():
    @register_environment("unit_test_env")
    class _UnitTestEnv:
        name = "unit_test_env"

    assert get_environment("unit_test_env") is _UnitTestEnv
    assert "unit_test_env" in ENVIRONMENT_REGISTRY
