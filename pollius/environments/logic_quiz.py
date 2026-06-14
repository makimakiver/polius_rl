"""logic_quiz environment -- Q/A tasks scored by exact answer match.

Layout: data_dir/logic_quiz/<problem>/task.json = {"prompt": ..., "answer": ...}.
`verify` extracts the last `Answer: <x>` line (or the last non-empty line) and
compares it, case-insensitively, to the stored answer.
"""

from __future__ import annotations

import json
import os
import re

from pollius.environments.base import (
    Task,
    VerifiedEnvironment,
    iter_problem_dirs,
    register_environment,
)


def _extract_answer(text: str) -> str:
    matches = re.findall(r"answer\s*[:=]\s*(.+)", text, flags=re.IGNORECASE)
    if matches:
        return matches[-1].strip().lower()
    lines = [ln for ln in text.strip().splitlines() if ln.strip()]
    return lines[-1].strip().lower() if lines else ""


@register_environment("logic_quiz")
class LogicQuizEnv(VerifiedEnvironment):
    name = "logic_quiz"

    def load_tasks(self) -> list:
        tasks = []
        for pid, pdir in iter_problem_dirs(self.root):
            task_path = os.path.join(pdir, "task.json")
            if not os.path.isfile(task_path):
                continue
            with open(task_path) as f:
                obj = json.load(f)
            tasks.append(Task(self.name, pid, obj["prompt"], {"answer": str(obj["answer"])}))
        return tasks

    def verify(self, task: Task, response_text: str, config) -> bool:
        want = str(task.extra["answer"]).strip().lower()
        return _extract_answer(response_text) == want
