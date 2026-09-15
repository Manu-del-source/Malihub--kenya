(function () {
  try {
    var stored = document.cookie.match(/malihub-theme=(dark|light)/);
    var theme = stored
      ? stored[1]
      : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    /* localStorage/matchMedia unavailable — fall back to default (dark) styling, no crash */
  }
})();
