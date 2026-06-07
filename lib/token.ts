import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function loadSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    throw new Error(
      "AUTH_SECRET is not set. Add it to .env.local — generate with: openssl rand -hex 32",
    );
  }
  if (s.length < 32) {
    throw new Error(
      `AUTH_SECRET is too short (${s.length} chars). Use at least 32 characters.`,
    );
  }
  return s;
}

const SECRET = loadSecret();

export interface AgentClaims {
  agent_name: string;
  address: string;
  description: string;
}

interface SignedPayload extends AgentClaims {
  exp: number;
  jti: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function issueToken(claims: AgentClaims, ttlSeconds = 600): string {
  const payload: SignedPayload = {
    ...claims,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    jti: randomBytes(8).toString("hex"),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token: string): SignedPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = b64url(createHmac("sha256", SECRET).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString()) as SignedPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
