from verifier.solver import TASKS, generate_solution, score
import subprocess
import sys


def _local_runner(source, stdin):
    p = subprocess.run([sys.executable, "-c", source], input=stdin,
                       capture_output=True, text=True, timeout=5)
    return p.stdout


def test_v0_fails_hard_task():
    # version 0 emits a deliberately wrong sort (identity) for the frontier task
    pass_bps, _, _ = score(7, lambda s, i: _local_runner(generate_solution(7, 0), i))
    assert pass_bps == 0


def test_v3_passes_hard_task():
    pass_bps, out_hash, _ = score(7, lambda s, i: _local_runner(generate_solution(7, 3), i))
    assert pass_bps == 10000
    assert len(out_hash) == 32
