# pollius

A barebone, readable **RL post-training framework skeleton** implementing
**CISPO** (Clipped IS-weight Policy Optimization) with **GRPO** advantages and a
**null reward stub**. Modeled on the structure of verl / slime / OpenRLHF, but
reduced to its essence so the architecture is visible at a glance.

The CISPO loss and GRPO advantage are *real math*. The model and data source are
*mocked* — no GPU, no HuggingFace, one dependency (`numpy`).

## Pipeline

```
rollout (G samples/prompt)         pollius/rollout.py   (MockRollout — fake)
  -> reward()                      pollius/reward.py    (null stub -> 0.0)
  -> compute_advantage()           pollius/advantage.py (GRPO group-norm — real)
  -> cispo_loss()                  pollius/losses.py    (CISPO — real)
  -> optimizer step                pollius/trainer.py   (logged no-op — no params)
```

## Run

```bash
python3 train_pollius.py                       # null reward -> loss is 0 (by design)
python3 train_pollius.py --demo-random-reward  # inject a signal -> watch it move
python3 tests/test_sanity.py                   # math sanity checks
```

## The three swappable boxes

Each is a self-registering function found by name from `PolliusConfig`. Add an
algorithm by writing one decorated function — nothing else changes.

| Box | File | Registry name | Swap via |
|-----|------|---------------|----------|
| reward    | `pollius/reward.py`    | `null`  | `config.reward_fn` |
| advantage | `pollius/advantage.py` | `grpo`  | `config.adv_estimator` |
| policy loss | `pollius/losses.py`  | `cispo` | `config.policy_loss` |

## CISPO in one line

```
PPO:   loss = -min(ratio * A, clip(ratio) * A)        # clipped tokens get 0 gradient
CISPO: loss = -stopgrad(clip(ratio)) * A * log_prob   # every token keeps its gradient
```

The clipped importance ratio is used only as a detached weight; the gradient
flows entirely through `log_prob`, so no token is ever zeroed out by clipping.

> **numpy note:** numpy has no autograd, so the stop-gradient is implicit (the
> clipped ratio is just a constant multiplier). In a real torch trainer the line
> is `clipped = torch.clamp(ratio, ...).detach()` and the loss stays
> differentiable through `log_prob`. The computed numbers are identical.

## Filling in the reward

`null_reward` in `pollius/reward.py` returns `0.0`. With an all-zero reward,
GRPO advantages are all 0 and the CISPO loss is 0 — correct barebone behavior.
Replace the body with real scoring to start training.

## Why GRPO advantage (and why it matters)

The advantage estimator decides whether you need a **critic model**. GAE (classic
PPO) learns a per-token value function — a whole second model. GRPO uses the
group mean as the baseline: `A_i = (r_i - mean(group)) / (std(group) + eps)`,
no critic. CISPO is built on GRPO, so pollius has no critic, no value head, no
GAE loop. Advantage / reward / loss stay three independent boxes connected only
by tensors.
