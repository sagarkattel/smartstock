import { NewInstallations } from "@/components/newsite/NewInstallations";
import { PageHero } from "@/components/ui/PageHero";

export const metadata = {
  title: "New Installations · SmartStock",
};

export default function NewInstallationsPage() {
  return (
    <main className="mx-auto max-w-[1500px] space-y-5 pt-5">
      <PageHero
        title="New Installations"
        subtitle="Pick the type of site for a new machine and see which products are most likely to sell there."
      />
      <NewInstallations />
    </main>
  );
}
