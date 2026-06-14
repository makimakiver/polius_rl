"""Discover environments, instantiate them by name, and score by origin env.

`load_environments` turns config names into live env instances; `compute_rewards`
scores each (task, response) pair by dispatching to the env named on the task --
this is what lets one batch mix many task types.

Environments are AUTO-DISCOVERED: every module under `pollius/environments/` is
imported on load, so its @register_environment runs. To add a new task type, just
drop a file in that folder -- no import wiring here, nothing else to edit.
"""

from __future__ import annotations

import importlib
import pkgutil
from typing import Dict, List

from pollius import environments as _environments_pkg
from pollius.environments.base import Task, get_environment


def _autodiscover_environments() -> None:
    """Import every env module so its @register_environment decorator runs."""
    for module in pkgutil.iter_modules(_environments_pkg.__path__):
        if module.name in ("base", "dispatch"):
            continue
        importlib.import_module(f"pollius.environments.{module.name}")


_autodiscover_environments()


def load_environments(names, config) -> Dict[str, object]:
    """Instantiate each named environment. Returns {name: env_instance}."""
    return {name: get_environment(name)(config) for name in names}


def compute_rewards(
    tasks: List[Task],
    responses: List[str],
    envs: Dict[str, object],
    config,
) -> List[float]:
    """Score each response with the environment that produced its task.

    Raises KeyError if a task names an environment not in `envs` (fail fast on a
    misconfigured batch rather than silently scoring 0).
    """
    rewards = []
    for task, response in zip(tasks, responses):
        if task.env not in envs:
            raise KeyError(
                f"Task references env '{task.env}' not loaded. "
                f"Loaded: {sorted(envs)}"
            )
        rewards.append(float(envs[task.env].reward(task, response, config)))
    return rewards
