from verifier.mpp_judge0 import Judge0Client


def test_mock_runs_and_returns_token():
    c = Judge0Client(mode="mock")
    r = c.run("print('0 1 2')", stdin="2 1 0\n")
    assert r.status == "Accepted"
    assert r.stdout.strip() == "0 1 2"
    assert r.token.startswith("mock_")
    assert r.usdc_pay_digest is None


def test_mock_executes_locally_for_real_stdout():
    c = Judge0Client(mode="mock")
    r = c.run("import sys; xs=[int(x) for x in sys.stdin.read().split()];"
              "print(' '.join(map(str, sorted(xs))))", stdin="5 -3 5\n")
    assert r.stdout.strip() == "-3 5 5"
