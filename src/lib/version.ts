/**
 * Single source of truth for the app version and its "What's New" notes.
 * Bump APP_VERSION here (alongside manifest.config.ts + package.json) and add
 * a matching entry to WHATS_NEW so the panel shows once after an update.
 */
export const APP_VERSION = '2.1.1';

export interface WhatsNewEntry {
  version: string;
  title: string;
  items: string[];
}

/** Newest first. The panel shows entries newer than the user's last-seen version. */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '2.1.1',
    title: "What's new in 2.1.1 — Calendar",
    items: [
      'New: the 📅 Calendar widget. Add events (title, date, time, note) right on your homepage.',
      'Connect Google Calendar (read-only) to see your real events, merged with your local ones.',
      'Month view by default; flip on “Week view” in settings for a compact current-week grid.',
      'Widen the widget to reveal an upcoming-events column beside the grid.',
      'Events can live per-widget or be shared across the whole workspace.',
    ],
  },
  {
    version: '2.1.0',
    title: "What's new in 2.1.0 — FRONTLY × VOLT",
    items: [
      'New: the ⚡ VOLT widget. Connect your VOLT account and see incoming transfers land on your homepage in real time.',
      'Text, links, images, and files from VOLT — with Open, Copy, Save to vault, and Delete.',
      '“Save to vault” keeps anything you receive permanently in your VOLT vault, right from FRONTLY.',
      'Right-click any page, link, selection, or image → “Send to VOLT ⚡” to send it straight to a chosen contact.',
      'Redirect/wrapper links (Google Images, Facebook, Bing, etc.) are automatically unwrapped to their real destination.',
      'VOLT widget is fully customizable — item count, sender, timestamps, and content-type filters.',
    ],
  },
  {
    version: '1.5.0',
    title: "What's new in 1.5.0",
    items: [
      'Search the web from the search box — press Enter (Google, DuckDuckGo, Bing, or Brave).',
      'Edit a saved link’s URL, not just its title. Paste a URL to auto-fill the name.',
      'Todos now support due dates, drag-to-reorder, and rescheduling overdue tasks.',
      'Notes render Markdown — headings, lists, checkboxes, links, and more.',
      'Weather shows a 3-day forecast and “feels like”.',
      'New widgets: Timer / Pomodoro and RSS headlines. Speed dial links open with Alt+1–9.',
      'Automatic local backups — restore your boards from Settings → Data.',
    ],
  },
];

const SEEN_KEY = 'frontly-seen-version';

/** The most recent version the user has acknowledged, or '' if never. */
export function getSeenVersion(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setSeenVersion(v: string): void {
  try {
    localStorage.setItem(SEEN_KEY, v);
  } catch {
    // non-fatal
  }
}

/** Simple semver-ish compare: returns true when `a` > `b`. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

/**
 * Entries the user hasn't seen yet. Empty when up to date, or on a truly fresh
 * install (we mark the current version as seen without nagging first-timers).
 */
export function unseenWhatsNew(): WhatsNewEntry[] {
  const seen = getSeenVersion();
  if (!seen) {
    // Fresh install / pre-versioning user: don't show the panel, just record.
    setSeenVersion(APP_VERSION);
    return [];
  }
  return WHATS_NEW.filter((e) => isNewer(e.version, seen));
}
