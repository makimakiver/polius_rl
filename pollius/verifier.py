"""Lean4 proof verifier -- shells out to `lake env lean` on a temp file.

Real-only by choice: if the Lean toolchain is absent, `verify` RAISES rather
than silently passing. A proof is accepted only if Lean compiles it AND it
contains no `sorry`/`admit` (which compile with a warning but prove nothing).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from typing import Dict, Tuple


class LeanVerifier:
    def __init__(self, config) -> None:
        self.config = config

    def verify(self, lean_source: str) -> Tuple[bool, Dict[str, str]]:
        """Return ``(ok, {"stderr": ...})``. Raises if `lake` is not on PATH."""
        lake = shutil.which("lake")
        if lake is None:
            raise RuntimeError(
                "Lean toolchain not found: 'lake' is not on PATH. Install elan/Lean "
                "(https://leanprover.github.io/) and set config.lean_project_dir to a "
                "Lake project."
            )

        proj = self.config.lean_project_dir
        os.makedirs(proj, exist_ok=True)
        tmp = os.path.join(proj, f"_pollius_tmp_{uuid.uuid4().hex}.lean")
        with open(tmp, "w") as f:
            f.write(lean_source)

        stderr = ""
        try:
            result = subprocess.run(
                [lake, "env", "lean", tmp],
                cwd=proj,
                capture_output=True,
                text=True,
                timeout=self.config.lean_timeout_s,
            )
            ok = result.returncode == 0
            stderr = result.stderr or ""
        except subprocess.TimeoutExpired:
            ok, stderr = False, "timeout"
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

        if self.config.reject_sorry and (
            "sorry" in lean_source
            or "admit" in lean_source
            or "uses 'sorry'" in stderr
        ):
            ok = False

        return ok, {"stderr": stderr[:500]}
