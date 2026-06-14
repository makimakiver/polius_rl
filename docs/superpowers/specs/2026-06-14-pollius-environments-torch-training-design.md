# pollius — Environments + real local-LLM training (design)

Date: 2026-06-14
Status: Approved for planning

## 1. Summary

Extend the `pollius` RL post-training skeleton from a numpy-only mock into a
framework that can **train a real local LLM** with **verifiable, per-task-type
rewards**, while keeping the existing teaching skeleton fully intact.

Two new capabilities, both additive:

1. **Environment box** — a fourth self-registering abstraction that bundles a
   task type's *question source* and its *reward rule*. Rewards are dispatched
   per sample according to the environment that produced the task, so a single
   batch can mix many task types (Lean proofs, logic quizzes, …).
2. **Torch backend** — a real training path (`TorchPolicyRollout`,
   `losses_torch`, `TorchTrainer`) that loads a small local model
   (`Qwen2.5-0.5B-Instruct`), generates candidates, and runs
   `loss.backward(); optimizer.step()` on MPS/CPU. The numpy mock path stays
   runnable.

Ship with **two environments** — `lean_proof` (real Lean4 verifier) and
`logic_quiz` (answer-match) — to prove the pattern generalizes.

## 2. Goals / Non-goals

**Goals**
- A working real RL-on-local-LLM loop (weights actually update via autograd).
- A pluggable `Environment` registry; new task types = "write one class".
- Real Lean4 verification via subprocess (fail-loud when the toolchain absent).
- `pass@k` (unbiased Codex estimator) logged per problem-group.
- Preserve the existing numpy mock path, its tests, and the `registry` pattern.

**Non-goals**
- Solving hard theorems. A 0.5B model will rarely produce valid Lean; the goal
  is a correct, runnable pipeline, not SOTA proving.
- Distributed/multi-GPU training, vLLM/SGLang serving, KL-to-reference penalty
  (a `kl_coef` hook may exist but defaults to 0 / out of scope).
- A real generator agent ("SPG"). We define the *interface* a generator-backed
  environment must satisfy (emit question + checker together); building the
  generator is future work.

## 3. Background / current state

`pollius/` today: `registry`, `config`, `types`, `rollout` (MockRollout),
`reward` (null stub), `advantage` (grpo/dr_grpo/rloo/reinforce),
`losses` (cispo/ppo/gspo/reinforce, numpy), `trainer`, plus `train_pollius.py`
and `tests/test_sanity.py` (12 passing). The model and optimizer are mocked;
losses are numpy (no autograd), so real training is impossible as-is.

Environment probe (2026-06-14): torch 2.10, transformers 5.2, **MPS available**,
no CUDA; `trl/peft/datasets/accelerate` absent; `lake` (Lean) absent.

## 4. Architecture

Four self-registering boxes + a selectable backend:

```
ENVIRONMENT (new)   reward + task source, dispatched per sample
  ├─ lean_proof     LeanVerifier reward, reads theorem folders
  └─ logic_quiz     answer-match reward, Q/A pairs
        │ produces Tasks
        ▼
ROLLOUT   MockRollout | FileRollout | TorchPolicyRollout(Qwen2.5-0.5B)
        │ generates G responses per task, tags sample.meta['env']
        ▼
REWARD dispatch   get_environment(s.meta['env']).reward(s.task, s.text, cfg) -> 0/1
        ▼
ADVANTAGE   grpo/dr_grpo/rloo/reinforce  (numpy box, REUSED, per-group)
        ▼
LOSS   numpy (mock)  |  losses_torch cispo/ppo/gspo/reinforce (autograd)
        ▼
STEP   mock no-op  |  loss.backward(); optimizer.step()  (real weights)
        ▼
METRICS   loss, mean_reward, pass@{1,k} per group, approx_kl, clipfrac
```

Advantages, `pass@k`, and the losses are **per-group and environment-agnostic**,
so a batch mixing environments works with no special handling.

## 5. Components

### 5.1 Environment box — `pollius/environments/`

