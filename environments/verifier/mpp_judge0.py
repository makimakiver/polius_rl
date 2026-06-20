"""Judge0 access via the MPP gateway (mpp.t2000.ai).

mock : execute the source locally in a subprocess, fabricate a token, no USDC.
live : POST /judge0/v1/submissions; on 402 call pay_fn(www_authenticate) to
       settle 0.02 USDC on Sui, then retry with the receipt header.
"""
import subprocess
import sys
import hashlib
from dataclasses import dataclass

MPP_BASE = "https://mpp.t2000.ai"
PY3 = 71


@dataclass
class Judge0Result:
    token: str
    stdout: str
    status: str
    usdc_pay_digest: str | None = None


class Judge0Client:
    def __init__(self, mode="mock", base_url=MPP_BASE, pay_fn=None):
        self.mode, self.base_url, self.pay_fn = mode, base_url, pay_fn

    def run(self, source_code: str, stdin: str = "", language_id: int = PY3) -> Judge0Result:
        if self.mode == "mock":
            try:
                p = subprocess.run([sys.executable, "-c", source_code], input=stdin,
                                   capture_output=True, text=True, timeout=5)
                out, status = p.stdout, ("Accepted" if p.returncode == 0 else "Runtime Error")
            except subprocess.TimeoutExpired:
                out, status = "", "Time Limit Exceeded"
            tok = "mock_" + hashlib.sha256((source_code + stdin).encode()).hexdigest()[:16]
            return Judge0Result(token=tok, stdout=out, status=status, usdc_pay_digest=None)
        return self._run_live(source_code, stdin, language_id)

    def _run_live(self, source_code, stdin, language_id):
        import httpx
        url = f"{self.base_url}/judge0/v1/submissions"
        body = {"source_code": source_code, "language_id": language_id, "stdin": stdin}
        with httpx.Client(timeout=30) as cx:
            r = cx.post(url, json=body)
            pay_digest = None
            if r.status_code == 402:
                if not self.pay_fn:
                    raise RuntimeError("402 from MPP but no pay_fn configured")
                pay_digest, receipt_header = self.pay_fn(r.headers.get("WWW-Authenticate", ""))
                r = cx.post(url, json=body, headers={"X-Payment": receipt_header})
            r.raise_for_status()
            data = r.json()
        return Judge0Result(
            token=str(data.get("token") or data.get("submission_id") or "live"),
            stdout=str(data.get("stdout") or ""),
            status=str(data.get("status", {}).get("description") if isinstance(data.get("status"), dict) else data.get("status") or "Accepted"),
            usdc_pay_digest=pay_digest)
