"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const DEFAULT_OVERLAY = "wm-overlay absolute inset-0 bg-black/55 backdrop-blur-[3px]";
const DEFAULT_CONTAINER = "fixed inset-0 z-[100] flex items-center justify-center p-4";

/**
 * Portal-rendered modal shell: handles the SSR `mounted` guard, the dimmed
 * overlay (click to close), and Esc-to-close. Callers provide their own panel
 * as `children` so the chrome stays caller-owned.
 */
export function Modal({
  open,
  onClose,
  children,
  overlayClassName = DEFAULT_OVERLAY,
  containerClassName = DEFAULT_CONTAINER,
  closeOnEsc = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  overlayClassName?: string;
  containerClassName?: string;
  closeOnEsc?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOnEsc, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className={containerClassName}>
      <button aria-label="Close" onClick={onClose} className={overlayClassName} />
      {children}
    </div>,
    document.body,
  );
}

/** The square outline `×` button shared by the wallet and agent-detail modals. */
export function CloseButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label="Close"
      className={`flex h-7 w-7 items-center justify-center border border-ink/15 text-ink/60 transition-colors hover:border-ink hover:text-ink ${className}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
