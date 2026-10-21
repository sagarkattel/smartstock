// Colour themes (Settings > Appearance). The choice is remembered on this device only.
export const THEMES = [
  { id: "dark", name: "Dark", description: "Deep navy, easy on the eyes", colors: { bg: "#050a1a", surface: "#0b1329", accent: "#2f6bff", text: "#eaf0ff" } },
  { id: "light", name: "Light", description: "Bright and clean for daytime", colors: { bg: "#eef2fa", surface: "#ffffff", accent: "#2a5fe6", text: "#0e1a38" } },
  { id: "midnight", name: "Midnight", description: "True black with a violet accent", colors: { bg: "#000000", surface: "#0a0a0f", accent: "#7c5cff", text: "#f2f4fa" } },
  { id: "ocean", name: "Ocean", description: "Dark teal with a fresh accent", colors: { bg: "#03141a", surface: "#082029", accent: "#12b5a6", text: "#e6fbff" } },
  { id: "system", name: "Match my device", description: "Light or dark, following your system", colors: null },
];

export const THEME_KEY = "smartstock-theme";
export const THEME_EVENT = "smartstock-theme-change";

export function getStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.id === stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

/** The theme that is actually painted ("system" becomes light or dark). */
export function resolveTheme(id) {
  if (id !== "system") return id;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(id) {
  document.documentElement.dataset.theme = resolveTheme(id);
}

export function saveTheme(id) {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    // Storage can be blocked (private window): the theme still applies for this visit.
  }
  applyTheme(id);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Runs in <head> before the page paints, so there is no flash of the wrong theme. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}")||"dark";if(t==="system"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t}catch(e){}`;
