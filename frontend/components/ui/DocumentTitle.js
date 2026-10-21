"use client";

import { useEffect } from "react";

/** Sets the browser tab title once a page knows what it is showing (e.g. the product name). */
export function DocumentTitle({ title }) {
  useEffect(() => {
    if (title) document.title = `${title} · SmartStock`;
  }, [title]);
  return null;
}
