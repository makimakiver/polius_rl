"use client";

import { useRouter } from "next/navigation";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useWalletModal } from "./wallet";
import { btnPrimary } from "./ui";

export default function DeployButton({
  className = "",
  children = "Deploy an environment",
  href = "/deploy",
}: {
  className?: string;
  children?: React.ReactNode;
  href?: string;
}) {
  const account = useCurrentAccount();
  const { open } = useWalletModal();
  const router = useRouter();

  const base = `inline-flex items-center justify-center gap-2 ${btnPrimary}`;

  return (
    <button
      type="button"
      className={`${base} ${className}`}
      onClick={() => {
        if (account) {
          router.push(href);
        } else {
          // Not connected → open the wallet-selection modal first.
          open();
        }
      }}
    >
      {children}
    </button>
  );
}
