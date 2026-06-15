"""pollius -- a barebone, readable RL post-training framework skeleton.

Layout:
    core.py          config + data structures
    registry.py      the name->algorithm registry primitive
    algorithms.py    GRPO advantage, CISPO loss (numpy), pass@k
    backends/mock.py     no-GPU mock training path
    backends/torch_llm.py real Qwen training (generate -> reward -> backprop)
    environments/    the task-type box (verifier + auto-discovered envs)

The torch backend is imported on demand (keeps `import pollius` torch-free).
"""

from pollius.core import LossMetrics, PolliusConfig, RolloutBatch, Sample
from pollius.backends.mock import MockRollout, PolliusTrainer, Rollout
from pollius.registry import make_registry

__all__ = [
    "PolliusConfig",
    "PolliusTrainer",
    "MockRollout",
    "Rollout",
    "Sample",
    "RolloutBatch",
    "LossMetrics",
    "make_registry",
]
