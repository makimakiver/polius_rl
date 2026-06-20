"""LLM inference via the MPP gateway (mpp.t2000.ai) — the product compute backend.

The served generation is produced by a hosted model fronted by MPP, paid per call
in USDC on Sui (x402) — the same settlement path as Judge0. No GPU to run.

backends (env LLM_BACKEND):
  "mpp"   -> generate through MPP's OpenAI-compatible AI endpoints (this module)
  "local" -> local transformers model (verifier.llm)
  unset   -> deterministic stand-in (verifier.solver)

MPP_MODE:
  "live"  -> real POST to MPP; 402 -> pay 0.02 USDC on Sui -> retry with receipt
  "mock"  -> no network/USDC; returns a canned correct program (clearly labelled)
"""
import os
from verifier.llm import _extract_code  # reuse the shared code extractor

MPP_BASE = os.environ.get("MPP_BASE", "https://mpp.t2000.ai")
PROVIDER = os.environ.get("MPP_LLM_PROVIDER", "groq")
MODEL = os.environ.get("MPP_LLM_MODEL", "llama-3.3-70b-versatile")
MODE = os.environ.get("MPP_MODE", "mock")

_SYSTEM = (
    "You write Python. Output ONLY a complete Python program (no prose) that reads "
    "integers from stdin and prints them sorted in ascending order, space-separated."
)

# Canned generation for mock mode (no USDC spent) — labelled "(mock)" so it is
# never mistaken for a real model call.
_MOCK_PROGRAM = (
    "import sys\n"
    "xs = [int(x) for x in sys.stdin.read().split()]\n"
    "print(' '.join(map(str, sorted(xs))))\n"
)


def enabled() -> bool:
    return os.environ.get("LLM_BACKEND") == "mpp"


def generator_name() -> str:
    suffix = "" if MODE == "live" else " (mock)"
    return f"mpp:{PROVIDER}/{MODEL}{suffix}"


def generate(prompt: str, max_tokens: int = 320, pay_fn=None) -> str:
    """Generate the served program via an MPP-fronted hosted model (real inference)."""
    if MODE != "live":
        return _MOCK_PROGRAM
    import httpx
    url = f"{MPP_BASE}/{PROVIDER}/v1/chat/completions"
    body = {
        "model": MODEL,
        "messages": [{"role": "system", "content": _SYSTEM},
                     {"role": "user", "content": prompt}],
        "max_tokens": max_tokens, "temperature": 0,
    }
    with httpx.Client(timeout=90) as cx:
        r = cx.post(url, json=body)
        if r.status_code == 402:
            if not pay_fn:
                raise RuntimeError("402 from MPP AI but no pay_fn (USDC payer) configured")
            _digest, receipt_header = pay_fn(r.headers.get("WWW-Authenticate", ""))
            r = cx.post(url, json=body, headers={"X-Payment": receipt_header})
        r.raise_for_status()
        data = r.json()
    text = data["choices"][0]["message"]["content"]
    return _extract_code(text)
