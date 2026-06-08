/**
 * Polius agent self-registration. Signs the canonical registration message with
 * a Sui keypair and POSTs it to the Polius API, printing the registration link
 * the owner opens to finish verification.
 *
 *   node agent-skill/register.mjs --name my-bot --description "what I do"
 *
 * Env:
 *   POLIUS_BASE_URL   default http://localhost:3000
 *   SUI_PRIVATE_KEY   suiprivkey... bech32; if unset a fresh key is generated + printed
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const BASE = process.env.POLIUS_BASE_URL ?? "http://localhost:3000";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

const agent_name = (arg("--name") ?? "").trim().toLowerCase();
const description = (arg("--description") ?? "").trim();

if (!agent_name) {
  console.error('usage: node agent-skill/register.mjs --name <label> --description "<text>"');
  process.exit(1);
}

let keypair;
let generated = false;
const sk = process.env.SUI_PRIVATE_KEY;
if (sk) {
  keypair = Ed25519Keypair.fromSecretKey(sk.trim());
} else {
  keypair = new Ed25519Keypair();
  generated = true;
}

const address = keypair.toSuiAddress();
const ts = new Date().toISOString();
const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
  b.toString(16).padStart(2, "0"),
).join("");

// Field order MUST match the server's buildRegistrationMessage exactly.
const canonical = JSON.stringify({ agent_name, address, description, ts, nonce });
const message = new TextEncoder().encode(canonical);
const { signature } = await keypair.signPersonalMessage(message);

const res = await fetch(`${BASE}/api/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ agent_name, address, description, ts, nonce, signature }),
});

const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`registration failed (${res.status}):`, JSON.stringify(json));
  process.exit(1);
}

if (generated) {
  console.log("Generated a new Sui keypair — SAVE THIS to reuse the identity:");
  console.log("  address:        ", address);
  console.log("  SUI_PRIVATE_KEY:", keypair.getSecretKey());
  console.log("");
}
console.log("registered name:  ", json.name);
console.log("registrationLink: ", json.registrationLink);
