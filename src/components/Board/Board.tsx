import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ArrowRightLeft, Copy, Eye, EyeOff, Pencil, Plus, Trash2, LayoutGrid, Columns, GripVertical, Maximize2, ExternalLink, Settings2 } from 'lucide-react';
import type { BoardItem, WorkspaceItem } from '../../lib/workspaceTypes';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { LinkCard } from '../Card/LinkCard';
import { getFaviconUrl } from '../../lib/favicon';
import { TodoBoardContent } from '../Widgets/TodoBoard';
import { NoteBoardContent } from '../Widgets/NoteBoard';
import { WeatherWidget } from '../Widgets/WeatherWidget';
import { ClockWidget } from '../Widgets/ClockWidget';
import { TimerWidget } from '../Widgets/TimerWidget';
import { RssWidget } from '../Widgets/RssWidget';
import { VoltWidget } from '../Widgets/VoltWidget';
import { CalendarWidget } from '../Widgets/CalendarWidget';
import { connectGoogleCalendar, disconnectGoogleCalendar } from '../../lib/googleCalendar';
import { useVoltStore } from '../../store/useVoltStore';
import { DateTimePicker } from '../UI/DateTimePicker';
import { Autocomplete } from '../UI/Autocomplete';
import { searchTimezones } from '../../lib/timezones';

interface Props {
  workspaceId: string;
  board: BoardItem;
  workspaces: WorkspaceItem[];
}

