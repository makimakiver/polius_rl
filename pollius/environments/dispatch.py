"""Instantiate environments by name and score responses by their origin env.

`load_environments` turns config names into live env instances (importing the
env modules so their @register_environment decorators have run). `compute_rewards`
scores each (task, response) pair by dispatching to the env named on the task --
this is what lets one batch mix many task types.
"""

from __future__ import annotations

from typing import Dict, List

# Import side-effect: registers the shipped environments.
from pollius.environments import lean_proof as _lean_proof  # noqa: F401
from pollius.environments import logic_quiz as _logic_quiz  # noqa: F401
from pollius.environments.base import Task, get_environment


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
