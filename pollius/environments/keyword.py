"""keyword environment -- TEMPLATE for adding a new task type + verifier.

This is the whole recipe for SPG (or anyone) to add a new environment: copy this
file, rename it, set `name`, and implement `load_tasks` (the questions) and
`verify` (the checker). Dropping the file in `pollius/environments/` is enough --
it is auto-discovered and selectable via `PolliusConfig.environments=("keyword",)`.

This one passes if the response contains the task's keyword.
Layout: data_dir/keyword/<problem>/task.json = {"prompt": ..., "keyword": ...}.
"""

from __future__ import annotations

import json
import os

from pollius.environments.base import (
    Task,
    VerifiedEnvironment,
    iter_problem_dirs,
    register_environment,
)


@register_environment("keyword")
class KeywordEnv(VerifiedEnvironment):
    name = "keyword"

    def load_tasks(self) -> list:
        tasks = []
        for pid, pdir in iter_problem_dirs(self.root):
            task_path = os.path.join(pdir, "task.json")
            if not os.path.isfile(task_path):
                continue
            with open(task_path) as f:
                obj = json.load(f)
            tasks.append(Task(self.name, pid, obj["prompt"], {"keyword": obj["keyword"]}))
        return tasks

    def verify(self, task: Task, response_text: str, config) -> bool:
        return str(task.extra["keyword"]).lower() in response_text.lower()
