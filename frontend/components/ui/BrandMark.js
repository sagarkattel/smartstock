/** The SmartStock logo: a gradient tile and the name (the name can be hidden on large screens). */
export function BrandMark({ hideName = false }) {
  return (
    <span className="flex items-center gap-3">
      <span aria-hidden="true" className="stat-violet flex size-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white shadow-lg shadow-primary/30">
        S
      </span>
      <span className={`text-xl font-semibold tracking-tight ${hideName ? "lg:hidden" : ""}`}>SmartStock</span>
    </span>
  );
}
