"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./wallet";
import { DashboardIcon, LayersIcon, ActivityIcon, SettingsIcon, PlusIcon, BotIcon } from "./icons";

const nav = [
  { label: "Dashboard", href: "/", icon: DashboardIcon },
  { label: "Market", href: "/market", icon: ActivityIcon },
  { label: "Agents", href: "/agents", icon: BotIcon },
  { label: "Environments", href: "/environments", icon: LayersIcon },
  { label: "Deploy", href: "/deploy", icon: PlusIcon },
  { label: "Settings", href: "#", icon: SettingsIcon },
];

function PanelIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      {/* little arrow hint */}
      <path d={collapsed ? "M13.5 9l3 3-3 3" : "M16.5 9l-3 3 3 3"} />
    </svg>
  );
}

export default function AppNav({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Fixed sidebar (desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-ink/15 bg-[#e8eaee] transition-[width] duration-200 ease-out lg:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        {/* header: brand + toggle */}
        <div className={`flex h-16 items-center border-b border-ink/15 ${collapsed ? "justify-center px-0" : "justify-between px-4"}`}>
          {!collapsed && (
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center border border-ink text-[11px] font-semibold">P</span>
              <span className="text-sm font-semibold uppercase tracking-[0.18em]">Pollius</span>
            </Link>
          )}
          <button
            onClick={onToggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-8 w-8 items-center justify-center text-ink/55 transition-colors hover:bg-ink/[0.06] hover:text-ink"
          >
            <PanelIcon collapsed={collapsed} />
          </button>
        </div>

        {/* nav */}
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {nav.map(({ label, href, icon: Icon }) => {
            const active = href.includes("#") ? false : pathname === href;
            return (
              <Link
                key={label}
                href={href}
                title={collapsed ? label : undefined}
                className={`flex items-center gap-3 border-l-2 py-2.5 text-sm transition-colors ${
                  collapsed ? "justify-center px-0" : "px-3"
                } ${
                  active
                    ? "border-accent bg-accent/[0.08] font-medium text-ink"
                    : "border-transparent text-ink/60 hover:bg-ink/[0.04] hover:text-ink"
                }`}
              >
                <Icon size={18} className={active ? "text-accent" : ""} />
                {!collapsed && label}
              </Link>
            );
          })}
        </nav>

        {/* wallet */}
        <div className={`border-t border-ink/15 ${collapsed ? "flex justify-center p-2" : "p-4"}`}>
          <WalletButton compact={collapsed} />
          {!collapsed && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-ink/40">Sui Testnet</p>
          )}
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-ink/15 bg-[#f1f3f6] px-5 lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center border border-ink text-[11px] font-semibold">P</span>
          <span className="text-sm font-medium tracking-tight">pollius rl</span>
        </Link>
        <div className="w-40">
          <WalletButton />
        </div>
      </header>
    </>
  );
}
