"""sort-list: a toy verifiers environment.

The model is given a shuffled list of integers and must return them sorted in
ascending order, space-separated. Scoring is deterministic.
"""

import difflib
import re

SYSTEM_PROMPT = (
    "You sort lists of integers. Given a list, reply with ONLY the integers "
    "sorted in ascending order, space-separated, and nothing else."
)


def _parse_ints(text: str) -> list[int]:
    return [int(x) for x in re.findall(r"-?\d+", text or "")]


def exact_match(completion, answer, **kwargs) -> float:
    """1.0 iff the model's integer sequence equals the sorted answer, else 0.0."""
    got = _parse_ints(completion[-1]["content"])
    want = _parse_ints(answer)
    return 1.0 if got == want else 0.0


def partial_ratio(completion, answer, **kwargs) -> float:
    """Continuous difflib similarity (0..1) between the sequences — metric only."""
    got = _parse_ints(completion[-1]["content"])
    want = _parse_ints(answer)
    if not want:
        return 0.0
    a = " ".join(map(str, got))
    b = " ".join(map(str, want))
    return difflib.SequenceMatcher(None, a, b).ratio()
