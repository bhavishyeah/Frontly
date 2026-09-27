/**
 * CalendarWidget
 *
 * A wider-than-tall calendar widget that merges two event sources:
 *  - Local events (added in-widget, stored via the workspace store — either
 *    per-widget or workspace-shared, controlled by config.sharedCalendar)
 *  - Google Calendar events (read-only, fetched via chrome.identity)
 *
 * Responsive tiers (driven by a ResizeObserver on the container width):
 *  - narrow  → agenda only (today + upcoming)
 *  - wide    → month mini-grid on the left + agenda on the right
 *
 * Google events are never persisted — they are re-fetched on mount and merged
 * with local events for display.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
/* eslint-disable react-hooks/set-state-in-effect -- intentional: the Google
   fetch effect sets loading/result state, which is the documented pattern for
   subscribing to an external system (Google Calendar) on mount. */
import { ChevronLeft, ChevronRight, Plus, X, Trash2 } from 'lucide-react';
import type { BoardItem, CalendarConfig, CalendarEvent, WorkspaceItem } from '../../lib/workspaceTypes';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import {
  fetchGoogleEvents,
  getGoogleToken,
  GoogleAuthError,
} from '../../lib/googleCalendar';

// ---------------------------------------------------------------------------
// Date helpers (all local-time, no external deps)
// ---------------------------------------------------------------------------

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr(): string {
  return toDateStr(new Date());
}

/** Date string N days from today (local). Opaque helper — keeps the impure
 *  time read out of component render bodies. */
function dateStrDaysFromNow(days: number): string {
  return toDateStr(new Date(Date.now() + days * 86400000));
}

