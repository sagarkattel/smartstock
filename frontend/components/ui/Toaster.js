"use client";

import { useEffect, useState } from "react";
import { CheckIcon, AlertIcon } from "@/components/ui/icons";
import { NOTICE_EVENT } from "@/lib/notify";

export function Toaster() {
  const [notices, setNotices] = useState([]);

  useEffect(() => {
    const onNotice = (event) => {
      const notice = event.detail;
      setNotices((current) => [...current.slice(-2), notice]);
      setTimeout(() => setNotices((current) => current.filter((n) => n.id !== notice.id)), 6000);
    };
    window.addEventListener(NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(NOTICE_EVENT, onNotice);
  }, []);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {notices.map((notice) => {
        const Icon = notice.tone === "error" ? AlertIcon : CheckIcon;
        return (
          <p
            key={notice.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl ${
              notice.tone === "error" ? "border-danger/40 bg-danger-surface text-danger" : "border-border bg-surface-2 text-foreground"
            }`}
          >
            <Icon className={`mt-0.5 size-4 shrink-0 ${notice.tone === "error" ? "" : "text-[var(--positive)]"}`} />
            {notice.message}
          </p>
        );
      })}
    </div>
  );
}
