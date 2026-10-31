// Apply the saved theme before CSS or React can paint the default light palette.
try {
  const theme = JSON.parse(localStorage.getItem('nostr:app-config') || '{}')?.theme;
  if (theme === 'light' || theme === 'dark' || theme === 'hacker') {
    const root = document.documentElement;
    root.classList.remove('dark');
    root.classList.add(theme);
    if (theme === 'hacker') root.classList.add('dark');
  }
} catch {
  // Keep the default dark theme when storage is blocked or malformed.
}
