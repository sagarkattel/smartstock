"use client";

import { Logo } from "@/components/layout/Sidebar";
import { Avatar } from "@/components/ui/Avatar";
import { MenuIcon } from "@/components/ui/icons";
import { useMe } from "@/lib/queries";

export function Topbar({ onMenu }) {
  const me = useMe();
  const name = me.data?.name ?? "A to Z Vending";

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3 lg:hidden">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open menu"
          className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <MenuIcon className="size-6" />
        </button>
        <Logo />
      </div>

      <p className="ml-auto flex items-center gap-3 text-sm">
        <Avatar id={me.data?.avatar} name={name} className="size-9" />
        <span className="hidden font-medium sm:block">{name}</span>
      </p>
    </header>
  );
}
