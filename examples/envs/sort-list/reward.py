import re
def reward(generated: str, answer: str) -> float:
    g = [int(x) for x in re.findall(r"-?\d+", generated or "")]
    a = [int(x) for x in re.findall(r"-?\d+", answer or "")]
    return 1.0 if g == a else 0.0
