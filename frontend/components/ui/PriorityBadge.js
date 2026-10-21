const CLASS_HELP =
  "First letter: A = top 80% of sales value, B = next 15%, C = the rest. " +
  "Second letter: X = steady demand, Y = variable, Z = hard to predict.";

/** Priority is always shown as text; the ABC-XYZ class sits in the tooltip (spec §7.7). */
export function PriorityBadge({ priority, cls, className = "" }) {
  const tone = priority.toLowerCase();
  return (
    <span
      title={cls ? `Class ${cls}. ${CLASS_HELP}` : undefined}
      className={`badge-${tone} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {priority}
    </span>
  );
}
