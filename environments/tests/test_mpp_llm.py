import subprocess
import sys

from verifier import mpp_llm


def test_mock_returns_runnable_sorter(monkeypatch):
    monkeypatch.setattr(mpp_llm, "MODE", "mock")
    src = mpp_llm.generate("Sort ascending; handle negatives + duplicates.")
    out = subprocess.run([sys.executable, "-c", src], input="5 -3 5 0 -3 9\n",
                         capture_output=True, text=True, timeout=8).stdout
    assert out.strip() == "-3 -3 0 5 5 9"


def test_generator_name_labels_mode(monkeypatch):
    monkeypatch.setattr(mpp_llm, "MODE", "mock")
    monkeypatch.setattr(mpp_llm, "PROVIDER", "groq")
    monkeypatch.setattr(mpp_llm, "MODEL", "llama-3.3-70b-versatile")
    assert mpp_llm.generator_name() == "mpp:groq/llama-3.3-70b-versatile (mock)"
    monkeypatch.setattr(mpp_llm, "MODE", "live")
    assert mpp_llm.generator_name() == "mpp:groq/llama-3.3-70b-versatile"


def test_enabled_reads_env(monkeypatch):
    monkeypatch.delenv("LLM_BACKEND", raising=False)
    assert mpp_llm.enabled() is False
    monkeypatch.setenv("LLM_BACKEND", "mpp")
    assert mpp_llm.enabled() is True
