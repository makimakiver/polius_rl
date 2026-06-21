#!/usr/bin/env -S npx tsx
/**
 * Withdraw a coin type from your Sui *address balance* (accumulator) into a real,
 * spendable Coin<T> object — then merge any existing coins of that type into it.
 *
 * Why: funds received via send_funds live in the address-balance accumulator. They
 * show up in `getBalance`/`getCoins` (totalBalance) but NOT in `getOwnedObjects`,
 * so `merge-coin` / wallets / oyster-cvm can't spend them until withdrawn. This does
 * the withdraw + redeem (`tx.withdrawal()` -> `0x2::coin::redeem_funds<T>`).
 *
 * Needs @mysten/sui >= 2.19 (the version that added `tx.withdrawal`). Run with:
 *   export SUI_PRIVATE_KEY=$(sui keytool export --key-identity <alias-or-addr> --json \
 *                             | python3 -c "import sys,json;print(json.load(sys.stdin)['exportedPrivateKey'])")
 *   COIN_TYPE=0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC \
 *     npx -y tsx scripts/withdraw-address-balance.ts            # add DRY_RUN=1 to simulate
 *
 * The final execute is a real mainnet transaction (gas in SUI). Review DRY_RUN output first.
 */
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

const RPC = process.env.SUI_RPC ?? "https://sui-rpc.publicnode.com"; // reliable keyless mainnet RPC
const COIN_TYPE = process.env.COIN_TYPE
  ?? "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const DRY_RUN = process.env.DRY_RUN === "1";

function die(m: string): never { console.error(`✗ ${m}`); process.exit(1); }

function keypairFrom(suiprivkey: string) {
  const { scheme, secretKey } = decodeSuiPrivateKey(suiprivkey.trim());
  if (scheme === "ED25519") return Ed25519Keypair.fromSecretKey(secretKey);
  if (scheme === "Secp256k1") return Secp256k1Keypair.fromSecretKey(secretKey);
  die(`unsupported key scheme: ${scheme}`);
}

async function main() {
  const sk = process.env.SUI_PRIVATE_KEY ?? die("SUI_PRIVATE_KEY not set (suiprivkey1…)");
  const kp = keypairFrom(sk);
  const me = kp.getPublicKey().toSuiAddress();
  const client = new SuiJsonRpcClient({ url: RPC });
  console.log(`▸ address  : ${me}`);
  console.log(`  coinType : ${COIN_TYPE}`);
  console.log(`  rpc      : ${RPC}`);

  // total (owned coins + accumulator) vs the real owned Coin objects
  const bal = await client.getBalance({ owner: me, coinType: COIN_TYPE });
  const total = BigInt(bal.totalBalance);
  const owned: { coinObjectId: string; balance: string }[] = [];
  let cursor: string | null | undefined = null;
  do {
    const page = await client.getCoins({ owner: me, coinType: COIN_TYPE, cursor });
    owned.push(...page.data);
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  const ownedSum = owned.reduce((s, c) => s + BigInt(c.balance), 0n);
  const addressBalance = total - ownedSum; // the accumulator portion

  const d = 1e6; // USDC has 6 decimals (display only)
  console.log(`  total    : ${Number(total) / d}`);
  console.log(`  owned    : ${Number(ownedSum) / d}  in ${owned.length} coin object(s)`);
  console.log(`  to withdraw (address balance): ${Number(addressBalance) / d}`);
  if (addressBalance <= 0n) die("nothing in the address balance to withdraw");

  // withdraw -> redeem -> merge existing coins in -> keep (transfer to self)
  const tx = new Transaction();
  const [coin] = tx.moveCall({
    target: "0x2::coin::redeem_funds",
    typeArguments: [COIN_TYPE],
    arguments: [tx.withdrawal({ amount: addressBalance, type: COIN_TYPE })],
  });
  if (owned.length) tx.mergeCoins(coin, owned.map((c) => tx.object(c.coinObjectId)));
  tx.transferObjects([coin], me);

  if (DRY_RUN) {
    tx.setSender(me);
    const bytes = await tx.build({ client });
    const sim = await client.dryRunTransactionBlock({ transactionBlock: bytes });
    console.log("DRY RUN status:", sim.effects.status);
    return;
  }
  const res = await client.signAndExecuteTransaction({
    signer: kp, transaction: tx,
    options: { showEffects: true, showBalanceChanges: true },
  });
  console.log("status :", res.effects?.status);
  console.log("digest :", res.digest);
  console.log("balanceChanges:", JSON.stringify(res.balanceChanges, null, 2));
}

main().catch((e) => die(String(e?.message ?? e)));
