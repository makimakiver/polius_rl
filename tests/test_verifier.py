"""Tests for LeanVerifier. Run: python3 -m pytest tests/test_verifier.py -q"""

from __future__ import annotations

import os
import subprocess
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius import verifier as V
from pollius.config import PolliusConfig


class _Result:
    def __init__(self, returncode, stderr=""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = ""


def _cfg(tmp_path):
    return PolliusConfig(lean_project_dir=str(tmp_path), reject_sorry=True)


def test_missing_lake_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(V.shutil, "which", lambda _: None)
    with pytest.raises(RuntimeError):
        V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := trivial")


def test_returncode_zero_is_ok(monkeypatch, tmp_path):
    monkeypatch.setattr(V.shutil, "which", lambda _: "/usr/bin/lake")
    monkeypatch.setattr(V.subprocess, "run", lambda *a, **k: _Result(0))
    ok, detail = V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := trivial")
    assert ok is True


def test_nonzero_returncode_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(V.shutil, "which", lambda _: "/usr/bin/lake")
    monkeypatch.setattr(V.subprocess, "run", lambda *a, **k: _Result(1, "error: unknown identifier"))
    ok, detail = V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := nonsense")
    assert ok is False
    assert "unknown identifier" in detail["stderr"]


def test_sorry_is_rejected_even_if_returncode_zero(monkeypatch, tmp_path):
    monkeypatch.setattr(V.shutil, "which", lambda _: "/usr/bin/lake")
    monkeypatch.setattr(V.subprocess, "run", lambda *a, **k: _Result(0, "warning: declaration uses 'sorry'"))
    ok, _ = V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := by sorry")
    assert ok is False


def test_timeout_fails(monkeypatch, tmp_path):
    def _boom(*a, **k):
        raise subprocess.TimeoutExpired(cmd="lake", timeout=1)
    monkeypatch.setattr(V.shutil, "which", lambda _: "/usr/bin/lake")
    monkeypatch.setattr(V.subprocess, "run", _boom)
    ok, detail = V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := trivial")
    assert ok is False and detail["stderr"] == "timeout"


def test_tempfile_is_cleaned_up(monkeypatch, tmp_path):
    monkeypatch.setattr(V.shutil, "which", lambda _: "/usr/bin/lake")
    monkeypatch.setattr(V.subprocess, "run", lambda *a, **k: _Result(0))
    V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := trivial")
    leftovers = [f for f in os.listdir(tmp_path) if f.startswith("_pollius_tmp_")]
    assert leftovers == []
