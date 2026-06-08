/**
 * Shared Tailwind class strings reused across forms and CTAs.
 * Keep these in sync with the design system rather than re-declaring per page.
 */

// Text/select/textarea inputs (B&W with sky focus ring).
export const fieldCls =
  "w-full border border-ink/15 bg-white/60 px-3 py-2 text-sm outline-none transition-colors focus:border-accent placeholder:text-ink/30";

// Small uppercase field label.
export const labelCls =
  "mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink/50";

// Primary pill CTA: filled ink, inverts to outline on hover.
export const btnPrimary =
  "rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-ink";
