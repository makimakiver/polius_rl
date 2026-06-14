"""pollius — a barebone, readable RL post-training framework skeleton.

Pipeline (one training step):

    rollout (G samples/prompt)
        -> reward()            (null stub -> 0.0)
        -> compute_advantage() (GRPO group-norm)
        -> cispo_loss()        (Clipped IS-weight Policy Optimization)
        -> optimizer step      (logged no-op; no real params in the skeleton)

Three decoupled, self-registering boxes -- reward / advantage / policy-loss --
are looked up by name from `PolliusConfig`. Add an algorithm by writing one
decorated function; nothing else changes. The model and the data source are
mocked (`MockRollout`); the CISPO loss and GRPO advantage are real math.
"""

from pollius.config import PolliusConfig
from pollius.trainer import PolliusTrainer
from pollius.rollout import MockRollout, Rollout

__all__ = ["PolliusConfig", "PolliusTrainer", "MockRollout", "Rollout"]
