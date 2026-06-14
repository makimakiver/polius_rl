"""logic_quiz environment -- Q/A tasks scored by exact answer match.

Layout: data_dir/logic_quiz/<problem>/task.json = {"prompt": ..., "answer": ...}.
The reward extracts the last `Answer: <x>` line (or the last non-empty line) and
compares it, case-insensitively, to the stored answer.
"""

from __future__ import annotations

import json
import os
import re

from pollius.environments.base import Task, register_environment


def _extract_answer(text: str) -> str:
    matches = re.findall(r"answer\s*[:=]\s*(.+)", text, flags=re.IGNORECASE)
    if matches:
        return matches[-1].strip().lower()
    lines = [ln for ln in text.strip().splitlines() if ln.strip()]
    return lines[-1].strip().lower() if lines else ""


@register_environment("logic_quiz")
class LogicQuizEnv:
    name = "logic_quiz"

    def __init__(self, config) -> None:
        self.config = config
        self.root = os.path.join(config.data_dir, "logic_quiz")

    def _problems(self):
        out = []
        if not os.path.isdir(self.root):
            return out
        for name in sorted(os.listdir(self.root)):
            task_path = os.path.join(self.root, name, "task.json")
            if not os.path.isfile(task_path):
                continue
            with open(task_path) as f:
                obj = json.load(f)
            out.append((name, obj["prompt"], str(obj["answer"])))
        return out

    def sample_tasks(self, n: int, rng) -> list:
        probs = self._problems()
        if not probs:
            return []
        if n <= len(probs):
            idx = rng.permutation(len(probs))[:n]
        else:
            idx = rng.integers(0, len(probs), size=n)
        return [
            Task("logic_quiz", probs[i][0], probs[i][1], {"answer": probs[i][2]})
            for i in idx
        ]

    def reward(self, task: Task, response_text: str, config) -> float:
        want = str(task.extra["answer"]).strip().lower()
        return 1.0 if _extract_answer(response_text) == want else 0.0
