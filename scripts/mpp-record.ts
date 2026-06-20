// scripts/mpp-record.ts — submit record_verified_inference. Run via: node scripts/mpp-record.ts (JSON on stdin)
import { Transaction } from "@mysten/sui/transactions";
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromHex } from "@mysten/sui/utils";

const chunks: Buffer[] = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", async () => {
  const p = JSON.parse(Buffer.concat(chunks).toString());
  const client = new SuiClient({ url: p.rpc });
  const kp = Ed25519Keypair.fromSecretKey(p.sk); // suiprivkey... or 32B hex
  const tx = new Transaction();
  tx.moveCall({
    target: `${p.pkg}::inference_market::record_verified_inference`,
    arguments: [
      tx.object(p.registry),
      tx.pure.id(p.receipt_id),
      tx.pure.address(p.buyer),
      tx.pure.u64(p.version),
      tx.pure.u64(p.task_id),
      tx.pure.u64(p.pass_bps),
      tx.pure.vector("u8", Array.from(fromHex(p.output_hash.replace(/^0x/, "")))),
      tx.pure.string(p.judge0_token),
      tx.pure.u64(p.ts),
      tx.pure.vector("u8", Array.from(fromHex(p.signature_hex.replace(/^0x/, "")))),
    ],
  });
  const res = await client.signAndExecuteTransaction({
    signer: kp, transaction: tx, options: { showObjectChanges: true },
  });
  const vr = res.objectChanges?.find(
    (c: any) => c.type === "created" && String(c.objectType).endsWith("::VerifiedReceipt"));
  process.stdout.write(JSON.stringify({
    record_digest: res.digest, verified_receipt_id: (vr as any)?.objectId ?? null }));
});