```python
# pollius/environments/base.py
register_environment, get_environment, ENVIRONMENT_REGISTRY = make_registry("environment")

@dataclass
class Task:
    env: str            # which environment produced it
    problem_id: str
    prompt: str         # question shown to the model
    extra: dict         # env-specific ground truth (answer key, lean header, checker)

class Environment(Protocol):
    name: str
    def sample_tasks(self, n: int, rng) -> list[Task]: ...
    def reward(self, task: Task, response_text: str, config) -> float: ...
```

- `pollius/environments/lean_proof.py` — `LeanProofEnv`: `sample_tasks` reads
  `data/lean_proof/<problem>/{header.lean,prompt.txt}`; `reward` runs
  `LeanVerifier` on `header + response_text`.
- `pollius/environments/logic_quiz.py` — `LogicQuizEnv`: `sample_tasks` loads
  Q/A pairs (folder or inline); `reward` extracts the final answer and compares
  to `task.extra["answer"]`.
- Generator-backed environments (future) follow the same interface; the
  generator MUST emit `(question, checker)` pairs — a task with no checker
  yields no learning signal.

### 5.2 Lean verifier — `pollius/verifier.py`

```python
LeanVerifier(config).verify(lean_source) -> (ok: bool, detail: dict)
```
- Raise `RuntimeError` if `shutil.which("lake")` is None (real-only, fail loud).
- Write source to `<lean_project_dir>/_pollius_tmp_<uuid>.lean`; run
  `lake env lean <tmp>` (cwd=`lean_project_dir`, `timeout=lean_timeout_s`).
- `ok = (returncode == 0)`; if `reject_sorry` and (`sorry`/`admit` in source or
  "declaration uses 'sorry'" in stderr) → `ok = False`. Always clean up temp.
- Failure modes: missing toolchain (raise), compile error / timeout / sorry → ok=False.

### 5.3 Metrics — `pollius/metrics.py`

`pass_at_k(rewards, group_ids, k)` — unbiased estimator
`1 - C(n-c, k) / C(n, k)` per problem (n candidates, c correct), computed
stably; returns per-problem scores + mean, for each `k` in
`config.pass_at_k_values` (skip `k > n`).

### 5.4 Torch backend

- `pollius/policy.py` — `TorchPolicy`: wraps model + tokenizer; device
  `auto -> mps -> cpu`. `generate(prompt, G, max_new_tokens, temperature, top_p)`
  -> sequences + **detached** old log-probs + response mask; `logprobs(batch)`
  -> differentiable current per-token log-probs.
- `pollius/rollout.py` (edit) — `TorchPolicyRollout(config, policy, environments)`:
  draw a mix of tasks, generate G candidates each, build a `RolloutBatch` with
  real ids/mask/old_log_probs and `text`/`meta` (decoded `header+gen`, `env`,
  `task`). Also add `FileRollout` (reads pre-written `cand_*.lean`) for
  verifier/pass@k tests without a model.
- `pollius/losses_torch.py` — autograd torch ports of cispo/ppo/gspo/reinforce
  mirroring the numpy math; registry `get_torch_policy_loss_fn`. CISPO:
  `-(clamp(ratio, ...).detach() * adv * logp)` masked-mean.
- `pollius/trainer_torch.py` — `TorchTrainer.train_step()`:
  ```
  tasks   = draw minibatch across environments
  batch   = TorchPolicyRollout.generate(tasks, G)        # old_logp detached
  rewards = [get_environment(s.meta['env']).reward(s.task, s.text, cfg) for s in batch.samples()]
  adv     = get_advantage_fn(cfg.adv_estimator)(rewards, groups, mask, cfg)  # numpy box -> torch
  logp    = policy.logprobs(batch)                       # differentiable
  loss, m = get_torch_policy_loss_fn(cfg.policy_loss)(old_logp, logp, adv, mask, cfg)
  loss.backward(); clip_grad_norm_(cfg.grad_clip); optimizer.step(); zero_grad()
  log: loss, mean_reward, pass@{1,k}, approx_kl, clipfrac
  ```
  The advantage box is **reused as-is** (advantages are constants w.r.t. the
  policy — no autograd needed); only the loss is ported to torch.

### 5.5 Data structures — `pollius/types.py` (edit)

