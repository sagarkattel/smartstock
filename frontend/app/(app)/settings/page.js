import { redirect } from "next/navigation";
import { pagePaths } from "@/config/paths";

export default function SettingsPage() {
  redirect(pagePaths.settingsGeneral);
}
