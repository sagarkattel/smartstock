const HELP = {
  High: "Most of this machine's sales record product names, so the product breakdown is reliable.",
  Medium: "Some of this machine's sales record product names, so treat the product breakdown with care.",
  Low: "Product names are not recorded for this machine, so there is no product breakdown.",
};

const TONE = { High: "status-ok", Medium: "badge-medium", Low: "status-warn" };

/** Machine confidence (spec §7.9): how much of the machine's sales record product names. */
export function ConfidenceBadge({ confidence, help, className = "" }) {
  return (
    <span
      title={help ?? HELP[confidence]}
      className={`${TONE[confidence]} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {confidence}
    </span>
  );
}
