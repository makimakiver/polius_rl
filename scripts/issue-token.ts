/**
 * Dev-only: mint a valid agent registration token for walking the
 * /agents/register flow locally. Requires AUTH_SECRET in the environment
 * (source .env.local first). NOT for production use.
 *
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/issue-token.ts --name demo-agent --address 0xabc --role trader --desc "demo"
 */
import { issueToken, verifyToken } from "../lib/token";

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const claims = {
  agent_name: arg("--name", "demo-agent"),
  address: arg(
    "--address",
    "0x0000000000000000000000000000000000000000000000000000000000000abc",
  ),
  role: arg("--role", "trader"),
  description: arg("--desc", "a demo agent"),
};

const token = issueToken(claims);
const ok = !!verifyToken(token);

console.log("\nclaims:", claims);
console.log("\ntoken:\n" + token);
console.log("\nlink:\n/agents/register/" + encodeURIComponent(token));
console.log("\nroundtrip verify:", ok ? "OK" : "FAILED");
