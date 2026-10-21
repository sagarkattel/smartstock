/** Route parameters arrive percent-encoded; decode them, tolerating a stray "%" in a name. */
export function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
