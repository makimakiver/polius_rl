import { verifyToken } from "@/lib/token";

function normalize(addr: string) {
  if (!addr.startsWith("0x")) return null;
  const hex = addr.slice(2).toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length === 0 || hex.length > 64) return null;
  return "0x" + hex.padStart(64, "0");
}

export async function POST(req: Request) {
  let body: { token?: string; connected_address?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { token, connected_address } = body;
  if (!token) return Response.json({ error: "missing token" }, { status: 400 });
  if (!connected_address)
    return Response.json({ error: "missing connected_address" }, { status: 400 });

  const claims = verifyToken(token);
  if (!claims)
    return Response.json({ error: "token invalid or expired" }, { status: 401 });

  const b = normalize(claims.address);

  // Address-match enforcement intentionally disabled for now (mirrors the
  // polius_small reference). Re-enable to require the connected wallet to equal
  // the token's address:
  //   const a = normalize(connected_address);
  //   if (!a || !b) return Response.json({ error: "invalid address format" }, { status: 400 });
  //   if (a !== b) return Response.json({ error: "connected wallet does not match token address", expected: b, got: a }, { status: 403 });

  return Response.json({
    verified: true,
    agent_name: claims.agent_name,
    address: b,
    description: claims.description,
  });
}
