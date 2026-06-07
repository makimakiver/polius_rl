"use client";

import { useEffect } from "react";
import { useSuiClient, useSuiClientContext } from "@mysten/dapp-kit";
import { isEnokiNetwork, registerEnokiWallets } from "@mysten/enoki";
import type { ClientWithCoreApi } from "@mysten/sui/client";

/**
 * Registers Enoki zkLogin wallets (e.g. "Sign in with Google") into the
 * wallet-standard registry so they appear in `useWallets()` next to browser
 * wallets and connect through the same dapp-kit flow. Renders nothing.
 *
 * Must live inside <SuiClientProvider> / <WalletProvider>.
 */
export function RegisterEnokiWallets() {
  const client = useSuiClient();
  const { network } = useSuiClientContext();

  useEffect(() => {
    // Only register on networks Enoki supports + when env is configured.
    if (!isEnokiNetwork(network)) return;

    const apiKey = process.env.NEXT_PUBLIC_ENOKI_API_KEY;
    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!apiKey || !googleClientId) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[enoki] NEXT_PUBLIC_ENOKI_API_KEY / NEXT_PUBLIC_GOOGLE_CLIENT_ID not set — skipping zkLogin registration.",
        );
      }
      return;
    }

    const { unregister } = registerEnokiWallets({
      apiKey,
      providers: {
        google: {
          clientId: googleClientId,
          // Lightweight page the OAuth popup lands on. Must be whitelisted in
          // both the Google console and the Enoki portal.
          redirectUrl: `${window.location.origin}/auth/callback`,
        },
      },
      // dapp-kit's SuiClient satisfies the runtime contract Enoki needs;
      // cast bridges minor @mysten/sui version differences between packages.
      client: client as unknown as ClientWithCoreApi,
      network,
    });

    return unregister; // clean up on network change / unmount
  }, [client, network]);

  return null;
}
