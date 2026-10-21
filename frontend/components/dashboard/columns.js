import { machinePath, machineProductPath, productPath } from "@/config/paths";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { MachineIcon, ProductTypeIcon } from "@/components/ui/icons";
import { PriorityBadge } from "@/components/ui/PriorityBadge";
import { formatMoney, formatUnits, formatWhole } from "@/lib/format";

// Both tables share one grid: name, type/confidence, priority, expected units, safe stock, expected sales.
export const LIST_GRID =
  "grid min-w-[22rem] grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-3 px-3 " +
  "sm:min-w-[40rem] sm:grid-cols-[minmax(0,1fr)_6.5rem_5.5rem_5.5rem_5.5rem_6.5rem]";

const numberColumns = [
  { key: "expected", header: "Exp. units", fullHeader: "Expected units", align: "right", render: (row) => formatUnits(row.expected) },
  { key: "safe", header: "Safe stock", fullHeader: "Safe stock (units)", align: "right", hideOnMobile: true, className: "text-muted", render: (row) => formatWhole(row.safe) },
  { key: "sales", header: "Exp. sales", fullHeader: "Expected sales", align: "right", hideOnMobile: true, className: "font-medium", render: (row) => formatMoney(row.sales) },
];

const priorityColumn = {
  key: "priority",
  header: "Priority",
  render: (row) => <PriorityBadge priority={row.priority} cls={row.cls} />,
};

/** Icon tile + a title line + a muted line: the first cell of every row. */
function NameCell({ icon, title, sub }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-primary-hover">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium" title={title}>{title}</span>
        <span className="block truncate text-xs text-muted">{sub}</span>
      </span>
    </span>
  );
}

// --- Products (warehouse, and inside one machine) ---------------------------------------------

export const productColumns = [
  {
    key: "item",
    header: "Product",
    className: "min-w-0",
    render: (row) => <NameCell icon={<ProductTypeIcon ptype={row.ptype} className="size-5" />} title={row.item} sub={`Class ${row.cls}`} />,
  },
  { key: "ptype", header: "Type", hideOnMobile: true, className: "truncate text-muted", render: (row) => row.ptype },
  priorityColumn,
  ...numberColumns,
];

/** Rows from the backend's /app1/products or /app2b/machine items, sorted by expected sales. */
export function toProductRows(items) {
  return items
    .map((p) => {
      const first = p.first ?? p.periods[0]; // App 1 sends `first`; App 2b sends every period
      return {
        item: p.item,
        ptype: p.ptype,
        priority: p.priority,
        cls: p.class,
        expected: first.p50,
        safe: first.safe_qty,
        sales: first.revenue_p50,
      };
    })
    .sort((a, b) => b.sales - a.sales);
}

export const productKey = (row) => row.item;
export const productSearchText = (row) => row.item;
export const warehouseProductHref = (row) => productPath(row.item);
export const machineProductHref = (assetId, location) => (row) => machineProductPath(assetId, location, row.item);

// --- Machines ---------------------------------------------------------------------------------

export const machineColumns = [
  {
    key: "location",
    header: "Machine",
    className: "min-w-0",
    render: (row) => <NameCell icon={<MachineIcon className="size-5" />} title={row.location} sub={`Asset ${row.assetId}`} />,
  },
  {
    key: "confidence",
    header: "Confidence",
    hideOnMobile: true,
    render: (row) => <ConfidenceBadge confidence={row.confidence} />,
  },
  priorityColumn,
  ...numberColumns,
];

/** Rows from the backend's /app2a/machines, sorted by expected units (spec §8.6 default sort). */
export function toMachineRows(machines) {
  return machines
    .map((m) => ({
      assetId: m.asset_id,
      location: m.location,
      confidence: m.confidence,
      priority: m.priority,
      cls: m.class,
      hasBreakdown: m.has_product_breakdown,
      expected: m.first.p50,
      safe: m.first.safe_qty,
      sales: m.first.revenue_p50,
    }))
    .sort((a, b) => b.expected - a.expected);
}

export const machineKey = (row) => row.assetId;
export const machineSearchText = (row) => `${row.location} ${row.assetId}`;
export const machineHref = (row) => machinePath(row.assetId, row.location);
