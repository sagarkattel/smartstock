/**
 * Readable URL pieces: "FRUIT JUICE 100% APPLE 600ML" -> "fruit-juice-100-percent-apple-600ml".
 * Lowercase letters and digits joined by hyphens, so no encoded characters appear in an address.
 */
export function slugify(text) {
  const slug = String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/%/g, " percent ")
    .replace(/['’`]/g, "") // "ALLEN'S" -> "allens"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

/** A machine's address piece: its location and asset ID, e.g. "castle-hill-tafe-100900". */
export function machineSlug(assetId, location) {
  return slugify(`${location ?? ""} ${assetId}`);
}
