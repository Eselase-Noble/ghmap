/**
 * Lightweight localStorage persistence for saved (favourite) places and recent
 * searches, so they survive reloads like they do in Google Maps.
 */
const SAVED_KEY = "ghmap.saved";
const RECENT_KEY = "ghmap.recent";
const RECENT_LIMIT = 8;

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const val = JSON.parse(raw);
    return Array.isArray(val) ? val.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* storage unavailable or full — ignore */
  }
}

export function getSaved(): string[] {
  return read(SAVED_KEY);
}

export function toggleSaved(id: string): string[] {
  const cur = read(SAVED_KEY);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur];
  write(SAVED_KEY, next);
  return next;
}

export function getRecent(): string[] {
  return read(RECENT_KEY);
}

export function pushRecent(id: string): string[] {
  const cur = read(RECENT_KEY).filter((x) => x !== id);
  const next = [id, ...cur].slice(0, RECENT_LIMIT);
  write(RECENT_KEY, next);
  return next;
}
