"""Informational copy of the on-chain grader for this environment.

The attested epoch uses GRADERS["lean_compiles"] in environments/verifier/epoch.py;
this file documents that logic for transparency (uploaded to Walrus with the bundle).

Grading: the proof (model output) is appended to the theorem statement (the
`question`, ending in `:=`) and compiled with the real Lean 4 toolchain. Reward is
1.0 iff Lean accepts it with no errors and no `sorry`/`admit`; otherwise 0.0.
"""
import os
import shutil
import subprocess
import tempfile

LEAN_TIMEOUT = int(os.environ.get("LEAN_TIMEOUT", "30"))


def _sanitize_proof(generated: str) -> str:
    s = (generated or "").strip()
    if s.startswith("```"):
        s = "\n".join(ln for ln in s.splitlines() if not ln.strip().startswith("```")).strip()
    # drop anything that escapes a pure proof: imports / commands (#eval, #check, ...)
    return "\n".join(
        ln for ln in s.splitlines()
        if not ln.strip().startswith(("import ", "#"))
    ).strip()


def reward(generated: str, answer: str = "", question: str = "") -> float:
    lean = shutil.which("lean")
    if not lean:
        raise RuntimeError("lean_compiles grader requires the Lean toolchain (`lean`) on PATH")
    proof = _sanitize_proof(generated)
    sig = (question or "").strip()
    if not proof or not sig:
        return 0.0
    src = f"{sig}\n  {proof}\n"
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "Proof.lean")
        with open(path, "w") as fh:
            fh.write(src)
        try:
            r = subprocess.run([lean, path], capture_output=True, text=True, timeout=LEAN_TIMEOUT)
        except subprocess.TimeoutExpired:
            return 0.0
    out = (r.stdout + "\n" + r.stderr).lower()
    if r.returncode != 0 or "error" in out or "sorry" in out or "admit" in out:
        return 0.0
    return 1.0
