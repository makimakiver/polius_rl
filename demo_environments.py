"""Demo: draw tasks from environments, score canned responses, report pass@k.

No model and no Lean needed -- logic_quiz scores by answer match, so this runs
anywhere and shows the Environment + dispatch + pass@k path end to end.

    python3 demo_environments.py
"""

from __future__ import annotations

import numpy as np

from pollius.core import PolliusConfig
from pollius.environments.dispatch import compute_rewards, load_environments
from pollius.algorithms import pass_at_k


def main() -> None:
    cfg = PolliusConfig(data_dir="data")
    envs = load_environments(("logic_quiz",), cfg)
    env = envs["logic_quiz"]

    rng = np.random.default_rng(0)
    tasks = env.sample_tasks(2, rng)

    # Fake G=4 "model" responses per task: 3 correct, 1 wrong (stand-in for rollout).
    group_size = 4
    flat_tasks, responses, group_ids = [], [], []
    for gi, task in enumerate(tasks):
        correct = f"Answer: {task.extra['answer']}"
        cands = [correct, correct, correct, "Answer: definitely-wrong"]
        for c in cands:
            flat_tasks.append(task)
            responses.append(c)
            group_ids.append(gi)

    rewards = compute_rewards(flat_tasks, responses, envs, cfg)
    group_ids = np.array(group_ids)

    print(f"tasks: {[t.problem_id for t in tasks]}  group_size={group_size}")
    print(f"mean reward: {np.mean(rewards):.3f}")
    for k in cfg.pass_at_k_values:
        _, mean = pass_at_k(rewards, group_ids, k)
        print(f"pass@{k}: {mean:.3f}")


if __name__ == "__main__":
    main()
