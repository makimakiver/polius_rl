"""The Environment box -- a task type's question source + reward rule.

An Environment bundles two things behind one interface so new task types are
"write one registered class": where questions come from (`sample_tasks`) and how
an answer is scored (`reward`). Each Sample is tagged with the env that produced
it, so a mixed batch is scored per-sample by dispatching to the right env.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from pollius.registry import make_registry

register_environment, get_environment, ENVIRONMENT_REGISTRY = make_registry(
    "environment"
)


@dataclass
class Task:
    """One question plus the ground truth its environment needs to score it."""

    env: str                       # which environment produced it
    problem_id: str                # stable id, also used as the group key
    prompt: str                    # the question shown to the model
    extra: dict = field(default_factory=dict)  # answer key / lean header / checker


class Environment(Protocol):
    """A task type. Implementations self-register with @register_environment."""

    name: str

    def sample_tasks(self, n: int, rng) -> list:  # list[Task]
        """Return up to `n` Tasks (fewer if the env has fewer problems)."""
        ...

    def reward(self, task: Task, response_text: str, config) -> float:
        """Score a generated response for `task`. Convention: 1.0 pass / 0.0 fail."""
        ...
