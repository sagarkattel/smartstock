import { safeNextPath } from "@/config/paths";
import { LoginForm } from "@/components/auth/LoginForm";
import { BrandMark } from "@/components/ui/BrandMark";

export const metadata = {
  title: "Sign in · SmartStock",
};

export default async function LoginPage({ searchParams }) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <BrandMark />
        </div>
        <div className="rounded-3xl border border-border bg-surface/90 p-7 shadow-2xl shadow-primary/10">
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="mb-6 mt-1 text-sm text-muted">Sign in to see your stock forecasts.</p>
          <LoginForm nextPath={nextPath} />
        </div>
        <p className="text-center text-xs text-muted">SmartStock recommends; people decide.</p>
      </div>
    </main>
  );
}
