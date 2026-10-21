// Whether the side menu is shrunk to icons. Remembered on this device only.
const KEY = "smartstock-sidebar";
const EVENT = "smartstock-sidebar-change";

export function getSidebarCollapsed() {
  try {
    return localStorage.getItem(KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    // Storage can be blocked: the menu still changes for this visit.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeSidebar(callback) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
