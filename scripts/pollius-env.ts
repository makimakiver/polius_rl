#!/usr/bin/env -S npx tsx
/**
 * Thin shim — the canonical implementation now lives in the publishable
 * `pollius-env` npm package. Kept so the documented path still works:
 *
 *   npx tsx scripts/pollius-env.ts deploy <dir> [--epoch]
 *
 * Prefer `npm run env -- deploy <dir> [--epoch]` or the published CLI
 * (`npx pollius-env deploy <dir> --epoch`).
 */
import "../packages/pollius-env/src/cli.ts";
