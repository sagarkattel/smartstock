import { MachineProductDetail } from "@/components/product/ProductDetails";
import { decodeParam } from "@/lib/params";

export const metadata = { title: "Product in a machine · SmartStock" };

export default async function MachineProductPage({ params }) {
  const { assetId, item } = await params;
  return <MachineProductDetail machineParam={decodeParam(assetId)} itemParam={decodeParam(item)} />;
}