Add optional `text: str | None` and `meta: dict` to `Sample`; carry `task`/`env`
in `meta`. Add `texts`/`metas` to `RolloutBatch`, threaded through `.samples()`.
Existing numpy fields and shapes are unchanged; `MockRollout` leaves new fields
defaulted.

### 5.6 Config — `pollius/config.py` (edit)

```python
# environments
environments: tuple = ("lean_proof",)   # which envs to draw tasks from
# torch backend
model_name: str = "Qwen/Qwen2.5-0.5B-Instruct"
device: str = "auto"
max_new_tokens: int = 128
temperature: float = 1.0
top_p: float = 1.0
ppo_epochs: int = 1
grad_clip: float = 1.0
# lean + data + eval
data_dir: str = "data"
lean_project_dir: str = "lean_project"
lean_timeout_s: float = 30.0
reject_sorry: bool = True
pass_at_k_values: tuple = (1, 4)
```

### 5.7 Driver — `train_pollius_torch.py` (new)

Flags: `--model --data-dir --environments --group-size --steps --lr
--policy-loss --adv-estimator --max-new-tokens --temperature --device
--pass-at-k`. `choices` for `--policy-loss`/`--adv-estimator`/`--environments`
pulled live from the registries. `train_pollius.py` (mock) stays unchanged.

## 6. Data layout

```
data/
  lean_proof/
    add_comm/
      header.lean    # imports + theorem statement ending in ":= "
      prompt.txt     # NL instruction for the model
      cand_0.lean    # optional, only for FileRollout/verifier tests
  logic_quiz/
    parity_01/
      task.json      # {"prompt": "...", "answer": "..."}
```
Example Lean problems use **Mathlib-free core Lean** (e.g. `by rfl`/`by simp`)
so they verify under any toolchain without a heavy Mathlib build.

## 7. Error handling

- Missing `lake` → `LeanVerifier` raises `RuntimeError` with install guidance.
- Lean compile error / timeout / `sorry` → reward 0.0 (not an exception).
- Missing model / no network → `TorchPolicy` raises a clear error; torch E2E
  tests are gated behind `POLLIUS_RUN_TORCH_E2E=1`.
- Empty/malformed task folder → skipped with a logged warning.
- Device fallback `mps -> cpu` logged once.

## 8. Testing

**Always run (no model, no Lean):**
- `losses_torch` numerically match the numpy losses on small tensors.
- `pass_at_k` vs hand-computed values (n=5,c=2 → pass@1=0.4, pass@5=1.0).
- `LeanVerifier` with a stubbed `lake` (ok path, sorry-reject path, missing-lake raise).
- Environment registry: `lean_proof`/`logic_quiz` register; reward dispatch by
  `meta['env']`; `LogicQuizEnv.reward` correct on match/mismatch.
- Dataset/folder parsing on the example tree.

**Gated:**
- Real Lean verify of a trivial true theorem + a `sorry` proof — skip if `lake` absent.
- Real model E2E single step — run only if `POLLIUS_RUN_TORCH_E2E=1`.

Existing 12 numpy sanity tests must keep passing unchanged.

## 9. Risks / open items

- 0.5B model on MPS: seconds/step, rewards ~0 initially (expected). Keep
  `group_size`, `max_new_tokens`, and problem count small by default.
- `group_size` varies per problem for `FileRollout` (candidate count); the torch
  path fixes G via generation, so the trainer must not assume a global constant —
  infer per group.
- Lean project root with a toolchain is user-supplied; we cannot install Lean
  here. Example problems avoid Mathlib to minimize that burden.
- Repo is not a git repo yet; design doc commit requires `git init` (offer).

## 10. Rollout / sequencing (for the plan)

1. `Environment` base + registry + `Task`; wire reward dispatch (mock path first).
2. `verifier.py` + `lean_proof` env + example Lean data + tests.
3. `logic_quiz` env + data + tests (proves generalization).
4. `metrics.pass_at_k` + logging.
5. Torch backend: `policy.py`, `TorchPolicyRollout`, `losses_torch`,
   `trainer_torch`, `train_pollius_torch.py`.
6. Torch + Lean E2E (gated) and docs/README update.
```
