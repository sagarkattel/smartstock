"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp1Products, useApp2aMachines } from "@/lib/queries";
import { machineSlug, slugify } from "@/lib/slug";

/**
 * Turns the slug in an address back into the real product or machine by looking it up in the list
 * (which the screens already have cached). Old-style addresses still work: an exact name, a plain asset
 * ID or a percent-encoded name resolves too, and the page then moves to the readable address.
 *
 * Each hook returns { status: "loading" | "error" | "notfound" | "ok", error, ... }.
 */
function lookup(query, find) {
  if (query.isError) return { status: "error", error: query.error, retry: () => query.refetch() };
  if (!query.data) return { status: "loading" };
  return find(query.data);
}

export function useResolvedProduct(param) {
  const products = useApp1Products("week", 1);
  return lookup(products, (data) => {
    const wanted = slugify(param);
    const found = data.items.find((p) => p.item === param || slugify(p.item) === wanted);
    return found ? { status: "ok", item: found.item, slug: slugify(found.item) } : { status: "notfound" };
  });
}

export function useResolvedMachine(param) {
  const machines = useApp2aMachines("week", 1);
  return lookup(machines, (data) => {
    const wanted = slugify(param);
    const found = data.machines.find((m) => m.asset_id === param || machineSlug(m.asset_id, m.location) === wanted);
    return found
      ? { status: "ok", assetId: found.asset_id, location: found.location, slug: machineSlug(found.asset_id, found.location) }
      : { status: "notfound" };
  });
}

/** Finds a product inside a machine's breakdown by slug (or by its real name, for old addresses). */
export function findProductBySlug(products, param) {
  const wanted = slugify(param);
  return products.find((p) => p.item === param || slugify(p.item) === wanted) ?? null;
}

/**
 * Moves an old-style address (an encoded name, a bare asset ID) to the readable one without adding a
 * history entry. `param` is what the address has now, `slug` what it should have, `path` the full address.
 */
export function CanonicalRedirect({ param, slug, path }) {
  const router = useRouter();
  const needsMove = Boolean(slug) && param !== slug;
  useEffect(() => {
    if (needsMove) router.replace(path);
  }, [needsMove, path, router]);
  return null;
}
