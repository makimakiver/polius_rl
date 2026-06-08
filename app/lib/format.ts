/** Formatting helpers shared across the app. */

/**
 * Truncate a (wallet/object) address to `lead…tail` form, e.g. 0x1895…4553.
 * Returns the address unchanged when it's already short enough.
 */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
