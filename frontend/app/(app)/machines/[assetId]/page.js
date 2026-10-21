import { MachineDetail } from "@/components/dashboard/MachineDetail";
import { decodeParam } from "@/lib/params";

export const metadata = { title: "Machine · SmartStock" };

export default async function MachinePage({ params }) {
  const { assetId } = await params;
  return <MachineDetail param={decodeParam(assetId)} />;
}
