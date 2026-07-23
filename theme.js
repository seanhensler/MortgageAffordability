// theme.js — dark/light mode toggle. Applies a `data-theme` attribute on <html> that
// styles.css/comps-ui.css/compmap.css/dtigauge.css/stickybar.css all key off of via CSS
// variable overrides (see the [data-theme="dark"] block in styles.css). Runs synchronously,
// inline, before first paint (see the <script> tag placement in <head>) so there is no
// flash of the wrong theme on load.
(function () {
  const STORAGE_KEY = "mortgageCalc.theme";

  function getStoredTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null; // localStorage unavailable (private browsing, etc.) — fall through to default
    }
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* ignore — theme just won't persist across reloads */
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const toggle = document.getElementById("themeToggle");
    if (toggle) {
      toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
      toggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    }
  }

  // Dark by default regardless of OS preference (spec calls for "a high-contrast dark
  // theme by default"), unless the user has explicitly toggled to light before.
  const stored = getStoredTheme();
  applyTheme(stored || "dark");

  window.Theme = {
    current: () => document.documentElement.getAttribute("data-theme") || "dark",
    toggle: () => {
      const next = window.Theme.current() === "dark" ? "light" : "dark";
      applyTheme(next);
      setStoredTheme(next);
    },
    set: (theme) => {
      applyTheme(theme);
      setStoredTheme(theme);
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("themeToggle");
    if (toggle) {
      applyTheme(window.Theme.current()); // sync icon/label now that the button exists
      toggle.addEventListener("click", window.Theme.toggle);
    }
  });
})();
