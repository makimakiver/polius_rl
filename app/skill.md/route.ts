import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET() {
  try {
    const md = await readFile(join(process.cwd(), "agent-skill", "SKILL.md"), "utf8");
    return new Response(md, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  } catch {
    return new Response("skill not found", { status: 404 });
  }
}
