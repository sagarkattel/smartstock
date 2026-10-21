import { SettingsNav } from "@/components/settings/SettingsNav";
import { PageHero } from "@/components/ui/PageHero";

export default function SettingsLayout({ children }) {
  return (
    <main className="mx-auto max-w-[1500px] space-y-5 pt-5">
      <PageHero title="Settings" subtitle="Manage your data and models, how SmartStock looks, and your profile." />
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        <SettingsNav />
        <div className="min-w-0 space-y-5">{children}</div>
      </div>
    </main>
  );
}
