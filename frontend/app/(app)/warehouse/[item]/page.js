import { WarehouseProductDetail } from "@/components/product/ProductDetails";
import { decodeParam } from "@/lib/params";

export const metadata = { title: "Product · SmartStock" };

export default async function ProductPage({ params }) {
  const { item } = await params;
  return <WarehouseProductDetail param={decodeParam(item)} />;
}
