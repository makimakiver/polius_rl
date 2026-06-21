import re
def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower()).strip()
def reward(generated: str, answer: str) -> float:
    """1.0 if the expected capital appears in the model's answer (normalized)."""
    a = _norm(answer)
    return 1.0 if a and a in _norm(generated) else 0.0