function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_SHORT_SUN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKDAY_SHORT_MON = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function formatAgendaDate(dateStr: string): string {
  const d = parseDateStr(dateStr);
  const today = todayStr();
  const tomorrow = dateStrDaysFromNow(1);
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(time?: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// ---------------------------------------------------------------------------
// Merge + group helpers
// ---------------------------------------------------------------------------

function sortEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  // All-day (no time) sorts before timed events.
  if (!a.time && b.time) return -1;
  if (a.time && !b.time) return 1;
  if (a.time && b.time) return a.time < b.time ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Add / edit event form (inline overlay)
// ---------------------------------------------------------------------------
function EventForm({
  initialDate,
  event,
  onSave,
  onCancel,
  onDelete,
}: {
  initialDate: string;
  event?: CalendarEvent;
  onSave: (data: { title: string; date: string; time?: string; endTime?: string; note?: string }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.date ?? initialDate);
  const [time, setTime] = useState(event?.time ?? '');
  const [endTime, setEndTime] = useState(event?.endTime ?? '');
  const [note, setNote] = useState(event?.note ?? '');

  const submit = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      date,
      time: time || undefined,
      endTime: endTime || undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <div className="f-cal-form" onClick={(e) => e.stopPropagation()}>
      <div className="f-cal-form-head">
        <span>{event ? 'Edit event' : 'New event'}</span>
        <button type="button" className="f-cal-form-close" onClick={onCancel} aria-label="Close"><X size={13} /></button>
      </div>
      <input
        className="f-cal-input"
        placeholder="Event title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
        autoFocus
      />
      <div className="f-cal-form-row">
        <input className="f-cal-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="f-cal-form-row">
        <input className="f-cal-input f-cal-input--time" type="time" value={time} onChange={(e) => setTime(e.target.value)} title="Start time (optional)" />
        <span className="f-cal-form-dash">–</span>
        <input className="f-cal-input f-cal-input--time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} title="End time (optional)" />
      </div>
      <input
        className="f-cal-input"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
      />
      <div className="f-cal-form-actions">
        {onDelete && (
          <button type="button" className="f-cal-form-delete" onClick={onDelete} aria-label="Delete event">
            <Trash2 size={13} />
          </button>
        )}
        <div className="f-cal-form-spacer" />
        <button type="button" className="f-cal-form-cancel" onClick={onCancel}>Cancel</button>
        <button type="button" className="f-cal-form-save" onClick={submit} disabled={!title.trim()}>Save</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid — shows a full month, or collapses to the current week when short.
// ---------------------------------------------------------------------------
function DayCell({
  dateStr,
  today,
  selectedDate,
  hasEvents,
  onSelectDate,
}: {
  dateStr: string | null;
  today: string;
  selectedDate: string;
  hasEvents: boolean;
  onSelectDate: (dateStr: string) => void;
}) {
  if (!dateStr) return <span className="f-cal-cell f-cal-cell--blank" />;
  const isToday = dateStr === today;
  const isSelected = dateStr === selectedDate;
  return (
    <button
      type="button"
      className={`f-cal-cell ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`}
      onClick={() => onSelectDate(dateStr)}
    >
      {parseDateStr(dateStr).getDate()}
      {hasEvents && <span className="f-cal-dot" />}
    </button>
  );
}

function CalendarGrid({
  mode,
  viewMonth,
  weekAnchor,
  weekStart,
  eventsByDate,
  selectedDate,
  onSelectDate,
  onPrev,
  onNext,
}: {
  mode: 'month' | 'week';
  viewMonth: Date;
  weekAnchor: Date; // any date within the week to show (week mode)
  weekStart: 0 | 1;
  eventsByDate: Map<string, CalendarEvent[]>;
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const today = todayStr();
  const weekdays = weekStart === 1 ? WEEKDAY_SHORT_MON : WEEKDAY_SHORT_SUN;

  // Build the cells for the active mode.
  let cells: (string | null)[];
  let label: string;

  if (mode === 'week') {
    // Find the start-of-week for weekAnchor.
    const anchor = new Date(weekAnchor);
    let offset = anchor.getDay() - weekStart;
    if (offset < 0) offset += 7;
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - offset);
    cells = Array.from({ length: 7 }, (_, i) =>
      toDateStr(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
    );
    const end = parseDateStr(cells[6]!);
    // Label: "May 4 – 10" or spanning months "Apr 28 – May 4"
    const sameMonth = start.getMonth() === end.getMonth();
    label = sameMonth
      ? `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()} – ${end.getDate()}`
      : `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}`;
  } else {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let leading = firstOfMonth.getDay() - weekStart;
    if (leading < 0) leading += 7;
    cells = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(toDateStr(new Date(year, month, d)));
    label = `${MONTH_NAMES[month]} ${year}`;
  }

  return (
    <div className={`f-cal-month f-cal-month--${mode}`}>
      <div className="f-cal-month-head">
        <button type="button" className="f-cal-nav" onClick={onPrev} aria-label={mode === 'week' ? 'Previous week' : 'Previous month'}><ChevronLeft size={14} /></button>
        <span className="f-cal-month-label">{label}</span>
        <button type="button" className="f-cal-nav" onClick={onNext} aria-label={mode === 'week' ? 'Next week' : 'Next month'}><ChevronRight size={14} /></button>
      </div>
      <div className="f-cal-weekdays">
        {weekdays.map((w) => <span key={w} className="f-cal-weekday">{w}</span>)}
      </div>
      <div className="f-cal-grid">
        {cells.map((dateStr, i) => (
          <DayCell
            key={dateStr ?? `blank-${i}`}
            dateStr={dateStr}
            today={today}
            selectedDate={selectedDate}
            hasEvents={dateStr ? (eventsByDate.get(dateStr)?.length ?? 0) > 0 : false}
            onSelectDate={onSelectDate}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda list
// ---------------------------------------------------------------------------
function Agenda({
  events,
  agendaDays,
  onEditLocal,
}: {
  events: CalendarEvent[];
  agendaDays: number;
  onEditLocal: (event: CalendarEvent) => void;
}) {
  // Compute the visible window and grouping once per events/agendaDays change.
  // Wrapped in useMemo so the impure Date read runs in an effect-like phase,
  // not directly during render.
  const groups = useMemo(() => {
    const today = todayStr();
    const horizon = dateStrDaysFromNow(agendaDays);

    const upcoming = events
      .filter((e) => e.date >= today && e.date <= horizon)
      .sort(sortEvents);

    const out: { date: string; items: CalendarEvent[] }[] = [];
    for (const ev of upcoming) {
      const last = out[out.length - 1];
      if (last && last.date === ev.date) last.items.push(ev);
      else out.push({ date: ev.date, items: [ev] });
    }
    return out;
  }, [events, agendaDays]);

  if (groups.length === 0) {
    return <div className="f-cal-agenda-empty">No upcoming events.</div>;
  }

  return (
    <div className="f-cal-agenda">
      {groups.map((g) => (
        <div key={g.date} className="f-cal-agenda-group">
          <div className="f-cal-agenda-date">{formatAgendaDate(g.date)}</div>
          {g.items.map((ev) => (
            <button
              key={ev.id}
              type="button"
              className={`f-cal-event ${ev.source === 'google' ? 'is-google' : ''}`}
              onClick={() => ev.source === 'local' && onEditLocal(ev)}
              title={ev.source === 'google' ? 'From Google Calendar (read-only)' : 'Click to edit'}
              style={ev.color ? { borderLeftColor: ev.color } : undefined}
            >
              <span className="f-cal-event-time">{ev.time ? formatTime(ev.time) : 'All day'}</span>
              <span className="f-cal-event-title">{ev.title}</span>
              {ev.source === 'google' && <span className="f-cal-event-badge">G</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root widget
// ---------------------------------------------------------------------------
interface Props {
  workspaceId: string;
  board: BoardItem;
  workspace: WorkspaceItem;
}

function resolveConfig(config?: CalendarConfig): Required<Omit<CalendarConfig, 'showMonthGrid'>> {
  return {
    sharedCalendar: config?.sharedCalendar ?? false,
    weekStart: config?.weekStart ?? 0,
    weekView: config?.weekView ?? false,
    googleConnected: config?.googleConnected ?? false,
    agendaDays: config?.agendaDays ?? 14,
  };
}

type CalView = 'calendar' | 'events';

export function CalendarWidget({ workspaceId, board, workspace }: Props) {
  const cfg = resolveConfig(board.calendarConfig);
  const { addCalendarEvent, updateCalendarEvent, removeCalendarEvent, setCalendarConfig } = useWorkspaceStore();

  // Local events come from the shared workspace pool or this board, per config.
  const localEvents = useMemo(
    () => (cfg.sharedCalendar ? workspace.sharedCalendarEvents ?? [] : board.calendarEvents ?? []),
    [cfg.sharedCalendar, workspace.sharedCalendarEvents, board.calendarEvents]
  );

  // Google events (fetched, not persisted)
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);
  const [googleState, setGoogleState] = useState<'idle' | 'loading' | 'error'>('idle');

  // Which tab is active: the grid, or the events list.
  const [view, setView] = useState<CalView>('calendar');

  // Grid mode is chosen by the user via the "Week view" setting (not by size).
  const gridMode: 'month' | 'week' = cfg.weekView ? 'week' : 'month';

  // WIDTH is the only responsive axis: wide enough → split layout (grid +
  // upcoming-events column side by side, tabs hidden); narrow → single view
  // with the Calendar|Events tabs.
  const containerRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(false);
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSplit(rect.width > 420);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Month + week navigation, and selected day
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => todayStr());

  // Add/edit form state
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | undefined>(undefined);

  // Fetch Google events when connected
  const loadGoogle = useCallback(async (interactive: boolean) => {
    setGoogleState('loading');
    try {
      const token = await getGoogleToken(interactive);
      const from = new Date();
      from.setMonth(from.getMonth() - 1);
      const to = new Date();
      to.setMonth(to.getMonth() + 2);
      const events = await fetchGoogleEvents(token, from, to);
      setGoogleEvents(events);
      setGoogleState('idle');
      if (!cfg.googleConnected) {
        setCalendarConfig(workspaceId, board.id, { googleConnected: true });
      }
    } catch (err) {
      setGoogleEvents([]);
      setGoogleState('error');
      if (err instanceof GoogleAuthError && cfg.googleConnected) {
        // Token expired/revoked — flip the flag so the Connect button returns.
        setCalendarConfig(workspaceId, board.id, { googleConnected: false });
      }
    }
  }, [cfg.googleConnected, workspaceId, board.id, setCalendarConfig]);

  // On mount / when connected flag flips on, silently refresh Google events.
  useEffect(() => {
    if (cfg.googleConnected) {
      loadGoogle(false);
    } else {
      setGoogleEvents([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.googleConnected]);

  // Merge local + Google for display
  const allEvents = useMemo(() => [...localEvents, ...googleEvents], [localEvents, googleEvents]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of allEvents) {
      const arr = map.get(ev.date) ?? [];
      arr.push(ev);
      map.set(ev.date, arr);
    }
    return map;
  }, [allEvents]);

  const openNewForm = (date: string) => {
    setEditingEvent(undefined);
    setSelectedDate(date);
    setFormOpen(true);
  };
  const openEditForm = (event: CalendarEvent) => {
    setEditingEvent(event);
    setFormOpen(true);
  };

  const handleSave = (data: { title: string; date: string; time?: string; endTime?: string; note?: string }) => {
    if (editingEvent) {
      updateCalendarEvent(workspaceId, board.id, editingEvent.id, data);
    } else {
      addCalendarEvent(workspaceId, board.id, data);
    }
    setFormOpen(false);
    setEditingEvent(undefined);
  };

  const handleDelete = () => {
    if (editingEvent) removeCalendarEvent(workspaceId, board.id, editingEvent.id);
    setFormOpen(false);
    setEditingEvent(undefined);
  };

  // Navigation handlers depend on the current grid mode.
  const goPrev = () => {
    if (gridMode === 'week') {
      setWeekAnchor((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() - 7));
    } else {
      setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
    }
  };
  const goNext = () => {
    if (gridMode === 'week') {
      setWeekAnchor((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7));
    } else {
      setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
    }
  };

  const eventCount = allEvents.filter((e) => e.date >= todayStr()).length;

  const grid = (
    <CalendarGrid
      mode={gridMode}
      viewMonth={viewMonth}
      weekAnchor={weekAnchor}
      weekStart={cfg.weekStart}
      eventsByDate={eventsByDate}
      selectedDate={selectedDate}
      onSelectDate={(d) => { setSelectedDate(d); openNewForm(d); }}
      onPrev={goPrev}
      onNext={goNext}
    />
  );

  return (
    <div className="f-cal" ref={containerRef}>
      {/* Header: tabs (hidden in split mode, where both panels are visible),
          plus sync + add controls. */}
      <div className="f-cal-toolbar">
        {split ? (
          <span className="f-cal-title">Calendar</span>
        ) : (
          <div className="f-cal-tabs">
            <button
              type="button"
              className={`f-cal-tab ${view === 'calendar' ? 'is-active' : ''}`}
              onClick={() => setView('calendar')}
            >
              Calendar
            </button>
            <button
              type="button"
              className={`f-cal-tab ${view === 'events' ? 'is-active' : ''}`}
              onClick={() => setView('events')}
            >
              Events{eventCount > 0 ? ` (${eventCount})` : ''}
            </button>
          </div>
        )}
        <div className="f-cal-toolbar-right">
          {googleState === 'loading' && <span className="f-cal-syncing">Syncing…</span>}
          {cfg.googleConnected && googleState === 'error' && (
            <button type="button" className="f-cal-retry" onClick={() => loadGoogle(false)}>Retry</button>
          )}
          <button
            type="button"
            className="f-cal-add"
            onClick={() => openNewForm(selectedDate)}
            aria-label="Add event"
            title="Add event"
          >
            <Plus size={14} strokeWidth={2.4} />
          </button>
        </div>
      </div>

      <div className={`f-cal-body ${split ? 'is-split' : ''}`}>
        {split ? (
          <>
            <div className="f-cal-split-grid">{grid}</div>
            <div className="f-cal-split-events">
              <div className="f-cal-split-events-head">{gridMode === 'week' ? "This week" : "This month"}</div>
              {/* Scope events to the visible range: 7 days for week view,
                  ~a month for month view. */}
              <Agenda events={allEvents} agendaDays={gridMode === 'week' ? 7 : 31} onEditLocal={openEditForm} />
            </div>
          </>
        ) : view === 'calendar' ? (
          grid
        ) : (
          <Agenda events={allEvents} agendaDays={cfg.agendaDays} onEditLocal={openEditForm} />
        )}
      </div>

      {formOpen && (
        <div className="f-cal-form-overlay" onClick={() => { setFormOpen(false); setEditingEvent(undefined); }}>
          <EventForm
            initialDate={selectedDate}
            event={editingEvent}
            onSave={handleSave}
            onCancel={() => { setFormOpen(false); setEditingEvent(undefined); }}
            onDelete={editingEvent ? handleDelete : undefined}
          />
        </div>
      )}
    </div>
  );
}
