from pathlib import Path
import sys

# import the single-module env package directly from ../sort-list/
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sort-list"))

from sort_list import _parse_ints, exact_match, partial_ratio  # noqa: E402


def _completion(text: str):
    return [{"role": "assistant", "content": text}]


def test_parse_ints():
    assert _parse_ints("3 1 2") == [3, 1, 2]
    assert _parse_ints("") == []
    assert _parse_ints("sorted: -2 0 5") == [-2, 0, 5]


def test_exact_match_correct():
    assert exact_match(_completion("1 2 3"), "1 2 3") == 1.0


def test_exact_match_wrong():
    assert exact_match(_completion("3 2 1"), "1 2 3") == 0.0


def test_exact_match_empty_output():
    assert exact_match(_completion(""), "1 2 3") == 0.0


def test_partial_ratio_between():
    r = partial_ratio(_completion("1 2 9"), "1 2 3")
    assert 0.0 < r < 1.0


def test_partial_ratio_perfect():
    assert partial_ratio(_completion("1 2 3"), "1 2 3") == 1.0
