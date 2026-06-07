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
});

export default function Providers({ children }: { children: React.ReactNode }) {
  // Create the QueryClient once per browser session.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
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
