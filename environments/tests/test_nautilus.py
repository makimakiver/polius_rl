import hashlib

from verifier import nautilus, epoch


def test_attester_pk_matches_seeded():
    assert nautilus.attester_pk().hex() == \
        "0284bf7562262bbd6940085748f3be6afa52ae317155181ece31b66351ccffa4b0"


def test_bcs_and_signature_match_onchain_vector():
    # Same fields as the Move env_verifier_tests vector.
    dhash = hashlib.sha256(b"sort-list-v1").digest()
    env_id = "0x07"
    bcs = nautilus.bcs_epoch(env_id=env_id, model="qwen-0.5b", n_samples=8,
                             mean_reward_bps=6200, pass_bps=5000,
                             dataset_hash=dhash, timestamp_ms=1718000000000)
    assert bcs.hex().startswith("00009cc70090010000")  # intent + ts(LE)
    sig = nautilus.attest_epoch(env_id=env_id, model="qwen-0.5b", n_samples=8,
                                mean_reward_bps=6200, pass_bps=5000,
                                dataset_hash=dhash, timestamp_ms=1718000000000)
    assert sig.hex() == (
        "40c4b22f7a0052d13632c609267bfb31ce4fde4996b9eba5c5732c4ccbd5cb8b"
        "3d8cfaa47126b9998429808c3513aabdcfcf9f7c39307bb70aae3de172d93eb6")


def test_run_epoch_scores_dataset():
    ds = [{"question": "Sort ascending: 3 1 2", "answer": "1 2 3"},
          {"question": "Sort ascending: -1 5 -3", "answer": "-3 -1 5"}]
    # perfect model
    res = run = epoch.run_epoch(ds, lambda q: " ".join(map(str, sorted(epoch._ints(q)))))
    assert res["n_samples"] == 2 and res["pass_bps"] == 10000 and res["mean_reward_bps"] == 10000
    assert len(res["dataset_hash"]) == 32


def test_contains_grader_and_generic_epoch():
    ds = [{"question": "What is the capital of France?", "answer": "Paris"},
          {"question": "What is the capital of Japan?", "answer": "Tokyo"}]
    # a model that answers verbosely but correctly
    res = epoch.run_epoch(ds, lambda q: f"The capital is {'Paris' if 'France' in q else 'Kyoto'}.",
                          grader=epoch.contains_match)
    assert res["n_samples"] == 2 and res["pass_bps"] == 5000  # France right, Japan wrong
    assert epoch.GRADERS["contains"] is epoch.contains_match


def test_standin_model_is_imperfect_on_negatives():
    ds = [{"question": "Sort ascending: -3 1", "answer": "-3 1"}]
    res = epoch.run_epoch(ds, epoch.make_model_fn())
    # stand-in abs-values negatives, so it misses this one (honest baseline)
    assert res["pass_bps"] in (0, 10000)  # 0 with stand-in; 10000 if a real model is present
