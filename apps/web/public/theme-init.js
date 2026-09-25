// Must match ThemeService's storage key and values (src/app/core/theme.service.ts).
try {
  var theme = localStorage.getItem('forge.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch (e) {}
