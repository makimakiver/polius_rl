import {
  verifyPersonalMessageSignature,
  verifyTransactionSignature,
} from "@mysten/sui/verify";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { buildRegistrationMessage } from "./protocol";

export interface SignaturePayload {
  agent_name: string;
  address: string;
  description: string;
  ts: string;
  nonce: string;
  signature: string;
  /** Optional: when present, verify in transaction-wrap mode (Sui CLI path). */
  tx_bcs_b64?: string;
}

export type SignatureCheck =
  | { ok: true; mode: "personal" | "tx" }
  | { ok: false; status: 401 | 403; error: string; detail?: unknown };

/**
 * Verify a registration signature against the claimed `address`.
 *   - "personal": signature over the canonical message bytes (SDK clients).
 *   - "tx": signature over a TransactionData blob whose single Pure input holds
 *     the canonical message bytes (Sui CLI `keytool sign` path).
 */
export async function verifyAgentSignature(
  payload: SignaturePayload,
): Promise<SignatureCheck> {
  const expectedMessage = buildRegistrationMessage({
    agent_name: payload.agent_name,
    address: payload.address,
    description: payload.description,
    ts: payload.ts,
    nonce: payload.nonce,
  });

  if (payload.tx_bcs_b64) {
    return verifyTxMode(payload, expectedMessage);
  }
  return verifyPersonalMode(payload, expectedMessage);
}

async function verifyPersonalMode(
  payload: SignaturePayload,
  message: Uint8Array,
): Promise<SignatureCheck> {
  let recovered;
  try {
    recovered = await verifyPersonalMessageSignature(message, payload.signature);
  } catch (e) {
    return {
      ok: false,
      status: 401,
      error: "invalid personal-message signature",
      detail: (e as Error).message,
    };
  }
  const recoveredAddr = recovered.toSuiAddress();
  if (recoveredAddr !== payload.address) {
    return {
      ok: false,
      status: 403,
      error: "signature does not match address",
      detail: { expected: payload.address, recovered: recoveredAddr },
    };
  }
  return { ok: true, mode: "personal" };
}

async function verifyTxMode(
  payload: SignaturePayload,
  expectedMessage: Uint8Array,
): Promise<SignatureCheck> {
  const txBytes = base64ToBytes(payload.tx_bcs_b64!);

  let recovered;
  try {
    recovered = await verifyTransactionSignature(txBytes, payload.signature);
  } catch (e) {
    return {
      ok: false,
      status: 401,
      error: "invalid transaction signature",
      detail: (e as Error).message,
    };
  }
  if (recovered.toSuiAddress() !== payload.address) {
    return {
      ok: false,
      status: 403,
      error: "signature does not match address",
      detail: { expected: payload.address, recovered: recovered.toSuiAddress() },
    };
  }

  let txData;
  try {
    txData = Transaction.from(txBytes).getData();
  } catch (e) {
    return {
      ok: false,
      status: 401,
      error: "could not decode tx_bcs_b64 as TransactionData",
      detail: (e as Error).message,
    };
  }

  const pureInputs = (txData.inputs ?? []).filter(
    (i: { Pure?: { bytes?: string } | null }) => i?.Pure != null,
  );
  if (pureInputs.length !== 1) {
    return {
      ok: false,
      status: 403,
      error: `expected exactly 1 pure input, got ${pureInputs.length}`,
    };
  }

  const pureB64 = (pureInputs[0] as { Pure: { bytes: string } }).Pure.bytes;
  const pureBytes = base64ToBytes(pureB64);

  let inner: Uint8Array;
  try {
    inner = new Uint8Array(bcs.vector(bcs.u8()).parse(pureBytes));
  } catch (e) {
    return {
      ok: false,
      status: 403,
      error: "pure input is not a vector<u8>",
      detail: (e as Error).message,
    };
  }

  if (!bytesEqual(inner, expectedMessage)) {
    return {
      ok: false,
      status: 403,
      error: "embedded message does not match canonical registration message",
    };
  }

  return { ok: true, mode: "tx" };
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
