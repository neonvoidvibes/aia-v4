/**
 * Session cache utility to avoid redundant getSession() calls
 * Caches sessions for 30 seconds to reduce auth overhead
 */

let _cachedSession: any = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

export async function getCachedSession(supabase: any) {
  const now = Date.now();

  // Return cached session if still valid
  if (_cachedSession && (now - _cacheTimestamp) < CACHE_TTL_MS) {
    return { data: { session: _cachedSession }, error: null };
  }

  // Cache miss - fetch from Supabase
  const result = await supabase.auth.getSession();
  if (result.data?.session) {
    _cachedSession = result.data.session;
    _cacheTimestamp = now;
  }

  return result;
}

export function invalidateSessionCache() {
  _cachedSession = null;
  _cacheTimestamp = 0;
}
