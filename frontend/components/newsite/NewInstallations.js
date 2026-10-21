"use client";

import { useMemo, useRef, useState } from "react";
import { RecommendationResults } from "@/components/newsite/RecommendationResults";
import { SiteForm } from "@/components/newsite/SiteForm";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateViews";
import { useApp3Categories, useCategorize, useRecommend } from "@/lib/queries";

const STAFF_AREA = "Staff area";

export function NewInstallations() {
  const categoriesQuery = useApp3Categories();
  const categorize = useCategorize();
  const recommend = useRecommend();

  const [selected, setSelected] = useState([]);
  const [staffArea, setStaffArea] = useState(false);
  const [description, setDescription] = useState("");
  const [detection, setDetection] = useState({ status: "idle" });
  const [top, setTop] = useState(10); // 0 means "All"
  const [state, setState] = useState({ status: "idle" });
  const resultsRef = useRef(null);

  // The backend lists "Staff area" with the site types; the form shows it as its own checkbox.
  const { categories, staffAreaSites } = useMemo(() => {
    const all = categoriesQuery.data?.categories ?? [];
    return {
      categories: all.filter((c) => c.name !== STAFF_AREA),
      staffAreaSites: all.find((c) => c.name === STAFF_AREA)?.training_sites ?? 0,
    };
  }, [categoriesQuery.data]);

  const toggle = (name) =>
    setSelected((current) => (current.includes(name) ? current.filter((n) => n !== name) : [...current, name]));

  const detect = async () => {
    setDetection({ status: "loading" });
    try {
      setDetection({ status: "done", data: await categorize.mutateAsync(description.trim()) });
    } catch (error) {
      setDetection({ status: "error", message: error.message });
    }
  };

  const applyDetected = () => {
    if (detection.status !== "done") return;
    const detected = detection.data.categories;
    setSelected(detected.filter((name) => name !== STAFF_AREA));
    setStaffArea(detected.includes(STAFF_AREA));
  };

  const submit = async () => {
    setState({ status: "loading" });
    if (window.matchMedia("(max-width: 1023px)").matches) {
      resultsRef.current?.scrollIntoView({ block: "start" });
    }
    try {
      // `top: null` asks the backend for every product; leaving it out would give the default 10.
      const result = await recommend.mutateAsync({ categories: selected, staff_area: staffArea, top: top || null });
      setState({ status: "done", result });
    } catch (error) {
      setState({ status: "error", message: error.message });
    }
  };

  if (categoriesQuery.isError) {
    return <ErrorBlock error={categoriesQuery.error} onRetry={() => categoriesQuery.refetch()} title="Could not load the site types" />;
  }
  if (categoriesQuery.isPending) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <LoadingBlock label="Loading the site types" className="h-[36rem]" />
        <LoadingBlock label="Loading" className="h-64" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start">
      <div>
        <SiteForm
          categories={categories}
          staffAreaSites={staffAreaSites}
          selected={selected}
          onToggle={toggle}
          staffArea={staffArea}
          onStaffArea={setStaffArea}
          description={description}
          onDescription={(value) => {
            setDescription(value);
            if (detection.status !== "idle") setDetection({ status: "idle" });
          }}
          detection={detection}
          onDetect={detect}
          onApplyDetected={applyDetected}
          top={top}
          onTop={setTop}
          canSubmit={selected.length > 0 || staffArea}
          loading={state.status === "loading"}
          onSubmit={submit}
        />
      </div>

      <div ref={resultsRef} className="min-w-0 scroll-mt-4" aria-live="polite">
        {state.status === "idle" && (
          <div className="flex min-h-64 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="font-medium">Pick a site type to see what is likely to sell</p>
            <p className="max-w-md text-sm text-muted">
              SmartStock compares your site with similar machines and lists the best-sellers and the products that stand out.
            </p>
          </div>
        )}

        {state.status === "loading" && (
          <div role="status" aria-label="Loading recommendations" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-2xl bg-border/50" />
              ))}
            </div>
            <div className="h-96 animate-pulse rounded-2xl bg-border/50" />
          </div>
        )}

        {state.status === "error" && (
          <ErrorBlock error={{ message: state.message }} onRetry={submit} title="Could not get recommendations" />
        )}

        {state.status === "done" && <RecommendationResults result={state.result} />}
      </div>
    </div>
  );
}
