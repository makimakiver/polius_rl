"use client";

import { useEffect, useState } from "react";
import AppNav from "./AppNav";

/**
 * Owns the foldable-sidebar state, renders the sidebar, and offsets the page
 * content to match (collapsed = icon rail, expanded = full sidebar).
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const v = localStorage.getItem("sidebar-collapsed");
    if (v) setCollapsed(v === "1");
  }, []);

  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      return next;
    });

  return (
    <>
      <AppNav collapsed={collapsed} onToggle={toggle} />
      <div
        className={`flex min-h-screen flex-1 flex-col transition-[padding] duration-200 ease-out ${
          collapsed ? "lg:pl-16" : "lg:pl-60"
        }`}
      >
        {children}
      </div>
    </>
  );
}
