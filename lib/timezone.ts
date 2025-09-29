export function getClientTimezone(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') {
    return null;
  }

  try {
    const { timeZone } = new Intl.DateTimeFormat().resolvedOptions();
    return typeof timeZone === 'string' && timeZone.trim() ? timeZone : null;
  } catch {
    return null;
  }
}
