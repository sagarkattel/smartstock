"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DatabaseIcon, PaletteIcon, UserIcon } from "@/components/ui/icons";
import { pagePaths } from "@/config/paths";

const SECTIONS = [
  { label: "General", href: pagePaths.settingsGeneral, Icon: DatabaseIcon, hint: "Data, retraining, models" },
  { label: "Appearance", href: pagePaths.settingsAppearance, Icon: PaletteIcon, hint: "Theme" },
  { label: "Profile", href: pagePaths.settingsProfile, Icon: UserIcon, hint: "Name, password, picture" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="flex gap-2 overflow-x-auto rounded-2xl border border-border bg-surface p-2 [scrollbar-width:none] lg:flex-col lg:overflow-visible">
      {SECTIONS.map(({ label, href, Icon, hint }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring ${
              active ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <Icon className="size-5 shrink-0" />
            <span className="whitespace-nowrap">
              <span className="block font-medium">{label}</span>
              <span className={`hidden text-xs lg:block ${active ? "opacity-80" : "text-muted"}`}>{hint}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
