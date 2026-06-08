"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy text to the clipboard and expose a transient `copied` flag that resets
 * after `resetMs`. The reset timer is cleared on unmount.
 */
export function useClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), resetMs);
      } catch {
        // clipboard unavailable — leave the source visible for manual copy
        setCopied(false);
      }
    },
    [resetMs],
  );

  return { copied, copy };
}
