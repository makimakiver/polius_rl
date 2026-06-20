"""Real LLM inference: generate the served solution with a trained model.

This is the actual "sell inference from a trained LLM" path. When REAL_LLM=1
the verifier loads a local model (Qwen-0.5B by default, with an optional LoRA
adapter) and *generates* a Python program for the task — instead of returning a
hand-written stand-in. The generation is then executed + graded by Judge0 and
the verdict attested on-chain, exactly as before.

torch/transformers/peft are imported lazily so the default stand-in path (and
the test suite) need no ML dependencies. Run the service with a Python that has
them installed (e.g. the system interpreter) and REAL_LLM=1 to serve real
inference.
"""
import os
import re
import threading

_LOCK = threading.Lock()
_CACHE: dict = {}

MODEL_DIR = os.environ.get("LLM_MODEL_DIR", "/Users/makimakiver/qwen-0.5b")
ADAPTER_DIR = os.environ.get("LLM_ADAPTER_DIR", "")  # optional LoRA adapter

_SYSTEM = (
    "You write Python. Output ONLY a complete Python program (no prose) that reads "
    "integers from stdin and prints them sorted in ascending order, space-separated."
)


def generator_name() -> str:
    """Honest label for what produced the served output."""
    if os.environ.get("REAL_LLM") != "1":
        return "stand-in"
    base = os.path.basename(MODEL_DIR.rstrip("/")) or "model"
    return f"{base}+lora" if ADAPTER_DIR else base


def available() -> bool:
    if os.environ.get("REAL_LLM") != "1":
        return False
    try:
        import importlib.util as u
        return all(u.find_spec(m) for m in ("torch", "transformers"))
    except Exception:
        return False


def _load():
    with _LOCK:
        if "model" in _CACHE:
            return _CACHE["model"], _CACHE["tok"]
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        tok = AutoTokenizer.from_pretrained(MODEL_DIR)
        model = AutoModelForCausalLM.from_pretrained(MODEL_DIR, dtype=torch.float32)
        if ADAPTER_DIR:
            from peft import PeftModel
            model = PeftModel.from_pretrained(model, ADAPTER_DIR)
        model.eval()
        _CACHE["model"], _CACHE["tok"], _CACHE["torch"] = model, tok, torch
        return model, tok


def _extract_code(text: str) -> str:
    m = re.search(r"```(?:python)?\s*(.*?)```", text, re.S)
    return (m.group(1) if m else text).strip()


def generate_chat(system: str, user: str, max_new_tokens: int = 64) -> str:
    """Greedy chat completion from the loaded model (raw text, no code extraction)."""
    model, tok = _load()
    torch = _CACHE["torch"]
    enc = tok.apply_chat_template(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        add_generation_prompt=True, return_tensors="pt", return_dict=True,
    )
    with torch.no_grad():
        out = model.generate(**enc, max_new_tokens=max_new_tokens, do_sample=False,
                             pad_token_id=tok.eos_token_id)
    return tok.batch_decode(out[:, enc["input_ids"].shape[1]:], skip_special_tokens=True)[0]


def generate(task_prompt: str, max_new_tokens: int = 220) -> str:
    """Run the trained model and return an executable Python program (real inference)."""
    return _extract_code(generate_chat(_SYSTEM, task_prompt, max_new_tokens))
