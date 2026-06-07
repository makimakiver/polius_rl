// Canonical registration message shared by the agent (signer) and the server
// (verifier). Field order is part of the contract — keep it stable.

export interface AgentRegistration {
  agent_name: string;
  address: string;
  description: string;
}

export interface SignedAgentRegistration extends AgentRegistration {
  /** ISO-8601 timestamp included in the signed message (prevents reuse). */
  ts: string;
  /** Random nonce included in the signed message. */
  nonce: string;
  /** base64 string of the personal-message signature. */
  signature: string;
}

export interface CheckSubnameResponse {
  name: string;
  registrationLink: string;
}

/**
 * Build the canonical message bytes to sign for an agent registration. The
 * server reconstructs the exact same bytes from the request body and verifies
 * the signature against `address`. Field order matters — keep it stable.
 */
export function buildRegistrationMessage(input: {
  agent_name: string;
  address: string;
  description: string;
  ts: string;
  nonce: string;
}): Uint8Array {
  const canonical = JSON.stringify({
    agent_name: input.agent_name,
    address: input.address,
    description: input.description,
    ts: input.ts,
    nonce: input.nonce,
  });
  return new TextEncoder().encode(canonical);
}
