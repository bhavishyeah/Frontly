/**
 * googleCalendar
 *
 * Read-only Google Calendar access for the Calendar widget, via
 * chrome.identity.getAuthToken (uses the user's Chrome Google account —
 * no redirect/popup juggling).
 *
 * Requirements (see the setup guide):
 *  - manifest oauth2.client_id set to your OAuth client ID
 *  - manifest oauth2.scopes includes calendar.readonly
 *  - the Google Cloud project has the Calendar API enabled
 *
 * All functions fail soft (return empty / throw a typed error) so the widget
 * never crashes FRONTLY if Google is unreachable or not configured.
 */

import type { CalendarEvent } from './workspaceTypes';

const CAL_API = 'https://www.googleapis.com/calendar/v3';

export class GoogleAuthError extends Error {}
export class GoogleNotConfiguredError extends Error {}

/**
 * Acquire an OAuth token for Google Calendar.
 * @param interactive true to show the Google consent/account picker (used on
 *        the explicit "Connect" click); false for silent refresh on load.
 */
export function getGoogleToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!chrome?.identity?.getAuthToken) {
      reject(new GoogleNotConfiguredError('chrome.identity is unavailable'));
      return;
    }
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        const msg = chrome.runtime.lastError?.message ?? 'No token';
        // "OAuth2 not granted or revoked" / "The user is not signed in" are
        // expected when not yet connected — surface as an auth error.
        reject(new GoogleAuthError(msg));
        return;
      }
      resolve(token as string);
    });
  });
}

/**
 * Revoke + drop the cached token so "Disconnect" fully signs the widget out.
 */
export async function revokeGoogleToken(): Promise<void> {
  try {
    const token = await getGoogleToken(false).catch(() => null);
    if (!token) return;
    // Remove from Chrome's token cache so the next getAuthToken re-prompts.
    await new Promise<void>((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
    // Best-effort server-side revoke.
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      });
    } catch {
      // ignore network errors on revoke
    }
  } catch {
    // ignore
  }
}

interface GoogleEventItem {
  id: string;
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

/** Convert a Google API event to our CalendarEvent shape. */
function mapGoogleEvent(item: GoogleEventItem): CalendarEvent | null {
  const start = item.start?.dateTime ?? item.start?.date;
  if (!start) return null;

  // All-day events use `date` (YYYY-MM-DD); timed events use `dateTime` (ISO).
  const isAllDay = !item.start?.dateTime;

  let date: string;
  let time: string | undefined;
  let endTime: string | undefined;

  if (isAllDay) {
    date = item.start!.date!;
  } else {
    const startDt = new Date(item.start!.dateTime!);
    date = toLocalDateStr(startDt);
    time = toLocalTimeStr(startDt);
    if (item.end?.dateTime) {
      endTime = toLocalTimeStr(new Date(item.end.dateTime));
    }
  }

  return {
    id: `google-${item.id}`,
    title: item.summary?.trim() || '(no title)',
    date,
    time,
    endTime,
    note: item.description,
    source: 'google',
  };
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toLocalTimeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Fetch events from the user's primary Google Calendar within a date window.
 * @param token OAuth token from getGoogleToken
 * @param fromDate inclusive lower bound (Date)
 * @param toDate exclusive upper bound (Date)
 */
/**
 * Trigger the interactive Google consent flow.
 * Returns { ok: true } on success, or { ok: false, error } with the real
 * Chrome/Google error message so the UI can show what actually went wrong.
 */
export async function connectGoogleCalendar(): Promise<{ ok: boolean; error?: string }> {
  try {
    await getGoogleToken(true);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Log the raw error so it shows in the extension's page console.
    console.error('[Calendar] Google connect failed:', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Like connectGoogleCalendar, but returns the underlying error message on
 * failure so the UI can show a specific reason (bad client id, API disabled,
 * user cancelled, etc.) instead of a generic "could not connect".
 */
export async function connectGoogleCalendarVerbose(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  try {
    await getGoogleToken(true);
    return { ok: true };
  } catch (err) {
    const reason =
      err instanceof Error && err.message ? err.message : 'Unknown error';
    return { ok: false, reason };
  }
}

/** Revoke and clear the cached Google token. */
export async function disconnectGoogleCalendar(): Promise<void> {
  await revokeGoogleToken();
}

export async function fetchGoogleEvents(
  token: string,
  fromDate: Date,
  toDate: Date
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: fromDate.toISOString(),
    timeMax: toDate.toISOString(),
    singleEvents: 'true', // expand recurring events into instances
    orderBy: 'startTime',
    maxResults: '100',
  });

  const res = await fetch(`${CAL_API}/calendars/primary/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 || res.status === 403) {
    throw new GoogleAuthError(`Google Calendar auth failed (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`Google Calendar request failed (${res.status})`);
  }

  const data = (await res.json()) as { items?: GoogleEventItem[] };
  return (data.items ?? [])
    .map(mapGoogleEvent)
    .filter((e): e is CalendarEvent => e !== null);
}
