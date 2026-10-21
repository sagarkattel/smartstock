import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/icons";

/** Decorative glowing vending machine for the page header. */
function VendingArt() {
  const rows = [0, 1, 2, 3];
  const colors = ["#ff6b81", "#ffb23e", "#2ee6a6", "#4d9bff", "#a577ff", "#ff9f43"];
  return (
    <svg viewBox="0 0 260 160" aria-hidden="true" className="h-full w-auto">
      <defs>
        <linearGradient id="va-glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f6bff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#7648e6" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id="va-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#2f6bff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#2f6bff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="170" cy="80" rx="130" ry="90" fill="url(#va-halo)" />
      <path d="M0 150C60 120 90 140 150 118S230 100 260 108" stroke="#2f6bff" strokeOpacity="0.4" fill="none" />
      <path d="M0 158C70 132 110 150 170 130S235 116 260 124" stroke="#7648e6" strokeOpacity="0.35" fill="none" />
      <rect x="132" y="14" width="96" height="132" rx="8" fill="#0a1230" stroke="url(#va-glow)" strokeWidth="2" />
      <rect x="140" y="24" width="64" height="94" rx="4" fill="#060c24" stroke="#2f6bff" strokeOpacity="0.5" />
      {rows.map((r) =>
        [0, 1, 2, 3].map((c) => (
          <rect
            key={`${r}-${c}`}
            x={146 + c * 14}
            y={30 + r * 22}
            width="9"
            height="14"
            rx="2"
            fill={colors[(r * 4 + c) % colors.length]}
            opacity="0.85"
          />
        )),
      )}
      <rect x="210" y="26" width="10" height="40" rx="3" fill="#0e1a44" stroke="#2f6bff" strokeOpacity="0.5" />
      <rect x="146" y="124" width="58" height="14" rx="3" fill="#060c24" stroke="#2f6bff" strokeOpacity="0.4" />
    </svg>
  );
}

/** Large header card at the top of each screen: title, subtitle, optional controls on the right. */
export function PageHero({ title, subtitle, children, actions, back }) {
  return (
    <section className="relative rounded-3xl border border-border bg-surface/80">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
        <div className="absolute inset-y-0 right-0 hidden w-1/2 items-center justify-end pr-24 opacity-90 md:flex">
          <VendingArt />
        </div>
      </div>
      <div className="relative flex flex-wrap items-start justify-between gap-4 px-5 py-6 sm:px-7">
        <div className="min-w-0 space-y-2">
          {back && (
            <Link
              href={back.href}
              className="inline-flex items-center gap-1 rounded text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              <ChevronLeftIcon className="size-4" /> {back.label}
            </Link>
          )}
          <h1 className="truncate text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          {subtitle && <p className="max-w-xl text-sm text-muted">{subtitle}</p>}
          {children}
        </div>
        {actions}
      </div>
    </section>
  );
}
