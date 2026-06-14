"""TorchPolicy -- wraps an HF causal LM for generation + differentiable log-probs.

`generate` samples `group_size` responses for one prompt (chat-templated).
`logprobs` does a forward pass and returns per-token log-probs over the response
region only, shape (G, R). transformers is imported lazily so importing this
module stays cheap (the trainer's unit tests use a fake policy, no model).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

import torch


@dataclass
class GenGroup:
    """One prompt's worth of generations + what's needed to score them."""

    response_texts: List[str]
    sequences: torch.Tensor      # (G, L) full prompt+response token ids
    prompt_len: int              # number of prompt tokens (shared across the group)
    response_mask: torch.Tensor  # (G, R) 1.0 for real response tokens


def _select_device(pref: str) -> torch.device:
    if pref and pref != "auto":
        return torch.device(pref)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


class TorchPolicy:
    def __init__(self, config) -> None:
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.config = config
        self.device = _select_device(config.device)
        self.tokenizer = AutoTokenizer.from_pretrained(config.model_name)
        if self.tokenizer.pad_token_id is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        self.model = AutoModelForCausalLM.from_pretrained(
            config.model_name, dtype=torch.float32
        ).to(self.device)

    def parameters(self):
        return self.model.parameters()

    def generate(self, prompt_text: str, group_size: int) -> GenGroup:
        messages = [{"role": "user", "content": prompt_text}]
        enc = self.tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, return_tensors="pt", return_dict=True
        )
        ids = enc["input_ids"].to(self.device)
        attention_mask = enc["attention_mask"].to(self.device)
        prompt_len = ids.shape[1]
        with torch.no_grad():
            out = self.model.generate(
                ids,
                attention_mask=attention_mask,
                do_sample=True,
                temperature=self.config.temperature,
                top_p=self.config.top_p,
                max_new_tokens=self.config.max_new_tokens,
                num_return_sequences=group_size,
                pad_token_id=self.tokenizer.pad_token_id,
            )
        response_ids = out[:, prompt_len:]
        response_mask = (response_ids != self.tokenizer.pad_token_id).float()
        texts = self.tokenizer.batch_decode(response_ids, skip_special_tokens=True)
        return GenGroup(texts, out, prompt_len, response_mask)

    def logprobs(self, gen: GenGroup) -> torch.Tensor:
        seq = gen.sequences
        attn = (seq != self.tokenizer.pad_token_id).long()
        logits = self.model(seq, attention_mask=attn).logits      # (G, L, V)
        logp_all = torch.log_softmax(logits[:, :-1, :], dim=-1)    # (G, L-1, V)
        targets = seq[:, 1:].unsqueeze(-1)                         # (G, L-1, 1)
        tok_logp = torch.gather(logp_all, 2, targets).squeeze(-1)  # (G, L-1)
        return tok_logp[:, gen.prompt_len - 1:]                    # (G, R)
