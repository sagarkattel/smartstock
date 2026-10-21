"use client";

const CHOICES = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "All", value: 0 },
];

const segmentBase =
  "px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring";

/** Site type form (spec §8.10 Inputs): categories, staff area, free-text description, list size. */
export function SiteForm({
  categories,
  staffAreaSites,
  selected,
  onToggle,
  staffArea,
  onStaffArea,
  description,
  onDescription,
  detection,
  onDetect,
  onApplyDetected,
  top,
  onTop,
  canSubmit,
  loading,
  onSubmit,
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-5 rounded-2xl border border-border bg-surface p-5"
    >
      <fieldset>
        <legend className="text-sm font-semibold">Site type</legend>
        <p className="mt-0.5 text-xs text-muted">Choose one or more. The number is how many similar sites SmartStock has learned from.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {categories.map((category) => {
            const active = selected.includes(category.name);
            const noExamples = category.training_sites === 0;
            return (
              <button
                key={category.name}
                type="button"
                aria-pressed={active}
                onClick={() => onToggle(category.name)}
                className={`rounded-full border px-3 py-1.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary/60"
                }`}
              >
                {category.name}{" "}
                <span className={`text-xs ${active ? "opacity-90" : "text-muted"}`}>
                  {noExamples ? "· no examples yet" : `· ${category.training_sites}`}
                </span>
              </button>
            );
          })}
        </div>

        <label className="mt-4 flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={staffArea}
            onChange={(e) => onStaffArea(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          <span>
            Machine is in a staff-only area (e.g. canteen, lunch room)
            <span className="block text-xs text-muted">{staffAreaSites} similar sites</span>
          </span>
        </label>
      </fieldset>

      <div>
        <label htmlFor="site-description" className="text-sm font-semibold">
          Describe the site <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="site-description"
          rows={2}
          maxLength={500}
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          placeholder="e.g. gym inside a shopping centre"
          className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted focus:outline-2 focus:outline-focus-ring"
        />
        <button
          type="button"
          onClick={onDetect}
          disabled={!description.trim() || detection.status === "loading"}
          className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-background focus-visible:outline-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {detection.status === "loading" ? "Detecting…" : "Detect site type"}
        </button>

        {detection.status === "error" && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {detection.message}
          </p>
        )}
        {detection.status === "done" && (
          <div role="status" className="mt-3 space-y-2 rounded-lg border border-border bg-background p-3 text-sm">
            {detection.data.categories.length === 0 ? (
              <p className="text-muted">No site type detected. Pick one above instead.</p>
            ) : (
              <>
                <p>
                  Detected: <span className="font-medium">{detection.data.categories.join(", ")}</span>
                </p>
                <p className="text-xs text-muted">Matched words: {detection.data.matched_keywords.join(", ")}</p>
                <button
                  type="button"
                  onClick={onApplyDetected}
                  className="rounded-lg bg-foreground px-3 py-1 text-xs font-semibold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  Use these site types
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div>
        <p id="top-label" className="text-sm font-semibold">
          Products to show
        </p>
        <div role="group" aria-labelledby="top-label" className="mt-1.5 inline-flex overflow-hidden rounded-lg border border-border">
          {CHOICES.map((choice) => (
            <button
              key={choice.label}
              type="button"
              aria-pressed={top === choice.value}
              onClick={() => onTop(choice.value)}
              className={`${segmentBase} ${
                top === choice.value ? "bg-foreground text-background" : "text-muted hover:bg-background hover:text-foreground"
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <button
          type="submit"
          disabled={!canSubmit || loading}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Finding products…" : "Get recommendations"}
        </button>
        {!canSubmit && <p className="text-xs text-muted">Choose a site type or tick the staff-area box to continue.</p>}
      </div>
    </form>
  );
}
