import Link from "next/link";
import { pagePaths } from "@/config/paths";

export const metadata = {
  title: "Not found · SmartStock",
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">We couldn’t find what you were looking for.</p>
      <Link
        href={pagePaths.home}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Back to Home
      </Link>
    </main>
  );
}
