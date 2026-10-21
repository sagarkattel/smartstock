"use client";

import { ProductDetailView } from "@/components/product/ProductDetailView";
import { DocumentTitle } from "@/components/ui/DocumentTitle";
import { ErrorBlock, LoadingBlock, NotFoundView } from "@/components/ui/StateViews";
import { WithMeta } from "@/components/ui/WithMeta";
import { machinePath, pagePaths, productPath } from "@/config/paths";
import { useApp1Forecast, useApp2bMachine } from "@/lib/queries";
import { CanonicalRedirect, findProductBySlug, useResolvedMachine, useResolvedProduct } from "@/lib/resolve";
import { slugify } from "@/lib/slug";

function Loading() {
  return <LoadingBlock label="Loading the product" className="mt-5 h-96" />;
}

// ---- A product in the warehouse (App 1)
/** `param` is the address piece: normally "mount-everest-water" (an exact name also works). */
export function WarehouseProductDetail({ param }) {
  return <WithMeta>{(meta) => <ResolvedWarehouseProduct meta={meta} param={param} />}</WithMeta>;
}

function ResolvedWarehouseProduct({ meta, param }) {
  const target = useResolvedProduct(param);
  if (target.status === "error") return <ErrorBlock error={target.error} onRetry={target.retry} className="mt-5" />;
  if (target.status === "loading") return <Loading />;
  if (target.status === "notfound") {
    return (
      <NotFoundView
        title="Product not found"
        message="SmartStock has no forecast for a product at this address."
        backHref={pagePaths.warehouse}
        backLabel="Back to the warehouse"
      />
    );
  }
  return (
    <>
      <DocumentTitle title={target.item} />
      <CanonicalRedirect param={param} slug={target.slug} path={productPath(target.item)} />
      <WarehouseProduct meta={meta} item={target.item} />
    </>
  );
}

function WarehouseProduct({ meta, item }) {
  const weekly = useApp1Forecast(item, "week", meta.max_horizon_weeks);
  const monthly = useApp1Forecast(item, "month", meta.max_horizon_months);

  if (weekly.error?.code === "unknown_item") {
    return (
      <NotFoundView
        title="Product not found"
        message={`SmartStock has no forecast for “${item}”.`}
        backHref={pagePaths.warehouse}
        backLabel="Back to the warehouse"
      />
    );
  }
  if (weekly.isError) {
    return <ErrorBlock error={weekly.error} onRetry={() => weekly.refetch()} className="mt-5" />;
  }
  if (!weekly.data) return <Loading />;

  return (
    <ProductDetailView
      series={{ ...weekly.data, weekly: weekly.data.periods }}
      weeklyQuery={weekly}
      monthlyQuery={monthly}
      read={(data) => ({ periods: data.periods, history: data.history })}
      meta={meta}
      backHref={pagePaths.warehouse}
      backLabel="Warehouse"
    />
  );
}

// ---- A product inside one machine (App 2b)
/** `machineParam` like "castle-hill-tafe-100900", `itemParam` like "bueno" (old addresses also work). */
export function MachineProductDetail({ machineParam, itemParam }) {
  return <WithMeta>{(meta) => <ResolvedMachineProduct meta={meta} machineParam={machineParam} itemParam={itemParam} />}</WithMeta>;
}

function ResolvedMachineProduct({ meta, machineParam, itemParam }) {
  const target = useResolvedMachine(machineParam);
  if (target.status === "error") return <ErrorBlock error={target.error} onRetry={target.retry} className="mt-5" />;
  if (target.status === "loading") return <Loading />;
  if (target.status === "notfound") {
    return (
      <NotFoundView
        title="Machine not found"
        message="SmartStock has no machine at this address."
        backHref={pagePaths.machines}
        backLabel="Back to the machines"
      />
    );
  }
  return <MachineProduct meta={meta} assetId={target.assetId} machineSlug={target.slug} machineParam={machineParam} itemParam={itemParam} />;
}

function MachineProduct({ meta, assetId, machineSlug, machineParam, itemParam }) {
  const weekly = useApp2bMachine(assetId, "week", meta.max_horizon_weeks);
  const monthly = useApp2bMachine(assetId, "month", meta.max_horizon_months);
  const machineHref = weekly.data ? machinePath(assetId, weekly.data.location) : pagePaths.machines;

  if (weekly.isError) {
    const unknown = ["unknown_machine", "no_product_breakdown"].includes(weekly.error.code);
    return unknown ? (
      <NotFoundView
        title="No product forecast for this machine"
        message={weekly.error.message}
        backHref={machineHref}
        backLabel="Back to the machine"
      />
    ) : (
      <ErrorBlock error={weekly.error} onRetry={() => weekly.refetch()} className="mt-5" />
    );
  }
  if (!weekly.data) return <Loading />;

  const findProduct = (data) => findProductBySlug(data.products, itemParam);
  const product = findProduct(weekly.data);
  if (!product) {
    return (
      <NotFoundView
        title="Product not found in this machine"
        message={`${weekly.data.location} has no product at this address.`}
        backHref={machineHref}
        backLabel="Back to the machine"
      />
    );
  }

  return (
    <>
      <DocumentTitle title={`${product.item} · ${weekly.data.location}`} />
      <CanonicalRedirect
        param={`${machineParam}/${itemParam}`}
        slug={`${machineSlug}/${slugify(product.item)}`}
        path={`${machinePath(assetId, weekly.data.location)}/${slugify(product.item)}`}
      />
      <MachineProductView product={product} weekly={weekly} monthly={monthly} findProduct={findProduct} meta={meta} assetId={assetId} />
    </>
  );
}

function MachineProductView({ product, weekly, monthly, findProduct, meta, assetId }) {
  return (
    <ProductDetailView
      series={{ ...product, weekly: product.periods }}
      weeklyQuery={weekly}
      monthlyQuery={monthly}
      // The backend gives no sales history for a product inside a machine, only the forecast.
      read={(data) => ({ periods: findProduct(data)?.periods ?? [], history: [] })}
      meta={meta}
      backHref={machinePath(assetId, weekly.data.location)}
      backLabel={weekly.data.location}
      context={`In ${weekly.data.location} (asset ${assetId})`}
    />
  );
}
