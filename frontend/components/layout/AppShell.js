"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { Toaster } from "@/components/ui/Toaster";
import { getSidebarCollapsed, setSidebarCollapsed, subscribeSidebar } from "@/lib/sidebar";

/** Side navigation + top bar around every signed-in screen. */
export function AppShell({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarCollapsed, () => false);
  const pathname = usePathname();

  // The phone menu closes after you pick a screen.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="min-h-screen">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setSidebarCollapsed(!collapsed)}
      />
      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-[4.75rem]" : "lg:pl-60"}`}>
        <Topbar onMenu={() => setMenuOpen(true)} />
        <div className="px-4 pb-12 sm:px-6">{children}</div>
      </div>
      <Toaster />
    </div>
  );
}
