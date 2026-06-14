"""A tiny name -> function registry.

This is the same idea verl/slime use (a decorator that drops a function into a
dict keyed by name, plus a lookup), reduced to its essence. Each of the three
swappable boxes -- reward, advantage, policy-loss -- gets its own registry, so a
new algorithm is "write a decorated function" and nothing else.
"""

from __future__ import annotations

from typing import Callable, Dict, Tuple


def make_registry(kind: str) -> Tuple[Callable, Callable, Dict[str, Callable]]:
    """Create an isolated registry.

    Returns ``(register, get, table)``:
      - ``register(name)``  -> decorator that stores the function under ``name``
      - ``get(name)``       -> retrieve it (clear error listing options if missing)
      - ``table``           -> the underlying dict (handy for tests / introspection)
    """
    table: Dict[str, Callable] = {}

    def register(name: str) -> Callable:
        def deco(fn: Callable) -> Callable:
            if name in table:
                raise ValueError(f"{kind} '{name}' is already registered")
            table[name] = fn
            return fn

        return deco

    def get(name: str) -> Callable:
        if name not in table:
            raise KeyError(
                f"Unknown {kind} '{name}'. Available: {sorted(table)}"
            )
        return table[name]

    return register, get, table
