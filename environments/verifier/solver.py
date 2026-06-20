"""Curated sort-list task bank D + a version-conditioned solution generator.

The generator stands in for the served LoRA checkpoint: low versions emit a
wrong/partial program (the honest FAIL), higher versions emit a correct one
(the PASS). Real deployments swap generate_solution() for the loaded model.
"""
import hashlib
from dataclasses import dataclass


@dataclass
class Task:
    prompt: str
    hidden_tests: list  # list[(stdin, expected_stdout)]


def _mk(nums_list):
    tests = []
    for nums in nums_list:
        stdin = " ".join(map(str, nums)) + "\n"
        expected = " ".join(map(str, sorted(nums))) + "\n"
        tests.append((stdin, expected))
    return tests


TASKS = {
    # easy baseline even v0 passes
    1: Task("Sort the list ascending.", _mk([[3, 1, 2], [2, 1]])),
    # frontier task only the improved model passes (duplicates + negatives)
    7: Task("Sort ascending; handle negatives + duplicates.",
            _mk([[5, -3, 5, 0, -3, 9], [-1, -2, -2, 10, 0], [4, 4, 4, 1]])),
}

_CORRECT = (
    "import sys\n"
    "xs=[int(x) for x in sys.stdin.read().split()]\n"
    "print(' '.join(map(str, sorted(xs))))\n"
)
_IDENTITY = (  # wrong: echoes input order
    "import sys\n"
    "xs=[int(x) for x in sys.stdin.read().split()]\n"
    "print(' '.join(map(str, xs)))\n"
)
_NO_DEDUP_OK = _CORRECT  # placeholder for mid versions; correct for sort


def generate_solution(task_id: int, version: int) -> str:
    """Produce the served program.

    REAL inference: if REAL_LLM=1 and the ML deps are present, the trained model
    GENERATES the program (genuine LLM inference, graded by Judge0 downstream).
    Otherwise a deterministic version-conditioned stand-in is used — honestly
    labelled as such via verifier.llm.generator_name().
    """
    from verifier import llm
    if llm.available():
        return llm.generate(TASKS[task_id].prompt)
    # stand-in: task 1 (easy) correct from v0; task 7 (frontier) correct only from v2+
    if task_id == 1:
        return _CORRECT
    return _CORRECT if version >= 2 else _IDENTITY


def score(task_id: int, runner) -> tuple:
    task = TASKS[task_id]
    passed = 0
    last_out = ""
    for stdin, expected in task.hidden_tests:
        out = runner(None, stdin)
        last_out = out
        if out.strip() == expected.strip():
            passed += 1
    n = len(task.hidden_tests)
    pass_bps = (passed * 10000) // n
    out_hash = hashlib.sha256(last_out.strip().encode()).digest()
    return pass_bps, out_hash, last_out
