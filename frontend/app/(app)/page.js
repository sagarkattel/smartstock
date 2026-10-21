import { redirect } from "next/navigation";
import { pagePaths } from "@/config/paths";

// Home after login is the Warehouse dashboard (App 1).
// TODO(spec): replace with the Home screen (spec §8.2) when it is designed.
export default function HomePage() {
  redirect(pagePaths.warehouse);
}
