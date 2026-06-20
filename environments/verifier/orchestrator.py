"""Demo orchestrator — seed v0→vN checkpoints and promote them on a cadence.

`plan_promotions` is the pure, testable core: it validates and orders a list of
(walrus_blob_id, pass_rate_bps) checkpoints so each promotion is a strict
improvement (the FAIL→PASS arc the demo shows). `promote` shells `sui client
call` to append a checkpoint on-chain; `main` walks the plan with a sleep cadence.
"""
import os
import subprocess
import sys
import time


def plan_promotions(checkpoints):
    """Order checkpoints ascending by pass rate; assert a strictly improving arc.

    checkpoints: list[(blob_id: str, pass_rate_bps: int)]
    returns the same list sorted by pass_rate_bps ascending.
    Raises ValueError on empty input or a non-increasing arc.
    """
    if not checkpoints:
        raise ValueError("no checkpoints to promote")
    ordered = sorted(checkpoints, key=lambda c: c[1])
    for i in range(len(ordered) - 1):
        if ordered[i][1] >= ordered[i + 1][1]:
            raise ValueError(
                f"pass rates must strictly increase: {ordered[i]} !< {ordered[i + 1]}"
            )
    return ordered


def promote(env, blob_id, pass_rate_bps):
    """Append a checkpoint on-chain via `sui client call publish_checkpoint`.

    env: dict with pkg, registry, cap, clock (object ids). Uses the active
    sui CLI address (the PublisherCap holder).
    """
    cmd = [
        "sui", "client", "call",
        "--package", env["pkg"],
        "--module", "inference_market",
        "--function", "publish_checkpoint",
        "--args", env["registry"], env["cap"], blob_id, str(pass_rate_bps), env["clock"],
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f"publish_checkpoint failed: {r.stderr or r.stdout}")
    return r.stdout


def main():
    cadence = float(os.environ.get("PROMOTE_CADENCE_S", "20"))
    env = {
        "pkg": os.environ["NEXT_PUBLIC_PKG_ID"],
        "registry": os.environ["NEXT_PUBLIC_MARKET_REGISTRY"],
        "cap": os.environ["PUBLISHER_CAP_ID"],
        "clock": os.environ.get("SUI_CLOCK_ID", "0x6"),  # shared Clock object
    }
    checkpoints = [
        ("nUEB_sort_v0", 2000), ("nUEB_sort_v1", 3500),
        ("nUEB_sort_v2", 8000), ("nUEB_sort_v3", 10000),
    ]
    for blob_id, bps in plan_promotions(checkpoints):
        print(f"promoting {blob_id} @ {bps/100:.0f}% …", flush=True)
        promote(env, blob_id, bps)
        time.sleep(cadence)
    print("done — registry advanced to current-best.", file=sys.stderr)


if __name__ == "__main__":
    main()
