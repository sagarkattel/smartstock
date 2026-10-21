"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { BrandMark } from "@/components/ui/BrandMark";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  LogoutIcon,
  MachineIcon,
  NewSiteIcon,
  SettingsIcon,
  WarehouseIcon,
} from "@/components/ui/icons";
import { pagePaths } from "@/config/paths";
import { formatDate } from "@/lib/format";
import { useMeta } from "@/lib/queries";

const NAV_ITEMS = [
  { label: "Warehouse", href: pagePaths.warehouse, Icon: WarehouseIcon },
  { label: "Machine", href: pagePaths.machines, Icon: MachineIcon },
  { label: "New Installations", href: pagePaths.newInstallations, Icon: NewSiteIcon },
];

export function Logo({ collapsed = false }) {
  return (
    <Link href={pagePaths.warehouse} aria-label="SmartStock home" className="rounded-lg focus-visible:outline-2 focus-visible:outline-focus-ring">
      <BrandMark hideName={collapsed} />
    </Link>
  );
}

/** Whether the backend answered: the "System online" card (a single dot when the menu is collapsed). */
function SystemStatus({ collapsed }) {
  const meta = useMeta();
  const state = meta.isPending ? "loading" : meta.isError ? "down" : "up";
  const dot = state === "up" ? "bg-emerald-400" : state === "down" ? "bg-red-400" : "bg-amber-400";
  const label = state === "up" ? "System online" : state === "down" ? "Service unavailable" : "Connecting…";

  return (
    <div
      role="status"
      title={state === "up" ? `${label} · Models ${meta.data.model_version}` : label}
      className={`rounded-xl border border-border bg-surface-2 text-xs ${collapsed ? "p-3 lg:flex lg:justify-center lg:px-0" : "p-3"}`}
    >
      <p className="flex items-center gap-2 font-medium">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span className={collapsed ? "lg:sr-only" : ""}>{label}</span>
      </p>
      {state === "up" && (
        <p className={`mt-1 text-muted ${collapsed ? "lg:hidden" : ""}`}>
          Models {meta.data.model_version}
          <br />
          Trained until {formatDate(meta.data.trained_until)}
        </p>
      )}
    </div>
  );
}

/** A nav link that shows its label beside the icon, or in a small tooltip when the menu is collapsed. */
function NavLink({ href, label, Icon, active, collapsed }) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring ${
        collapsed ? "lg:justify-center lg:px-0" : ""
      } ${
        active ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" : "text-muted hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      <Icon className="size-5 shrink-0" />
      <span className={collapsed ? "lg:sr-only" : ""}>{label}</span>
      {collapsed && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-full ml-3 hidden rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-foreground opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 lg:block"
        >
          {label}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({ open, onClose, collapsed, onToggleCollapsed }) {
  const pathname = usePathname();
  const isActive = (href) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {open && <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-black/60 lg:hidden" />}
      <aside
        aria-label="Sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-surface px-3 py-5 transition-[transform,width] duration-200 lg:translate-x-0 ${
          collapsed ? "lg:w-[4.75rem]" : "lg:w-60"
        } ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Collapse / expand (desktop only) */}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand the menu" : "Collapse the menu"}
          className="absolute top-7 -right-3.5 z-10 hidden size-7 items-center justify-center rounded-full border border-border bg-surface-2 text-muted shadow-md hover:border-primary/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring lg:flex"
        >
          {collapsed ? <ChevronRightIcon className="size-4" /> : <ChevronLeftIcon className="size-4" />}
        </button>

        <div className={`flex items-center justify-between px-2 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
          <Logo collapsed={collapsed} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring lg:hidden"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        <nav aria-label="Main" className="mt-8 flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map(({ label, href, Icon }) => (
            <NavLink key={href} href={href} label={label} Icon={Icon} active={isActive(href)} collapsed={collapsed} />
          ))}
        </nav>

        <div className="space-y-1">
          <div className="pb-2">
            <SystemStatus collapsed={collapsed} />
          </div>
          <NavLink href={pagePaths.settings} label="Settings" Icon={SettingsIcon} active={pathname.startsWith(pagePaths.settings)} collapsed={collapsed} />
          <div className="group relative">
            <SignOutButton
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-danger-surface hover:text-danger focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-60 ${
                collapsed ? "lg:justify-center lg:px-0" : ""
              }`}
              labelClassName={collapsed ? "lg:sr-only" : ""}
              icon={<LogoutIcon className="size-5 shrink-0" />}
            />
            {collapsed && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-full ml-3 hidden rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-foreground opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 lg:block top-1/2 -translate-y-1/2"
              >
                Logout
              </span>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
