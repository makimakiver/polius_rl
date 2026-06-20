"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createNetworkConfig,
  SuiClientProvider,
  WalletProvider,
} from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { WalletModalProvider } from "./components/wallet";
import { RegisterEnokiWallets } from "./components/RegisterEnokiWallets";

const { networkConfig } = createNetworkConfig({
  testnet: { url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" },
  mainnet: { url: getJsonRpcFullnodeUrl("mainnet"), network: "mainnet" },
  devnet: { url: getJsonRpcFullnodeUrl("devnet"), network: "devnet" },
  localnet: { url: "http://127.0.0.1:9000", network: "localnet" },
});

// Default network is env-driven (NEXT_PUBLIC_SUI_NETWORK), falling back to testnet
// for shipped builds. Set it to "localnet" to read a local `sui start` deployment.
const DEFAULT_NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ??
  "testnet") as "testnet" | "mainnet" | "devnet" | "localnet";

export default function Providers({ children }: { children: React.ReactNode }) {
  // Create the QueryClient once per browser session.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={DEFAULT_NETWORK}>
        {/* We build our own connect UI (see ./components/wallet), so dapp-kit's
            prebuilt ConnectButton/ConnectModal and its CSS are not used. */}
        <WalletProvider autoConnect>
          <RegisterEnokiWallets />
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
