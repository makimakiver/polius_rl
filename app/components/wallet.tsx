"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  useWallets,
  useConnectWallet,
  useCurrentAccount,
  useDisconnectWallet,
} from "@mysten/dapp-kit";
import type { WalletWithRequiredFeatures } from "@mysten/wallet-standard";
import { isEnokiWallet, type AuthProvider } from "@mysten/enoki";

/* ------------------------------------------------------------------ */
/* Modal open/close context so the sidebar button + Deploy CTA share it */
/* ------------------------------------------------------------------ */

const WalletModalContext = createContext<{ open: () => void; close: () => void; isOpen: boolean } | null>(
  null
);

export function useWalletModal() {
  const ctx = useContext(WalletModalContext);
  if (!ctx) throw new Error("useWalletModal must be used within WalletModalProvider");
  return ctx;
}

export function WalletModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <WalletModalContext.Provider
      value={{ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }}
    >
      {children}
      <WalletModal />
    </WalletModalContext.Provider>
  );
}

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* The fully custom wallet-selection modal                            */
/* ------------------------------------------------------------------ */

function parseWalletError(err: unknown): string {
  // EnokiClientError hides the real reason in `.errors[0].message` / `.cause`;
  // its top-level `.message` is just "Request to Enoki API failed (status: N)".
  const e = err as {
    message?: string;
    code?: string;
    cause?: { message?: string };
    errors?: { message?: string; code?: string }[];
  } | undefined;
  const detail =
    e?.errors?.[0]?.message || e?.cause?.message || (err instanceof Error ? err.message : String(err));
  const msg = detail ?? "";

  if (/reject|denied|cancel/i.test(msg)) return "Connection request was cancelled.";
  if (/not installed|no accounts|unavailable/i.test(msg)) return "Wallet unavailable — is it installed and unlocked?";
  // In dev, surface the real reason so connect failures (e.g. Enoki salt/proof
  // errors after a successful OAuth redirect) are debuggable.
  if (process.env.NODE_ENV !== "production" && msg) {
    return `Couldn't connect: ${msg}${e?.code ? ` (${e.code})` : ""}`;
  }
  return "Couldn't connect. Please try again.";
}

const PROVIDER_LABELS: Partial<Record<AuthProvider, string>> = {
  google: "Google",
  facebook: "Facebook",
  twitch: "Twitch",
};

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

function WalletModal() {
  const { isOpen, close } = useWalletModal();
  const allWallets = useWallets();
  // zkLogin (Enoki) wallets vs. installed browser wallets.
  const enokiWallets = allWallets.filter(isEnokiWallet);
  const wallets = allWallets.filter((w) => !isEnokiWallet(w));
  const { mutate: connect } = useConnectWallet();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!isOpen) {
      setConnecting(null);
      setError(null);
    }
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  const handleConnect = (wallet: WalletWithRequiredFeatures) => {
    setConnecting(wallet.name);
    setError(null);
    connect(
      { wallet },
      {
        onSuccess: () => close(),
        onError: (e) => {
          const ee = e as { status?: number; code?: string; errors?: unknown };
          console.error("[wallet] connect failed:", e, {
            status: ee?.status,
            code: ee?.code,
            errors: ee?.errors,
          });
          setConnecting(null);
          setError(parseWalletError(e));
        },
      }
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* overlay */}
      <button
        aria-label="Close"
        onClick={close}
        className="wm-overlay absolute inset-0 bg-black/55 backdrop-blur-[3px]"
      />

      {/* panel */}
      <div className="wm-panel relative w-full max-w-sm border border-ink/15 bg-background shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em]">
              Connect a wallet
            </h2>
            <p className="mt-1 text-xs text-ink/50">Select a Sui wallet to continue</p>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center border border-ink/15 text-ink/60 transition-colors hover:border-ink hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* sky accent rule */}
        <div className="h-px w-full bg-gradient-to-r from-accent/70 via-accent/20 to-transparent" />

        {/* zkLogin (Enoki) — social sign-in, no wallet install needed */}
        {enokiWallets.length > 0 && (
          <div className="flex flex-col gap-2 p-4 pb-0">
            {enokiWallets.map((wallet) => {
              const provider = (wallet as { provider?: AuthProvider }).provider;
              const label = (provider && PROVIDER_LABELS[provider]) ?? wallet.name;
              const isConnecting = connecting === wallet.name;
              return (
                <button
                  key={wallet.name}
                  onClick={() => handleConnect(wallet as WalletWithRequiredFeatures)}
                  disabled={connecting !== null}
                  className="group flex items-center gap-3 border border-ink/15 bg-white/60 px-3 py-3 text-left transition-colors hover:border-accent hover:bg-accent/[0.06] disabled:opacity-60"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                    {provider === "google" ? <GoogleGlyph /> : null}
                  </span>
                  <span className="flex-1 text-sm font-medium">Sign in with {label}</span>
                  <span className="font-mono text-xs text-ink/40 group-hover:text-accent">
                    {isConnecting ? "connecting…" : "zkLogin →"}
                  </span>
                </button>
              );
            })}
            <div className="flex items-center gap-3 py-2">
              <span className="h-px flex-1 bg-ink/10" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink/35">or</span>
              <span className="h-px flex-1 bg-ink/10" />
            </div>
          </div>
        )}

        {/* wallet list */}
        <div className="flex flex-col gap-2 p-4">
          {wallets.length === 0 && enokiWallets.length === 0 && (
            <div className="border border-dashed border-ink/20 p-6 text-center">
              <p className="text-sm text-ink/70">No Sui wallets detected.</p>
              <a
                href="https://slush.app"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                Install Slush →
              </a>
            </div>
          )}

          {wallets.map((wallet) => {
            const isConnecting = connecting === wallet.name;
            return (
              <button
                key={wallet.name}
                onClick={() => handleConnect(wallet)}
                disabled={connecting !== null}
                className="group flex items-center gap-3 border border-ink/15 bg-white/40 px-3 py-3 text-left transition-colors hover:border-accent hover:bg-accent/[0.06] disabled:opacity-60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={wallet.icon}
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 rounded-md"
                />
                <span className="flex-1 text-sm font-medium">{wallet.name}</span>
                <span className="font-mono text-xs text-ink/40 group-hover:text-accent">
                  {isConnecting ? "connecting…" : "connect →"}
                </span>
              </button>
            );
          })}

          {error && (
            <p className="border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-600">
              {error}
            </p>
          )}
        </div>

        {/* footer */}
        <div className="border-t border-ink/10 px-5 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink/40">
            Sui · Testnet
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/* The wallet button (sidebar / top bar) — custom, B&W                */
/* ------------------------------------------------------------------ */

function WalletGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <path d="M3 7V6a2 2 0 0 1 2-2h11" />
      <circle cx="16.5" cy="13" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const account = useCurrentAccount();
  const { open } = useWalletModal();
  const { mutate: disconnect } = useDisconnectWallet();
  const [menu, setMenu] = useState(false);

  // Collapsed sidebar: icon-only square button
  if (compact) {
    if (!account) {
      return (
        <button
          onClick={open}
          title="Connect wallet"
          aria-label="Connect wallet"
          className="flex h-10 w-10 items-center justify-center bg-ink text-background transition-colors hover:bg-black"
        >
          <WalletGlyph />
        </button>
      );
    }
    return (
      <div className="relative">
        <button
          onClick={() => setMenu((v) => !v)}
          title={account.address}
          aria-label={`Account ${truncate(account.address)}`}
          className="relative flex h-10 w-10 items-center justify-center rounded-full bg-ink font-mono text-xs font-semibold uppercase text-background transition-colors hover:bg-black"
        >
          {account.address.slice(2, 4)}
          <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-[#e8eaee] bg-accent" />
        </button>
        {menu && (
          <>
            <button className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(false)} aria-hidden />
            <div className="absolute bottom-0 left-full z-20 ml-2 w-44 border border-ink/15 bg-background shadow-lg">
              <div className="border-b border-ink/10 px-4 py-2.5 font-mono text-xs text-ink/60">
                {truncate(account.address)}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(account.address);
                  setMenu(false);
                }}
                className="block w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/[0.08] hover:text-accent"
              >
                Copy address
              </button>
              <button
                onClick={() => {
                  disconnect();
                  setMenu(false);
                }}
                className="block w-full border-t border-ink/10 px-4 py-2.5 text-left text-sm transition-colors hover:bg-ink hover:text-background"
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!account) {
    return (
      <button
        onClick={open}
        className="w-full bg-ink px-4 py-2.5 text-sm font-medium text-background transition-colors hover:bg-black"
      >
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenu((v) => !v)}
        className="flex w-full items-center justify-between gap-2 bg-ink px-4 py-2.5 text-sm font-medium text-background transition-colors hover:bg-black"
      >
        <span className="font-mono">{truncate(account.address)}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {menu && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(false)} aria-hidden />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-full border border-ink/15 bg-background shadow-lg">
            <button
              onClick={() => {
                navigator.clipboard?.writeText(account.address);
                setMenu(false);
              }}
              className="block w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/[0.08] hover:text-accent"
            >
              Copy address
            </button>
            <button
              onClick={() => {
                disconnect();
                setMenu(false);
              }}
              className="block w-full border-t border-ink/10 px-4 py-2.5 text-left text-sm transition-colors hover:bg-ink hover:text-background"
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
