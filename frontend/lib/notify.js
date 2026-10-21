// Small pop-up notices ("Profile saved"). Anything can call notify(); the Toaster in the app shell shows them.
export const NOTICE_EVENT = "smartstock-notice";

export function notify(message, tone = "ok") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: { message, tone, id: Date.now() + Math.random() } }));
}