export function Board({ workspaceId, board, workspaces }: Props) {
  const { removeBoard, renameBoard, addLink, removeLink, renameLink, updateLink, transferBoard, transferLink, setBoardColor, updateNoteContent, updateTodos, duplicateBoard, toggleBoardHeader, setBoardDisplayMode, setBoardIconSize, setBoardSections, setClockConfig, setWeatherConfig, setTimerConfig, setRssConfig, setVoltConfig, setCalendarConfig } =
    useWorkspaceStore();

  // Determine if this is a widget (non-link board) — must be before any hooks that use it
  const isWidget = board.type === 'clock' || board.type === 'weather' || board.type === 'note' || board.type === 'todo'
    || board.type === 'timer' || board.type === 'rss' || board.type === 'volt' || board.type === 'calendar';

  const textMode = useSettingsStore((s) => s.textMode);
  const boardTextColor = useSettingsStore((s) => isWidget ? s.widgetTextColor : s.boardTextColor);
  const miscTextColor = useSettingsStore((s) => s.miscTextColor);

  // Use widget-specific or board-specific glass settings
  const boardOpacity = useSettingsStore((s) => isWidget ? s.widgetOpacity : s.boardOpacity);
  const boardRadius = useSettingsStore((s) => isWidget ? s.widgetRadius : s.boardRadius);
  const glassBlur = useSettingsStore((s) => isWidget ? s.widgetBlur : s.glassBlur);
  const glassSaturation = useSettingsStore((s) => isWidget ? s.widgetSaturation : s.glassSaturation);
  const grainIntensity = useSettingsStore((s) => isWidget ? s.widgetGrain : s.grainIntensity);
  const widgetColor = useSettingsStore((s) => s.widgetColor);
  const openLinksNewTab = useSettingsStore((s) => s.openLinksNewTab);
  const defaultDisplayMode = useSettingsStore((s) => s.defaultDisplayMode);
  const defaultIconSize = useSettingsStore((s) => s.defaultIconSize);
  const defaultShowSections = useSettingsStore((s) => s.defaultShowSections);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formPos, setFormPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 240 });
  const [boardContextMenu, setBoardContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [widgetConfigOpen, setWidgetConfigOpen] = useState(false);
  const [widgetConfigPos, setWidgetConfigPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const boardRef = useRef<HTMLElement | null>(null);
  const contextRef = useRef<HTMLDivElement | null>(null);
  const renameRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const widgetConfigRef = useRef<HTMLDivElement | null>(null);
  const widgetPopRef = useRef<HTMLDivElement | null>(null);


  const { setNodeRef, isOver } = useDroppable({
    id: `board-drop-${board.id}`,
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!boardRef.current) return;
      const target = event.target as Node;
      // Allow clicks inside the board or inside the portaled form
      if (boardRef.current.contains(target)) return;
      if (formRef.current && formRef.current.contains(target)) return;
      setShowForm(false);
    };

    if (showForm) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showForm]);

  // Close board context menu on outside click
  useEffect(() => {
    if (!boardContextMenu) return;

    const handleClick = (e: MouseEvent) => {
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) {
        setBoardContextMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [boardContextMenu]);

  // Close widget config popover on outside click
  useEffect(() => {
    if (!widgetConfigOpen) return;
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node;
      const inButton = widgetConfigRef.current?.contains(t);
      const inPop = widgetPopRef.current?.contains(t);
      if (!inButton && !inPop) setWidgetConfigOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [widgetConfigOpen]);

  // Clamp context menu within viewport
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });
  useEffect(() => {
    if (!boardContextMenu || !contextRef.current) return;

    const menuRect = contextRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;

    let left = boardContextMenu.x;
    let top: number | undefined = boardContextMenu.y;
    let bottom: number | undefined;

    // Clamp right edge
    if (left + menuRect.width > vw - pad) {
      left = Math.max(pad, vw - menuRect.width - pad);
    }

    // Clamp bottom — flip upward if needed
    if (top + menuRect.height > vh - pad) {
      // Try flipping
      const flippedBottom = vh - boardContextMenu.y;
      if (flippedBottom + menuRect.height > vh - pad) {
        // Still overflows — just pin to top
        top = pad;
      } else {
        top = undefined;
        bottom = flippedBottom;
      }
    }

    setMenuPos({ top, bottom, left });
  }, [boardContextMenu]);

  // Open the widget config popover, anchoring it to the gear button and
  // clamping to the viewport so it is never clipped by the board panel
  // (which has overflow:hidden) or the screen edges.
  const openWidgetConfig = () => {
    if (widgetConfigOpen) { setWidgetConfigOpen(false); return; }
    // Seed a position just below the gear; the effect below refines it once the
    // real popover size is known so it always sits snug next to the widget.
    const btn = widgetConfigRef.current?.getBoundingClientRect();
    setWidgetConfigPos({ top: (btn ? btn.bottom : 40) + 4, left: (btn ? btn.right - 220 : 40) });
    setWidgetConfigOpen(true);
  };

  // Refine the popover position from its real measured size, anchored to the
  // gear button and clamped to the viewport (flips above only if it truly
  // won't fit below).
  useEffect(() => {
    if (!widgetConfigOpen) return;
    const btn = widgetConfigRef.current?.getBoundingClientRect();
    const pop = widgetPopRef.current?.getBoundingClientRect();
    if (!btn || !pop) return;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = btn.right - pop.width;       // right-align to the gear
    let top = btn.bottom + 4;               // just below the gear

    if (left < pad) left = pad;
    if (left + pop.width > vw - pad) left = Math.max(pad, vw - pop.width - pad);

    if (top + pop.height > vh - pad) {
      const above = btn.top - pop.height - 4;
      top = above >= pad ? above : Math.max(pad, vh - pop.height - pad);
    }

    // Only update when it actually moved, to avoid an update loop.
    setWidgetConfigPos((prev) =>
      Math.abs(prev.top - top) > 1 || Math.abs(prev.left - left) > 1 ? { top, left } : prev
    );
  }, [widgetConfigOpen, board.timerConfig?.mode]);

  // Focus rename input
  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [isRenaming]);

  const mergedRef = (node: HTMLElement | null) => {
    boardRef.current = node;
    setNodeRef(node);
  };

  const handleSave = () => {
    if (!title.trim() || !url.trim()) return;

    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    addLink(workspaceId, board.id, title.trim(), normalizedUrl);
    setTitle('');
    setUrl('');
    setShowForm(false);
  };

  const handleBoardNameContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Seed menuPos at the click point immediately so the menu never flashes at
    // the top-left corner before the clamp effect measures and adjusts it.
    setMenuPos({ top: e.clientY, left: e.clientX });
    setBoardContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleTransfer = (targetWorkspaceId: string) => {
    setBoardContextMenu(null);
    transferBoard(workspaceId, targetWorkspaceId, board.id);
  };

  const handleStartRename = () => {
    setBoardContextMenu(null);
    setRenameValue(board.name);
    setIsRenaming(true);
  };

  const handleCommitRename = () => {
    if (renameValue.trim()) {
      renameBoard(workspaceId, board.id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCommitRename();
    if (e.key === 'Escape') setIsRenaming(false);
  };

  const handleDeleteBoard = () => {
    setBoardContextMenu(null);
    removeBoard(workspaceId, board.id);
  };

  const handleDuplicate = () => {
    setBoardContextMenu(null);
    duplicateBoard(workspaceId, board.id);
  };

  const handleOpenAll = () => {
    setBoardContextMenu(null);
    // Open each link in its own new background tab.
    board.links.forEach((link) => {
      window.open(link.url, '_blank', 'noopener,noreferrer');
    });
  };

  const handleAddLink = () => {
    setBoardContextMenu(null);
    if (boardRef.current) {
      const rect = boardRef.current.getBoundingClientRect();
      const formW = Math.max(rect.width, 240);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Place below the board by default; flip above if not enough space
      let top = rect.bottom + 8;
      if (top + 140 > vh - 8) top = rect.top - 140 - 8;
      let left = rect.left;
      if (left + formW > vw - 8) left = Math.max(8, vw - formW - 8);
      setFormPos({ top, left, width: formW });
    }
    setShowForm(true);
  };

  // Other workspaces to transfer to (exclude current)
  const otherWorkspaces = workspaces.filter((ws) => ws.id !== workspaceId);

  // Memoize board style to avoid recalculating on every render
  const boardStyle = useMemo((): React.CSSProperties => {
    const mode = board.displayMode || defaultDisplayMode;

    // Floating mode — no background, no border, no glass
    if (mode === 'icons-floating') {
      return {
        background: 'transparent',
        border: 'none',
        boxShadow: 'none',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        borderRadius: '0',
      };
    }

    // Widgets (clock/weather/note/todo) render borderless so they blend into
    // the wallpaper instead of looking like separate framed cards. Link boards
    // keep their subtle 1px frame.
    const baseStyle: React.CSSProperties = {
      borderRadius: `${boardRadius}px`,
      backdropFilter: `blur(${glassBlur}px) saturate(${glassSaturation}%)`,
      WebkitBackdropFilter: `blur(${glassBlur}px) saturate(${glassSaturation}%)`,
      border: isWidget ? 'none' : '1px solid rgba(255, 255, 255, 0.2)',
    };

    // Determine effective color:
    // Per-board color always wins (lets users override individual widgets).
    // If no per-board color, widgets fall back to the global widgetColor from settings.
    const effectiveColor = board.color || (isWidget ? widgetColor : undefined) || undefined;

    if (effectiveColor === 'clear') {
      baseStyle.background = `rgba(255, 255, 255, 0.08)`;
      baseStyle.border = isWidget ? 'none' : '1px solid rgba(255, 255, 255, 0.15)';
    } else if (effectiveColor) {
      const hex = effectiveColor;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      baseStyle.background = `rgba(${r}, ${g}, ${b}, ${boardOpacity})`;
      if (!isWidget) baseStyle.borderColor = `${effectiveColor}aa`;
    } else {
      baseStyle.background = `rgba(250, 248, 244, ${boardOpacity})`;
    }
    // Text color: explicit user setting wins, then auto-logic, then default dark
    if (boardTextColor) {
      baseStyle.color = boardTextColor;
    } else if (textMode === 'light' || effectiveColor === 'clear') {
      baseStyle.color = '#fff';
    } else if (textMode === 'dark') {
      baseStyle.color = '#111';
    } else if (effectiveColor) {
      baseStyle.color = '#fff';
    } else {
      baseStyle.color = '#222'; // always set so form can inherit
    }
    return baseStyle;
  }, [boardRadius, glassBlur, glassSaturation, boardOpacity, textMode, board.color, isWidget, widgetColor, board.displayMode, defaultDisplayMode, boardTextColor]);

  return (
    <section
      ref={mergedRef}
      className={`td-board-panel ${isOver ? 'is-over' : ''} ${showForm ? 'is-form-open' : ''} ${isWidget ? 'td-board-panel--widget' : ''} ${board.type === 'calendar' ? 'td-board-panel--calendar' : ''} ${(board.displayMode || defaultDisplayMode) === 'icons-floating' ? 'td-board-panel--floating' : ''}`}
      style={boardStyle}
      onContextMenu={handleBoardNameContextMenu}
    >
      {/* Grain overlay */}
      {grainIntensity > 0 && (
        <div className="td-board-grain" style={{ opacity: grainIntensity / 100 }} />
      )}

      {/* Drag handle bar */}
      <div className="td-board-drag-bar" />

      {/* Widget config gear (clock / weather / timer / rss / volt / calendar) */}
      {(board.type === 'clock' || board.type === 'weather' || board.type === 'timer' || board.type === 'rss' || board.type === 'volt' || board.type === 'calendar') && (
        <div className="f-widget-config" ref={widgetConfigRef}>
          <button
            type="button"
            className="f-widget-config-btn"
            onClick={openWidgetConfig}
            aria-label="Widget settings"
            title="Widget settings"
          >
            <Settings2 size={13} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Widget config popover — portaled to body so it is never clipped by
          the board panel's overflow:hidden, and clamped to the viewport. */}
      {widgetConfigOpen && board.type === 'clock' &&
        createPortal(
          <div
            ref={widgetPopRef}
            className="f-widget-config-pop"
            style={{ position: 'fixed', top: widgetConfigPos.top, left: widgetConfigPos.left }}
          >
            <div className="f-wc-row">
              <span className="f-wc-label">Format</span>
              <div className="f-pill-group">
                <button type="button" className={`f-pill ${!(board.clockConfig?.hour24) ? 'is-active' : ''}`} onClick={() => setClockConfig(workspaceId, board.id, { hour24: false })}>12h</button>
                <button type="button" className={`f-pill ${board.clockConfig?.hour24 ? 'is-active' : ''}`} onClick={() => setClockConfig(workspaceId, board.id, { hour24: true })}>24h</button>
              </div>
            </div>
            <div className="f-wc-row">
              <span className="f-wc-label">Seconds</span>
              <button
                type="button"
                className={`f-toggle ${board.clockConfig?.showSeconds ? 'is-on' : ''}`}
                onClick={() => setClockConfig(workspaceId, board.id, { showSeconds: !board.clockConfig?.showSeconds })}
                aria-label="Toggle seconds"
              ><span className="f-toggle-knob" /></button>
            </div>
            <div className="f-wc-row">
              <span className="f-wc-label">Date</span>
              <button
                type="button"
                className={`f-toggle ${(board.clockConfig?.showDate ?? true) ? 'is-on' : ''}`}
                onClick={() => setClockConfig(workspaceId, board.id, { showDate: !(board.clockConfig?.showDate ?? true) })}
                aria-label="Toggle date"
              ><span className="f-toggle-knob" /></button>
            </div>
            <div className="f-wc-row f-wc-row--stack">
              <span className="f-wc-label">Timezone</span>
              <Autocomplete
                initialText={board.clockConfig?.timezone || ''}
                placeholder="Search city/region (blank = local)"
                getOptions={(q) => searchTimezones(q)}
                onSelect={(opt) => setClockConfig(workspaceId, board.id, { timezone: opt.value })}
                onSubmitText={(t) => { setClockConfig(workspaceId, board.id, { timezone: t }); setWidgetConfigOpen(false); }}
              />
              <div className="f-wc-hint">Blank uses this device's local time.</div>
            </div>
          </div>,
          document.body
        )
      }

      {widgetConfigOpen && board.type === 'weather' &&
        createPortal(
          <div
            ref={widgetPopRef}
            className="f-widget-config-pop"
            style={{ position: 'fixed', top: widgetConfigPos.top, left: widgetConfigPos.left }}
          >
            <div className="f-wc-row">
              <span className="f-wc-label">Unit</span>
              <div className="f-pill-group">
                <button type="button" className={`f-pill ${(board.weatherConfig?.unit ?? 'c') === 'c' ? 'is-active' : ''}`} onClick={() => setWeatherConfig(workspaceId, board.id, { unit: 'c' })}>°C</button>
                <button type="button" className={`f-pill ${board.weatherConfig?.unit === 'f' ? 'is-active' : ''}`} onClick={() => setWeatherConfig(workspaceId, board.id, { unit: 'f' })}>°F</button>
              </div>
            </div>
            <div className="f-wc-row f-wc-row--stack">
              <span className="f-wc-label">Location</span>
              <Autocomplete
                initialText={board.weatherConfig?.label || ''}
                placeholder="Search city (blank = auto)"
                getOptions={async (q) => {
                  if (q.trim().length < 2) return [];
                  try {
                    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=8`);
                    const d = await r.json();
                    return (d?.results ?? []).map((hit: { id: number; name: string; admin1?: string; country?: string; latitude: number; longitude: number }) => ({
                      value: String(hit.id),
                      label: hit.name,
                      sublabel: [hit.admin1, hit.country].filter(Boolean).join(', '),
                      // stash coords on the option via a data map below
                      lat: hit.latitude,
                      lon: hit.longitude,
                    }));
                  } catch { return []; }
                }}
                onSelect={(opt) => {
                  const o = opt as unknown as { label: string; lat: number; lon: number };
                  setWeatherConfig(workspaceId, board.id, { lat: o.lat, lon: o.lon, label: o.label });
                }}
                onSubmitText={(t) => {
                  if (!t) { setWeatherConfig(workspaceId, board.id, { lat: undefined, lon: undefined, label: undefined }); }
                }}
              />
              <div className="f-wc-hint">Leave blank to use your device location.</div>
            </div>
          </div>,
          document.body
        )
      }

      {widgetConfigOpen && board.type === 'timer' &&
        createPortal(
          <div
            ref={widgetPopRef}
            className="f-widget-config-pop"
            style={{ position: 'fixed', top: widgetConfigPos.top, left: widgetConfigPos.left }}
          >
            <div className="f-wc-row">
              <span className="f-wc-label">Mode</span>
              <div className="f-pill-group">
                <button type="button" className={`f-pill ${(board.timerConfig?.mode ?? 'countdown') === 'countdown' ? 'is-active' : ''}`} onClick={() => setTimerConfig(workspaceId, board.id, { mode: 'countdown' })}>Countdown</button>
                <button type="button" className={`f-pill ${board.timerConfig?.mode === 'pomodoro' ? 'is-active' : ''}`} onClick={() => setTimerConfig(workspaceId, board.id, { mode: 'pomodoro' })}>Pomodoro</button>
              </div>
            </div>

            <div className="f-wc-mode-body" key={board.timerConfig?.mode ?? 'countdown'}>
            {(board.timerConfig?.mode ?? 'countdown') === 'countdown' ? (
              <>
                <div className="f-wc-row f-wc-row--stack">
                  <span className="f-wc-label">Label</span>
                  <input
                    className="f-wc-input"
                    placeholder="e.g. Launch day"
                    defaultValue={board.timerConfig?.label || ''}
                    onBlur={(e) => setTimerConfig(workspaceId, board.id, { label: e.target.value.trim() })}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  />
                </div>
                <div className="f-wc-row f-wc-row--stack">
                  <span className="f-wc-label">Target date &amp; time</span>
                  <DateTimePicker
                    value={board.timerConfig?.target || ''}
                    onChange={(iso) => setTimerConfig(workspaceId, board.id, { target: iso || undefined })}
                    onSubmit={() => setWidgetConfigOpen(false)}
                  />
                </div>
                <button type="button" className="f-wc-save" onClick={() => setWidgetConfigOpen(false)}>Save</button>
              </>
            ) : (
              <>
                <div className="f-wc-row">
                  <span className="f-wc-label">Focus (min)</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    className="f-wc-input f-wc-input--sm"
                    defaultValue={board.timerConfig?.focusMinutes ?? 25}
                    onBlur={(e) => setTimerConfig(workspaceId, board.id, { focusMinutes: Math.max(1, Number(e.target.value) || 25) })}
                  />
                </div>
                <div className="f-wc-row">
                  <span className="f-wc-label">Break (min)</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className="f-wc-input f-wc-input--sm"
                    defaultValue={board.timerConfig?.breakMinutes ?? 5}
                    onBlur={(e) => setTimerConfig(workspaceId, board.id, { breakMinutes: Math.max(1, Number(e.target.value) || 5) })}
                    onKeyDown={(e) => { if (e.key === 'Enter') setWidgetConfigOpen(false); }}
                  />
                </div>
                <button type="button" className="f-wc-save" onClick={() => setWidgetConfigOpen(false)}>Save</button>
              </>
            )}
            </div>
          </div>,
          document.body
        )
      }

      {widgetConfigOpen && board.type === 'rss' &&
        createPortal(
          <div
            ref={widgetPopRef}
            className="f-widget-config-pop"
            style={{ position: 'fixed', top: widgetConfigPos.top, left: widgetConfigPos.left }}
          >
            <div className="f-wc-row f-wc-row--stack">
              <span className="f-wc-label">Feed URL</span>
              <input
                className="f-wc-input"
                placeholder="https://example.com/feed.xml"
                defaultValue={board.rssConfig?.url || ''}
                onBlur={(e) => setRssConfig(workspaceId, board.id, { url: e.target.value.trim() })}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
            </div>
            <div className="f-wc-row">
              <span className="f-wc-label">Items</span>
              <input
                type="number"
                min={1}
                max={20}
                className="f-wc-input f-wc-input--sm"
                defaultValue={board.rssConfig?.count ?? 6}
                onBlur={(e) => setRssConfig(workspaceId, board.id, { count: Math.min(20, Math.max(1, Number(e.target.value) || 6)) })}
              />
            </div>
            <div className="f-wc-hint">Paste any RSS or Atom feed URL.</div>
          </div>,
          document.body
        )
      }

      {widgetConfigOpen && board.type === 'volt' &&
        createPortal(
          <VoltConfigPopover
            popRef={widgetPopRef}
            pos={widgetConfigPos}
            workspaceId={workspaceId}
            board={board}
            setVoltConfig={setVoltConfig}
          />,
          document.body
        )
      }

      {widgetConfigOpen && board.type === 'calendar' &&
        createPortal(
          <CalendarConfigPopover
            popRef={widgetPopRef}
            pos={widgetConfigPos}
            workspaceId={workspaceId}
            board={board}
            setCalendarConfig={setCalendarConfig}
          />,
          document.body
        )
      }

      {(() => {
        const mode = board.displayMode || defaultDisplayMode;
        // All icon modes hide the header
        if (mode === 'icons-vertical' || mode === 'icons-horizontal' || mode === 'icons-floating') return false;
        if (board.type === 'clock' || board.type === 'weather' || board.type === 'volt' || board.type === 'calendar') return false;
        if (board.hideHeader) return false;
        return true;
        // Note: timer/rss/speeddial keep their header (it doubles as a title).
      })() && (
        <div className="td-board-top">
          {isRenaming ? (
            <input
              ref={renameRef}
              className="td-board-name"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleCommitRename}
              onKeyDown={handleRenameKeyDown}
              spellCheck={false}
            />
          ) : (
            <>
              <span
                className="td-board-name-label"
                title="Right-click for options"
              >
                {board.name}
              </span>
              {board.type !== 'note' && board.type !== 'todo' && board.links.length > 0 && (
                <span className="f-board-count">{board.links.length}</span>
              )}
              {board.type === 'todo' && (board.todos || []).length > 0 && (
                <span className="f-board-count f-todo-header-count">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5.5L4 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {(board.todos || []).filter((t) => t.done).length}/{(board.todos || []).length}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {board.type === 'note' ? (
        <NoteBoardContent
          content={board.noteContent || ''}
          onChange={(content) => updateNoteContent(workspaceId, board.id, content)}
        />
      ) : board.type === 'todo' ? (
        <TodoBoardContent
          todos={board.todos || []}
          onChange={(todos) => updateTodos(workspaceId, board.id, todos)}
        />
      ) : board.type === 'weather' ? (
        <WeatherWidget config={board.weatherConfig} />
      ) : board.type === 'clock' ? (
        <ClockWidget config={board.clockConfig} />
      ) : board.type === 'timer' ? (
        <TimerWidget config={board.timerConfig} />
      ) : board.type === 'rss' ? (
        <RssWidget config={board.rssConfig} />
      ) : board.type === 'volt' ? (
        <VoltWidget config={board.voltConfig} />
      ) : board.type === 'calendar' ? (
        <CalendarWidget
          workspaceId={workspaceId}
          board={board}
          workspace={workspaces.find((w) => w.id === workspaceId)!}
        />
      ) : (() => {
        // Link board — check display mode
        const mode = board.displayMode || defaultDisplayMode;
        const iconSz = board.iconSize || defaultIconSize;
        const sections = board.showSections ?? defaultShowSections;

        if (mode === 'icons-vertical' || mode === 'icons-horizontal' || mode === 'icons-floating') {
          // Icon-only modes
          const isHorizontal = mode === 'icons-horizontal' || mode === 'icons-floating';
          return (
            <div className={`f-icon-strip ${isHorizontal ? 'f-icon-strip--h' : 'f-icon-strip--v'} ${sections ? 'f-icon-strip--sections' : ''}`}>
              {board.links.map((link, i) => (
                <a
                  key={link.id}
                  href={link.url}
                  className="f-icon-item"
                  title={i < 9 ? `${link.title} (Alt+${i + 1})` : link.title}
                  target={openLinksNewTab ? '_blank' : '_self'}
                  rel="noopener noreferrer"
                  data-speeddial-index={i < 9 ? i + 1 : undefined}
                  style={{ width: iconSz, height: iconSz }}
                >
                  <img
                    src={getFaviconUrl(link.url, iconSz <= 16 ? 32 : iconSz <= 24 ? 48 : 128)}
                    alt=""
                    width={iconSz}
                    height={iconSz}
                    onError={(e) => {
                      const img = e.currentTarget;
                      img.style.display = 'none';
                    }}
                  />
                </a>
              ))}
              {board.links.length === 0 && (
                <span className="f-icon-strip-empty" title="Right-click to add links">+</span>
              )}
            </div>
          );
        }

        // Default mode — full link list
        return (
          <div className="td-board-links">
            {board.links.length === 0 ? (
              <div className="td-board-empty">
                <span>Right-click to add links</span>
              </div>
            ) : (
              <SortableContext
                items={board.links.map((l) => l.id)}
                strategy={verticalListSortingStrategy}
              >
                {board.links.map((link) => (
                  <LinkCard
                    key={link.id}
                    link={link}
                    onDelete={() => removeLink(workspaceId, board.id, link.id)}
                    onRename={(newTitle) => renameLink(workspaceId, board.id, link.id, newTitle)}
                    onEdit={(patch) => updateLink(workspaceId, board.id, link.id, patch)}
                    onTransfer={(toWsId, toBoardId) => transferLink(workspaceId, board.id, link.id, toWsId, toBoardId)}
                    transferTargets={otherWorkspaces.flatMap((ws) =>
                      ws.boards.map((b) => ({
                        workspaceId: ws.id,
                        workspaceName: ws.name,
                        boardId: b.id,
                        boardName: b.name,
                      }))
                    )}
                  />
                ))}
              </SortableContext>
            )}
          </div>
        );
      })()}

      {showForm && (!board.type || board.type === 'links') &&
        createPortal(
          <div
            ref={formRef}
            className="td-floating-add-panel"
            style={{
              position: 'fixed',
              top: formPos.top,
              left: formPos.left,
              width: formPos.width,
              // Inherit the board's glass appearance
              background: boardStyle.background,
              backdropFilter: boardStyle.backdropFilter,
              WebkitBackdropFilter: boardStyle.WebkitBackdropFilter,
              borderRadius: boardStyle.borderRadius,
              border: boardStyle.border ?? '1px solid rgba(255,255,255,0.2)',
              color: miscTextColor || boardStyle.color,
              boxShadow: '0 14px 28px rgba(0,0,0,0.18)',
            }}
          >
            <div className="td-add-form">
              <input
                className="td-add-input"
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget.nextElementSibling as HTMLInputElement)?.focus(); } if (e.key === 'Escape') setShowForm(false); }}
                autoFocus
              />
              <input
                className="td-add-input"
                placeholder="URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowForm(false); }}
              />
              <button
                className="td-add-save"
                type="button"
                onClick={handleSave}
              >
                Add
              </button>
            </div>
          </div>,
          document.body
        )
      }

      {/* Board context menu — portaled to body */}
      {boardContextMenu &&
        createPortal(
          <div
            ref={contextRef}
            className="td-link-context-menu"
            style={menuPos}
          >
            {(!board.type || board.type === 'links') && (
              <button
                className="td-link-context-item"
                type="button"
                onClick={handleAddLink}
              >
                <Plus size={13} strokeWidth={2} />
                <span>Add link</span>
              </button>
            )}
            {board.type !== 'clock' && board.type !== 'weather' && (board.displayMode || defaultDisplayMode) === 'default' && (
              <button
                className="td-link-context-item"
                type="button"
                onClick={handleStartRename}
              >
                <Pencil size={13} strokeWidth={2} />
                <span>Rename board</span>
              </button>
            )}
            {board.type !== 'clock' && board.type !== 'weather' && (board.displayMode || defaultDisplayMode) === 'default' && (
              <button
                className="td-link-context-item"
                type="button"
                onClick={() => {
                  toggleBoardHeader(workspaceId, board.id);
                  setBoardContextMenu(null);
                }}
              >
                {board.hideHeader ? <Eye size={13} strokeWidth={2} /> : <EyeOff size={13} strokeWidth={2} />}
                <span>{board.hideHeader ? 'Show header' : 'Hide header'}</span>
              </button>
            )}
            {/* Display mode options — only for link boards */}
            {(!board.type || board.type === 'links') && (
              <>
                <div className="td-context-divider" />
                <div className="td-context-section-label">Display</div>
                {([
                  ['default', 'List', LayoutGrid],
                  ['icons-vertical', 'Icons vertical', GripVertical],
                  ['icons-horizontal', 'Icons horizontal', Columns],
                  ['icons-floating', 'Speed dial', Maximize2],
                ] as const).map(([mode, label, Icon]) => (
                  <button
                    key={mode}
                    className={`td-link-context-item ${(board.displayMode || defaultDisplayMode) === mode ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => {
                      setBoardDisplayMode(workspaceId, board.id, mode);
                      setBoardContextMenu(null);
                    }}
                  >
                    <Icon size={13} strokeWidth={2} />
                    <span>{label}</span>
                  </button>
                ))}
                {(board.displayMode || defaultDisplayMode) !== 'default' && (
                  <>
                    <div className="td-context-divider" />
                    <div className="td-context-section-label">Icon size</div>
                    <div className="td-settings-row" style={{ padding: '2px 8px 4px', gap: '3px' }}>
                      {([12, 24, 36, 48] as const).map((sz) => (
                        <button
                          key={sz}
                          className={`td-settings-pill ${(board.iconSize || defaultIconSize) === sz ? 'is-active' : ''}`}
                          type="button"
                          style={{ fontSize: '9px', padding: '3px 0' }}
                          onClick={() => {
                            setBoardIconSize(workspaceId, board.id, sz);
                            setBoardContextMenu(null);
                          }}
                        >
                          {sz}px
                        </button>
                      ))}
                    </div>
                    {((board.displayMode || defaultDisplayMode) === 'icons-horizontal' || (board.displayMode || defaultDisplayMode) === 'icons-floating') && (
                      <button
                        className={`td-link-context-item ${(board.showSections ?? defaultShowSections) ? 'is-active' : ''}`}
                        type="button"
                        onClick={() => {
                          setBoardSections(workspaceId, board.id, !(board.showSections ?? defaultShowSections));
                          setBoardContextMenu(null);
                        }}
                      >
                        <Columns size={13} strokeWidth={2} />
                        <span>Sections</span>
                      </button>
                    )}
                  </>
                )}
              </>
            )}
            <div className="td-context-divider" />
            <div className="td-context-section-label">Color</div>
            <div className="td-board-color-picks">
              {['', 'clear', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'].map((c) => (
                <button
                  key={c}
                  className={`td-board-color-dot ${board.color === c || (!board.color && c === '') ? 'is-active' : ''}`}
                  type="button"
                  style={{ background: c === 'clear' ? 'linear-gradient(135deg, rgba(255,255,255,0.3), rgba(255,255,255,0.1))' : c || 'rgba(250,248,244,0.92)', border: c === 'clear' ? '2px dashed rgba(255,255,255,0.5)' : undefined }}
                  onClick={() => {
                    setBoardColor(workspaceId, board.id, c || undefined);
                    setBoardContextMenu(null);
                  }}
                  title={c || 'Default'}
                />
              ))}
            </div>
            {board.type !== 'volt' && (
              <button
                className="td-link-context-item"
                type="button"
                onClick={handleDuplicate}
              >
                <Copy size={13} strokeWidth={2} />
                <span>Duplicate board</span>
              </button>
            )}
            {(!board.type || board.type === 'links') && board.links.length > 0 && (
              <button
                className="td-link-context-item"
                type="button"
                onClick={handleOpenAll}
              >
                <ExternalLink size={13} strokeWidth={2} />
                <span>Open all ({board.links.length})</span>
              </button>
            )}
            {otherWorkspaces.length > 0 && (
              <>
                <div className="td-context-divider" />
                {otherWorkspaces.map((ws) => (
                  <button
                    key={ws.id}
                    className="td-link-context-item"
                    type="button"
                    onClick={() => handleTransfer(ws.id)}
                  >
                    <ArrowRightLeft size={13} strokeWidth={2} />
                    <span>Transfer to {ws.name}</span>
                  </button>
                ))}
              </>
            )}
            <div className="td-context-divider" />
            <button
              className="td-link-context-item td-link-context-delete"
              type="button"
              onClick={handleDeleteBoard}
            >
              <Trash2 size={13} strokeWidth={2} />
              <span>Delete board</span>
            </button>
          </div>,
          document.body
        )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// VOLT config popover
//
// Split into its own component because it needs local async state for the
// quick-send recipient picker (searched against VOLT's profiles table and
// persisted to chrome.storage.local so the background "Send to VOLT" context
// menu can read it).
// ---------------------------------------------------------------------------
function VoltConfigPopover({
  popRef,
  pos,
  workspaceId,
  board,
  setVoltConfig,
}: {
  popRef: React.RefObject<HTMLDivElement | null>;
  pos: { top: number; left: number };
  workspaceId: string;
  board: BoardItem;
  setVoltConfig: (workspaceId: string, boardId: string, config: import('../../lib/workspaceTypes').VoltConfig) => void;
}) {
  const authState = useVoltStore((s) => s.authState);
  const searchUsers = useVoltStore((s) => s.searchUsers);
  const setQuickRecipient = useVoltStore((s) => s.setQuickRecipient);
  const getQuickRecipient = useVoltStore((s) => s.getQuickRecipient);

  const [recipientLabel, setRecipientLabel] = useState('');

  // Load the saved recipient once when the popover opens
  useEffect(() => {
    let active = true;
    getQuickRecipient().then((r) => {
      if (active && r) setRecipientLabel(`@${r.username}`);
    });
    return () => { active = false; };
  }, [getQuickRecipient]);

  return (
    <div
      ref={popRef}
      className="f-widget-config-pop"
      style={{ position: 'fixed', top: pos.top, left: pos.left }}
    >
      <div className="f-wc-row">
        <span className="f-wc-label">Items to show</span>
        <input
          type="number"
          min={1}
          max={20}
          className="f-wc-input f-wc-input--sm"
          defaultValue={board.voltConfig?.maxItems ?? 5}
          onBlur={(e) => setVoltConfig(workspaceId, board.id, { maxItems: Math.min(20, Math.max(1, Number(e.target.value) || 5)) })}
        />
      </div>
      <div className="f-wc-row">
        <span className="f-wc-label">Show sender</span>
        <button
          type="button"
          className={`f-toggle ${(board.voltConfig?.showSender ?? true) ? 'is-on' : ''}`}
          onClick={() => setVoltConfig(workspaceId, board.id, { showSender: !(board.voltConfig?.showSender ?? true) })}
          aria-label="Toggle sender"
        ><span className="f-toggle-knob" /></button>
      </div>
      <div className="f-wc-row">
        <span className="f-wc-label">Timestamps</span>
        <button
          type="button"
          className={`f-toggle ${(board.voltConfig?.showTimestamps ?? true) ? 'is-on' : ''}`}
          onClick={() => setVoltConfig(workspaceId, board.id, { showTimestamps: !(board.voltConfig?.showTimestamps ?? true) })}
          aria-label="Toggle timestamps"
        ><span className="f-toggle-knob" /></button>
      </div>

      <div className="td-context-divider" style={{ margin: '6px 0' }} />
      <div className="f-wc-label" style={{ marginBottom: 4 }}>Content types</div>
      {([
        ['showText', 'Text'] as const,
        ['showLinks', 'Links'] as const,
        ['showImages', 'Images'] as const,
        ['showFiles', 'Files'] as const,
      ]).map(([key, label]) => (
        <div key={key} className="f-wc-row">
          <span className="f-wc-label">{label}</span>
          <button
            type="button"
            className={`f-toggle ${(board.voltConfig?.[key] ?? true) ? 'is-on' : ''}`}
            onClick={() => setVoltConfig(workspaceId, board.id, { [key]: !(board.voltConfig?.[key] ?? true) })}
            aria-label={`Toggle ${label}`}
          ><span className="f-toggle-knob" /></button>
        </div>
      ))}

      <div className="td-context-divider" style={{ margin: '6px 0' }} />
      <div className="f-wc-row f-wc-row--stack">
        <span className="f-wc-label">Quick-send contact</span>
        {authState === 'authenticated' ? (
          <>
            <Autocomplete
              initialText={recipientLabel}
              placeholder="Search VOLT username"
              getOptions={async (q) => {
                const users = await searchUsers(q);
                return users.map((u) => ({
                  value: u.id,
                  label: `@${u.username}`,
                  sublabel: u.display_name ?? undefined,
                }));
              }}
              onSelect={(opt) => {
                const username = opt.label.replace(/^@/, '');
                setQuickRecipient({ id: opt.value, username, display_name: null, avatar_url: null });
                setRecipientLabel(opt.label);
              }}
            />
            <div className="f-wc-hint">Right-click any page, link, or text → “Send to VOLT” sends it here.</div>
          </>
        ) : (
          <div className="f-wc-hint">Connect your VOLT account to set a quick-send contact.</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar config popover
//
// Split out because the Google connect/disconnect flow is async and needs its
// own local state. Options: shared vs per-widget events, week start, month
// grid toggle, and the Google Calendar connect/disconnect controls.
// ---------------------------------------------------------------------------
function CalendarConfigPopover({
  popRef,
  pos,
  workspaceId,
  board,
  setCalendarConfig,
}: {
  popRef: React.RefObject<HTMLDivElement | null>;
  pos: { top: number; left: number };
  workspaceId: string;
  board: BoardItem;
  setCalendarConfig: (workspaceId: string, boardId: string, config: import('../../lib/workspaceTypes').CalendarConfig) => void;
}) {
  const cfg = board.calendarConfig ?? {};
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError(null);
    const result = await connectGoogleCalendar();
    setConnecting(false);
    if (result.ok) {
      setCalendarConfig(workspaceId, board.id, { googleConnected: true });
    } else {
      setConnectError(result.error ? `Could not connect: ${result.error}` : 'Could not connect.');
    }
  };

  const handleDisconnect = async () => {
    await disconnectGoogleCalendar();
    setCalendarConfig(workspaceId, board.id, { googleConnected: false });
  };

  return (
    <div
      ref={popRef}
      className="f-widget-config-pop"
      style={{ position: 'fixed', top: pos.top, left: pos.left }}
    >
      <div className="f-wc-row">
        <span className="f-wc-label">Shared across workspace</span>
        <button
          type="button"
          className={`f-toggle ${cfg.sharedCalendar ? 'is-on' : ''}`}
          onClick={() => setCalendarConfig(workspaceId, board.id, { sharedCalendar: !cfg.sharedCalendar })}
          aria-label="Toggle shared calendar"
        ><span className="f-toggle-knob" /></button>
      </div>
      <div className="f-wc-hint">
        {cfg.sharedCalendar
          ? 'Events are shared by every calendar in this workspace.'
          : 'Events belong to this calendar widget only.'}
      </div>

      <div className="f-wc-row">
        <span className="f-wc-label">Week starts</span>
        <div className="f-pill-group">
          <button type="button" className={`f-pill ${(cfg.weekStart ?? 0) === 0 ? 'is-active' : ''}`} onClick={() => setCalendarConfig(workspaceId, board.id, { weekStart: 0 })}>Sun</button>
          <button type="button" className={`f-pill ${cfg.weekStart === 1 ? 'is-active' : ''}`} onClick={() => setCalendarConfig(workspaceId, board.id, { weekStart: 1 })}>Mon</button>
        </div>
      </div>

      <div className="f-wc-row">
        <span className="f-wc-label">Week view</span>
        <button
          type="button"
          className={`f-toggle ${cfg.weekView ? 'is-on' : ''}`}
          onClick={() => setCalendarConfig(workspaceId, board.id, { weekView: !cfg.weekView })}
          aria-label="Toggle week view"
        ><span className="f-toggle-knob" /></button>
      </div>
      <div className="f-wc-hint">
        {cfg.weekView
          ? 'Showing the current week. Widen the widget to see this week’s events beside it.'
          : 'Showing the full month. Widen the widget to see this month’s events beside it.'}
      </div>

      <div className="td-context-divider" style={{ margin: '6px 0' }} />
      <div className="f-wc-label" style={{ marginBottom: 4 }}>Google Calendar</div>
      {cfg.googleConnected ? (
        <>
          <div className="f-wc-hint" style={{ color: 'var(--f-success, #16a34a)' }}>Connected ✓ — events sync automatically.</div>
          <button type="button" className="f-wc-cancel" onClick={handleDisconnect} style={{ marginTop: 6 }}>Disconnect</button>
        </>
      ) : (
        <>
          <button type="button" className="f-wc-save" onClick={handleConnect} disabled={connecting} style={{ marginTop: 2 }}>
            {connecting ? 'Connecting…' : 'Connect Google Calendar'}
          </button>
          {connectError && <div className="f-wc-hint" style={{ color: 'var(--f-destructive, #dc2626)', marginTop: 4 }}>{connectError}</div>}
        </>
      )}
    </div>
  );
}
