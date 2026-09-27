import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import RGL from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { CheckSquare, Clock as ClockIcon, CloudSun, LayoutGrid, Plus, Search, StickyNote, LayoutTemplate, Bookmark, Timer as TimerIcon, Rss as RssIcon, Zap as ZapIcon, Calendar as CalendarIcon } from 'lucide-react';
import { getStarterTemplateBoards } from '../lib/starterTemplate';
import { Board } from '../components/Board/Board';
import { Toolbar } from '../components/UI/Toolbar';
import { Toast } from '../components/UI/Toast';
import { Onboarding } from '../components/UI/Onboarding';
import { WhatsNew } from '../components/UI/WhatsNew';
import { CommandPalette } from '../components/UI/CommandPalette';
import { SettingsButton, applyFontCSS, applyGlassCSS } from '../components/UI/Settings';
import { useSettingsStore } from '../store/useSettingsStore';
import { pullSettings, subscribeSettings, getLocalTs, setLocalTs } from '../lib/settingsSync';
import { pushBoards, pullBoards, subscribeBoards, getBoardTs, setBoardTs, mergeWithLocalWallpapers } from '../lib/boardSync';
import { WorkspaceTabs } from '../components/UI/WorkspaceTabs';
import { importBookmarkFolder, MAX_BOARDS_PER_WORKSPACE } from '../lib/bookmarkImport';
import { storeVideoBlob, deleteVideoBlob, getVideoBlob } from '../lib/videoStorage';
import { pushState, undo, redo } from '../lib/undoManager';
import { useUiStore } from '../store/useUiStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { useGridDimensions, GRID_STEP, ROWS_PER_LINK } from '../lib/useGridDimensions';
import { getFaviconUrl } from '../lib/favicon';
import { buildSearchUrl } from '../lib/search';
import { saveBackup } from '../lib/backup';
import type { LinkItem } from '../lib/workspaceTypes';
import '../styles/global.css';

// Old grid system constants for migration
const OLD_COLS = 172;

// ─── Grid geometry (12px cells) ───
// A link row and the board header are each 24px = ROWS_PER_LINK cells.
// Height is always derived from content, never stored:
//   h = ROWS_PER_LINK * ((header ? 1 : 0) + linkCount)
// `y` is snapped to even rows so link rows stay aligned between neighbouring
// boards, while `x`/`w` use the full 12px resolution for fine width control.
const DEFAULT_W = 28; // 28 × 12px = 336px
const MIN_W = 8; //  8 × 12px = 96px

const snapEven = (n: number) => Math.max(n - (n % 2), 0);

const getContentH = (linkCount: number, hideHeader?: boolean) => {
  const rows = (hideHeader ? 0 : 1) + Math.max(linkCount, 1);
  return rows * ROWS_PER_LINK;
};

/** Gap between vertically stacked boards (2 grid rows = 24px). */
const VERTICAL_GAP = ROWS_PER_LINK; // 2 rows = 24px

/**
 * Two items share a column if their x ranges overlap.
 */
function xOverlaps(a: { x: number; w: number }, b: { x: number; w: number }) {
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

/**
 * Push-down & overflow compaction.
 *
 * After computing each board's ideal layout position, this function:
 * 1. For every board that has another board directly above it (overlapping x),
 *    ensures the vertical gap between them is preserved when the upper board
 *    grows (boards below shift down).
 * 2. If a board's bottom exceeds `maxRows`, it is relocated to the first free
 *    column that can fit it.
 *
 * This runs once per gridLayout computation (useMemo), so it has no effect on
 * manual drag — RGL's own collision system handles that via preventCollision.
 */
function pushDownAndOverflow(
  items: Array<{ i: string; x: number; y: number; w: number; h: number; minW: number; maxW?: number }>,
  cols: number,
  maxRows: number,
) {
  // Work on a mutable copy
  const layout = items.map((item) => ({ ...item }));

  // Phase 1: Push down overlapping items to maintain gaps
  // Sort by y so we process top-to-bottom
  layout.sort((a, b) => a.y - b.y || a.x - b.x);

  for (let i = 0; i < layout.length; i++) {
    const upper = layout[i];
    for (let j = i + 1; j < layout.length; j++) {
      const lower = layout[j];
      if (!xOverlaps(upper, lower)) continue;

      const requiredY = snapEven(upper.y + upper.h + VERTICAL_GAP);
      if (lower.y < requiredY) {
        lower.y = requiredY;
      }
    }
  }

  // Phase 2: If any board's bottom exceeds maxRows, move it to the next free column
  // Ensure at least 1 grid cell (12px) horizontal gap from neighbouring boards.
  const H_GAP = 1; // 1 grid cell = 12px horizontal spacing

  for (let i = 0; i < layout.length; i++) {
    const item = layout[i];
    if (item.y + item.h <= maxRows) continue;

    // Find a column where this board fits without overlapping others
    let placed = false;
    for (let tryX = 0; tryX + item.w <= cols; tryX += 2) {
      // Check horizontal gap: tryX range must not be within H_GAP of any other board
      let freeY = 0;
      for (const other of layout) {
        if (other.i === item.i) continue;
        // Expanded overlap check: include H_GAP on each side
        const otherLeft = other.x - H_GAP;
        const otherRight = other.x + other.w + H_GAP;
        const itemRight = tryX + item.w;
        if (tryX < otherRight && itemRight > otherLeft) {
          // Vertically overlapping — count this board's bottom as occupied
          const bottom = other.y + other.h + VERTICAL_GAP;
          if (bottom > freeY) freeY = bottom;
        }
      }
      freeY = snapEven(freeY);
      if (freeY + item.h <= maxRows) {
        item.x = tryX;
        item.y = freeY;
        placed = true;
        break;
      }
    }
    // If nothing fits (tiny viewport), just place it at column 0 at the bottom
    if (!placed) {
      item.x = 0;
      // item.y stays — it'll overflow but we can't shrink a board
    }
  }

  return layout;
}

const WORKSPACE_STORE_KEY = 'frontly-workspaces';
const LEGACY_BOARD_STORE_KEY = 'frontly-board-store';
const QUICK_SAVE_BOARD_KEY = 'frontly-quick-save-board-id';

// ─── TabDeck → Frontly one-time migration ───────────────────────────────────
// Old keys used the 'tabdeck-' prefix. Read them once, write under 'frontly-',
// then delete the old keys so the migration never runs again.
const MIGRATION_FLAG_KEY = 'frontly-migrated-from-tabdeck';
async function migrateTabdeckKeys() {
  try {
    const flagResult = await chrome.storage.local.get(MIGRATION_FLAG_KEY);
    if (flagResult[MIGRATION_FLAG_KEY]) return; // already done

    const OLD_KEYS = [
      'tabdeck-workspaces',
      'tabdeck-board-store',
      'tabdeck-quick-save-board-id',
      'tabdeck-last-quick-save-debug',
    ];
    const oldData = await chrome.storage.local.get(OLD_KEYS);

    const toWrite: Record<string, unknown> = { [MIGRATION_FLAG_KEY]: true };

    if (oldData['tabdeck-workspaces'] !== undefined) {
      // Only migrate if no frontly-workspaces exists yet (first install after rename)
      const existing = await chrome.storage.local.get(WORKSPACE_STORE_KEY);
      if (!existing[WORKSPACE_STORE_KEY]) {
        toWrite[WORKSPACE_STORE_KEY] = oldData['tabdeck-workspaces'];
      }
    }
    if (oldData['tabdeck-board-store'] !== undefined) {
      const existing = await chrome.storage.local.get(LEGACY_BOARD_STORE_KEY);
      if (!existing[LEGACY_BOARD_STORE_KEY]) {
        toWrite[LEGACY_BOARD_STORE_KEY] = oldData['tabdeck-board-store'];
      }
    }
    if (oldData['tabdeck-quick-save-board-id'] !== undefined) {
      const existing = await chrome.storage.local.get(QUICK_SAVE_BOARD_KEY);
      if (!existing[QUICK_SAVE_BOARD_KEY]) {
        toWrite[QUICK_SAVE_BOARD_KEY] = oldData['tabdeck-quick-save-board-id'];
      }
    }

    await chrome.storage.local.set(toWrite);
    await chrome.storage.local.remove(OLD_KEYS);
  } catch {
    // Non-fatal — the app still loads with fresh state if this fails
  }
}

// Migrate localStorage settings key (tabdeck-settings → frontly-settings)
function migrateLocalStorageSettings() {
  try {
    const FRONTLY_KEY = 'frontly-settings';
    const TABDECK_KEY = 'tabdeck-settings';
    if (localStorage.getItem(FRONTLY_KEY)) return; // already has frontly key
    const old = localStorage.getItem(TABDECK_KEY);
    if (old) {
      localStorage.setItem(FRONTLY_KEY, old);
      localStorage.removeItem(TABDECK_KEY);
    }
    // Also migrate onboarding flag
    if (!localStorage.getItem('frontly-onboarding-done') && localStorage.getItem('tabdeck-onboarding-done')) {
      localStorage.setItem('frontly-onboarding-done', '1');
      localStorage.removeItem('tabdeck-onboarding-done');
    }
  } catch {
    // Non-fatal
  }
}

// Run migrations synchronously (localStorage) and async (chromeStorage) at module level
migrateLocalStorageSettings();

type ImportedSavedLink = {
  id?: string;
  title?: string;
  url?: string;
  favicon?: string;
  createdAt?: number;
  updatedAt?: number;
};

type ImportedSavedBoard = {
  id?: string;
  name?: string;
  color?: string;
  links?: ImportedSavedLink[];
  createdAt?: number;
  updatedAt?: number;
};

type ImportedSavedBoardStore = {
  state?: {
    boards?: ImportedSavedBoard[];
  };
};

function storageSet(items: Record<string, unknown>) {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function storageGet(keys: string[]) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result as Record<string, unknown>);
    });
  });
}

function storageGetAll() {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    chrome.storage.local.get(null, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result as Record<string, unknown>);
    });
  });
}

function normalizeImportedBoardStore(raw: unknown): ImportedSavedBoardStore | null {
  if (!raw) return null;

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as ImportedSavedBoardStore;
    } catch {
      return null;
    }
  }

  if (typeof raw === 'object') {
    return raw as ImportedSavedBoardStore;
  }

  return null;
}

function getBookmarkSubTree(id: string) {
  return new Promise<chrome.bookmarks.BookmarkTreeNode[]>((resolve, reject) => {
    chrome.bookmarks.getSubTree(id, (nodes) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(nodes);
    });
  });
}

export function NewTab() {
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    addWorkspace,
    renameWorkspace,
    removeWorkspace,
    addBoard,
    importBoard,
    updateBoardLayouts,
    moveLink,
    setWorkspaceWallpaper,
    setVideoWallpaper,
    setWorkspaceLiveWallpaper,
    getActiveWorkspace,
  } = useWorkspaceStore();

  const activeWorkspace = getActiveWorkspace();
  const { showToast } = useUiStore();
  const [search, setSearch] = useState('');
  const [quickSaveBoardId, setQuickSaveBoardId] = useState('');
  const [layoutLocked, setLayoutLocked] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('frontly-onboarding-done');
  });
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const commandOpenRef = useRef(false);
  const [activeDragLink, setActiveDragLink] = useState<LinkItem | null>(null);
  const [boardDragging, setBoardDragging] = useState(false);
  const appSettings = useSettingsStore();
  const grid = useGridDimensions();

  // Run chrome.storage migration once on mount (localStorage migration is synchronous at module level)
  useEffect(() => { migrateTabdeckKeys(); }, []);

  // Settings sync (phase A): pull newer settings from chrome.storage.sync on
  // mount, then stay in step with other signed-in desktop Chrome instances.
  useEffect(() => {
    let active = true;
    pullSettings().then((remote) => {
      if (!active || !remote) return;
      // Apply only if the remote copy is newer than what this device last applied.
      if (remote._ts > getLocalTs()) {
        setLocalTs(remote._ts);
        useSettingsStore.getState().hydrateFromSync(remote.settings);
      }
    });

    const unsubscribe = subscribeSettings((settings) => {
      useSettingsStore.getState().hydrateFromSync(settings);
    });

    return () => { active = false; unsubscribe(); };
  }, []);

  // Board sync (phase B): opt-in via appSettings.syncBoards. When enabled:
  //  - pull newer board data from sync on mount / when toggled on,
  //  - push local changes (debounced) so other devices converge,
  //  - apply remote changes live, preserving this device's local wallpapers.
  useEffect(() => {
    if (!appSettings.syncBoards) return;
    let active = true;

    // Guards against the pull→replaceAll→subscribe→push echo: while we are
    // applying data received from another device, suppress the outgoing push.
    let applyingRemote = false;

    const applyRemote = async () => {
      const remote = await pullBoards();
      if (!active || !remote) return;
      if (remote._ts > getBoardTs()) {
        setBoardTs(remote._ts);
        const local = useWorkspaceStore.getState().workspaces;
        const merged = mergeWithLocalWallpapers(remote.data.workspaces, local);
        applyingRemote = true;
        useWorkspaceStore.getState().replaceAll(merged, remote.data.activeWorkspaceId);
        // Release the guard after the synchronous subscribers have run.
        setTimeout(() => { applyingRemote = false; }, 0);
      }
    };

    // Initial pull
    applyRemote();

    // Live remote updates
    const unsubRemote = subscribeBoards(() => { applyRemote(); });

    // Debounced push on local changes
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    let warnedTooLarge = false;
    const unsubLocal = useWorkspaceStore.subscribe((state) => {
      if (applyingRemote) return; // change came from a remote pull — don't echo it back
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(async () => {
        const result = await pushBoards(state.workspaces, state.activeWorkspaceId);
        if (result.ok) {
          warnedTooLarge = false;
        } else if (result.reason === 'too-large' && !warnedTooLarge) {
          warnedTooLarge = true; // warn once per size overflow, not on every edit
          showToast('Boards too large to sync — kept on this device only', 'error');
        }
      }, 1200);
    });

    return () => {
      active = false;
      if (pushTimer) clearTimeout(pushTimer);
      unsubRemote();
      unsubLocal();
    };
  }, [appSettings.syncBoards]);

  // Mirror commandOpen into a ref so the global keyboard handler (empty-dep effect)
  // can read the latest value without re-subscribing.
  useEffect(() => { commandOpenRef.current = commandOpen; }, [commandOpen]);

  // Apply all CSS settings on mount and whenever they change
  useEffect(() => {
    applyFontCSS(appSettings.fontFamily, appSettings.fontSize);
    applyGlassCSS(
      appSettings.glassBlur, appSettings.glassSaturation, appSettings.glassTint,
      appSettings.toolbarBlur, appSettings.toolbarSaturation, appSettings.toolbarTint,
      appSettings.toolbarOpacity, appSettings.toolbarRadius, appSettings.toolbarGrain,
      appSettings.toolbarColor, appSettings.toolbarTextColor, appSettings.miscTextColor
    );
  }, [
    appSettings.fontFamily,
    appSettings.fontSize,
    appSettings.glassBlur,
    appSettings.glassSaturation,
    appSettings.glassTint,
    appSettings.toolbarBlur,
    appSettings.toolbarSaturation,
    appSettings.toolbarTint,
    appSettings.toolbarOpacity,
    appSettings.toolbarRadius,
    appSettings.toolbarGrain,
    appSettings.toolbarColor,
    appSettings.toolbarTextColor,
    appSettings.miscTextColor,
  ]);

  // Auto-close toolbar timer
  useEffect(() => {
    if (!appSettings.autoCloseToolbar || !toolbarOpen) return;
    const timer = setTimeout(() => setToolbarOpen(false), appSettings.autoCloseToolbar * 1000);
    return () => clearTimeout(timer);
  }, [toolbarOpen, appSettings.autoCloseToolbar]);

  // Auto-lock layout timer
  useEffect(() => {
    if (!appSettings.autoLock) return;
    const timer = setTimeout(() => setLayoutLocked(true), appSettings.autoLock * 1000);
    const reset = () => clearTimeout(timer);
    // Reset on any interaction
    document.addEventListener('mousedown', reset, { once: true });
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', reset); };
  }, [layoutLocked, appSettings.autoLock]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  // Keyboard shortcuts + zoom prevention
  useEffect(() => {
    const state = useWorkspaceStore.getState();
    pushState({ workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId });

    const unsub = useWorkspaceStore.subscribe((state) => {
      pushState({ workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId });
      // Keep a rolling local safety-net snapshot (debounced inside saveBackup).
      saveBackup(state.workspaces, state.activeWorkspaceId);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const alt = e.altKey;

      // While the command palette is open, let it own the keyboard.
      // Only Ctrl+K (toggle/close) and Escape reach here; everything else is
      // handled inside the palette and must not mutate the workspace behind it.
      if (commandOpenRef.current) {
        if (ctrl && !alt && !e.shiftKey && e.code === 'KeyK') {
          e.preventDefault();
          setCommandOpen(false);
        }
        return;
      }

      // Prevent zoom
      if (ctrl && !alt && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
      }

      // Ctrl+Z — undo
      if (ctrl && !alt && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault();
        const prev = undo() as any;
        if (prev) useWorkspaceStore.setState({ workspaces: prev.workspaces, activeWorkspaceId: prev.activeWorkspaceId });
      }

      // Ctrl+Y — redo
      if (ctrl && !alt && !e.shiftKey && e.code === 'KeyY') {
        e.preventDefault();
        const next = redo() as any;
        if (next) useWorkspaceStore.setState({ workspaces: next.workspaces, activeWorkspaceId: next.activeWorkspaceId });
      }

      // Ctrl+B — new bookmark board
      if (ctrl && !alt && !e.shiftKey && e.code === 'KeyB') {
        e.preventDefault();
        const ws = useWorkspaceStore.getState().getActiveWorkspace();
        if (ws && ws.boards.length < MAX_BOARDS_PER_WORKSPACE) useWorkspaceStore.getState().addBoard(ws.id);
      }

      // Ctrl+M — toggle toolbar
      if (ctrl && !alt && e.code === 'KeyM') {
        e.preventDefault();
        setToolbarOpen((v) => !v);
      }

      // Ctrl+K — command palette
      if (ctrl && !alt && !e.shiftKey && e.code === 'KeyK') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }

      // Alt+1..9 — open the Nth link on any Speed dial / icon-mode board
      // (data-speeddial-index is set on those links in Board.tsx).
      if (alt && !ctrl && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        const n = e.code.slice(5);
        const el = document.querySelector(`[data-speeddial-index="${n}"]`) as HTMLAnchorElement | null;
        if (el) { e.preventDefault(); el.click(); }
        return;
      }

      // Alt shortcuts (work regardless of toolbar state)
      if (alt && !ctrl && !e.shiftKey) {
        const ws = useWorkspaceStore.getState().getActiveWorkspace();
        const canAdd = ws && ws.boards.length < MAX_BOARDS_PER_WORKSPACE;

        switch (e.code) {
          case 'KeyN': // Note
            e.preventDefault();
            if (canAdd && ws) useWorkspaceStore.getState().addNoteBoard(ws.id);
            break;
          case 'KeyW': // Weather
            e.preventDefault();
            if (canAdd && ws) {
              useWorkspaceStore.getState().addBoard(ws.id, 'Weather');
              setTimeout(() => {
                const s = useWorkspaceStore.getState();
                const w = s.getActiveWorkspace();
                const last = w?.boards[w.boards.length - 1];
                if (last?.name === 'Weather') {
                  useWorkspaceStore.setState((st) => ({
                    workspaces: st.workspaces.map((wk) =>
                      wk.id === ws.id ? { ...wk, boards: wk.boards.map((b) => b.id === last.id ? { ...b, type: 'weather' as const } : b) } : wk
                    ),
                  }));
                }
              }, 50);
            }
            break;
          case 'KeyT': // Todo
            e.preventDefault();
            if (canAdd && ws) useWorkspaceStore.getState().addTodoBoard(ws.id);
            break;
          case 'KeyC': // Clock
            e.preventDefault();
            if (canAdd && ws) useWorkspaceStore.getState().addClockBoard(ws.id);
            break;
          case 'KeyL': // Lock/unlock
            e.preventDefault();
            setLayoutLocked((v) => !v);
            break;
          case 'KeyS': // Focus search
            e.preventDefault();
            (document.querySelector('.td-search-input') as HTMLInputElement)?.focus();
            break;
          case 'KeyE': // Export JSON
            e.preventDefault();
            handleExport();
            break;
          case 'KeyI': // Import JSON
            e.preventDefault();
            (document.querySelector('input[accept="application/json"]') as HTMLInputElement)?.click();
            break;
          case 'KeyP': // Wallpaper
            e.preventDefault();
            (document.querySelector('input[accept="image/*,video/mp4,video/webm"]') as HTMLInputElement)?.click();
            break;
          case 'KeyX': // Wipe everything
            e.preventDefault();
            if (confirm('Clear ALL boards, links, and wallpapers from this workspace? Cannot be undone.')) {
              const wsId = useWorkspaceStore.getState().activeWorkspaceId;
              useWorkspaceStore.setState((s) => ({
                workspaces: s.workspaces.map((w) =>
                  w.id === wsId ? { ...w, boards: [], wallpaper: null, videoWallpaper: null, updatedAt: Date.now() } : w
                ),
              }));
              showToast('Workspace cleared', 'info');
            }
            break;
        }
        return;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      unsub();
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('wheel', handleWheel);
    };
  }, []);

  useEffect(() => {
    storageGet([QUICK_SAVE_BOARD_KEY])
      .then((result) => {
        if (typeof result[QUICK_SAVE_BOARD_KEY] === 'string') {
          setQuickSaveBoardId(result[QUICK_SAVE_BOARD_KEY] as string);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeWorkspace) return;

    const effectiveQuickSaveBoardId =
      quickSaveBoardId || activeWorkspace.boards[0]?.id || '';

    if (!effectiveQuickSaveBoardId) return;

    storageSet({
      [QUICK_SAVE_BOARD_KEY]: effectiveQuickSaveBoardId,
    }).catch(() => {});
  }, [quickSaveBoardId, activeWorkspace]);

  useEffect(() => {
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'local') return;

      const next = changes[QUICK_SAVE_BOARD_KEY]?.newValue;
      if (typeof next === 'string') {
        setQuickSaveBoardId(next);
      }
    };

    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  const visibleBoards = useMemo(() => {
    if (!activeWorkspace) return [];

    const query = search.trim().toLowerCase();
    if (!query) return activeWorkspace.boards;

    return activeWorkspace.boards
      .map((board) => {
        const boardMatch = board.name.toLowerCase().includes(query);
        if (boardMatch) return board;

        const filteredLinks = board.links.filter(
          (link) =>
            link.title.toLowerCase().includes(query) ||
            link.url.toLowerCase().includes(query)
        );

        return {
          ...board,
          links: filteredLinks,
        };
      })
      .filter(
        (board) =>
          // Widgets (no links) always show; link boards show if name or links match
          board.type === 'note' || board.type === 'todo' || board.type === 'clock' || board.type === 'weather' ||
          board.type === 'timer' || board.type === 'rss' || board.type === 'volt' || board.type === 'calendar' ||
          board.name.toLowerCase().includes(query) || board.links.length > 0
      );
  }, [activeWorkspace, search]);

  const findBoardIdByLinkId = (linkId: string) => {
    return activeWorkspace?.boards.find((board) =>
      board.links.some((link) => link.id === linkId)
    )?.id;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const link = activeWorkspace?.boards
      .flatMap((b) => b.links)
      .find((l) => l.id === id);
    setActiveDragLink(link ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragLink(null);
    if (!activeWorkspace) return;

    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId === overId) return;

    // Find which board the dragged link belongs to
    const fromBoardId = findBoardIdByLinkId(activeId);
    if (!fromBoardId) return;

    // Determine the target board
    let toBoardId: string | undefined;
    if (overId.startsWith('board-drop-')) {
      toBoardId = overId.replace('board-drop-', '');
    } else {
      toBoardId = findBoardIdByLinkId(overId);
    }

    if (!toBoardId) return;

    // Same board — reorder
    if (fromBoardId === toBoardId) {
      const board = activeWorkspace.boards.find((b) => b.id === fromBoardId);
      if (!board) return;
      const fromIndex = board.links.findIndex((l) => l.id === activeId);
      const toIndex = board.links.findIndex((l) => l.id === overId);
      if (fromIndex !== -1 && toIndex !== -1) {
        useWorkspaceStore.getState().reorderLinks(activeWorkspace.id, fromBoardId, fromIndex, toIndex);
      }
      return;
    }

    // Different board — move
    moveLink(activeWorkspace.id, activeId, overId, fromBoardId, toBoardId);
  };

  // Compute grid layout — memoised so RGL only receives a new array reference
  // when something that actually affects positions changes.
  // KEY PRINCIPLE: boards that have a saved layout are placed EXACTLY at their
  // saved coordinates. pushDownAndOverflow only runs for boards with NO saved
  // layout (initial placement). This prevents the controller→RGL→onDragStop
  // feedback loop from silently shifting untouched boards.
  const gridLayout = useMemo(() => {
    if (!activeWorkspace) return [];

    const iconWidthOverride = new Map<string, number>();
    // Widget heights must grow with the font-size setting, otherwise larger
    // text clips inside a fixed-height panel. fscale mirrors --f-scale.
    const fscale = Math.max(appSettings.fontSize / 10, 1);
    // Round a pixel height up to whole grid cells (GRID_STEP px each).
    const cellsFor = (px: number) => Math.ceil(px / GRID_STEP);

    // Per-widget width bounds (grid cells). minW stops content from clipping;
    // maxW caps how wide a widget can be dragged so it never looks stretched.
    const widthBounds = new Map<string, { min: number; max?: number }>();

    // ── Step 1: compute height + icon-width overrides for every board ──
    const rawLayout = visibleBoards.map((board, index) => {
      // NOTE: the panel itself adds ~26px vertical padding, so these budgets
      // cover ONLY the inner content and are kept tight to avoid dead space.
      let contentH: number;
      if (board.type === 'clock') {
        // Time line + period + optional date line; generous so nothing clips.
        contentH = cellsFor((board.clockConfig?.showDate ?? true ? 96 : 58) * fscale);
        // Wide enough for "16:39:56" at the display font without clipping.
        widthBounds.set(board.id, { min: 20 });
      } else if (board.type === 'weather') {
        // Current block (temp + desc/feels/city). The 3-day forecast row only
        // appears at wider sizes and shares this height; keep it snug.
        contentH = cellsFor(94 * fscale);
        // min = today-only (compact), max = full 3-day layout. The widget's own
        // ResizeObserver reveals 0→3 forecast days across this width range.
        widthBounds.set(board.id, { min: 13, max: 40 });
      } else if (board.type === 'timer') {
        // Header (24px) + phase label + clock + control buttons (~78px).
        contentH = ROWS_PER_LINK + cellsFor(78 * fscale);
        widthBounds.set(board.id, { min: 16 });
      } else if (board.type === 'rss') {
        // Header + up to 4 headline rows shown by default (~28px each); more
        // than 4 scroll internally, so height is capped at 4.
        const count = Math.max(board.rssConfig?.count ?? 6, 1);
        contentH = ROWS_PER_LINK + cellsFor(Math.min(count, 4) * 28 * fscale);
        widthBounds.set(board.id, { min: 18 });
      } else if (board.type === 'volt') {
        // VOLT widget height must fit BOTH states without clipping:
        //  - signed out: sign-in form (header + subtitle + 2 inputs + button
        //    + gaps) ≈ 200px
        //  - signed in: header (~24px) + up to 2 item rows (~58px each)
        // The store can't see auth state, so budget for the taller of the two.
        const maxItems = board.voltConfig?.maxItems ?? 5;
        const listBudget = 24 + Math.min(maxItems, 2) * 58;
        const signinBudget = 200;
        contentH = cellsFor(Math.max(listBudget, signinBudget) * fscale);
        // Wide enough to read sender + content + actions comfortably.
        widthBounds.set(board.id, { min: 20 });
      } else if (board.type === 'calendar') {
        // Height is content-driven by the view mode (config), NOT drag-resized:
        //  - week view  → toolbar + weekday row + one week row  (~compact)
        //  - month view → toolbar + weekday row + up to 6 week rows
        const weekView = board.calendarConfig?.weekView ?? false;
        const gridPx = weekView ? 74 : 190;
        contentH = cellsFor((26 + gridPx) * fscale);
        // Min width fits a comfortable grid. Max caps at the split layout
        // width (grid + upcoming-events column) so it can't overstretch.
        widthBounds.set(board.id, { min: 22, max: 40 });
      } else if (board.type === 'note') {
        const lineCount = Math.max((board.noteContent || '').split('\n').length, 2);
        const headerRows = board.hideHeader ? 0 : ROWS_PER_LINK;
        const textPx = lineCount * 15 + 12;
        const textRows = Math.ceil(textPx / 12);
        contentH = headerRows + textRows;
      } else if (board.type === 'todo') {
        const todoCount = (board.todos || []).length;
        const headerRows = board.hideHeader ? 0 : ROWS_PER_LINK;
        contentH = headerRows + Math.max(todoCount, 1) * ROWS_PER_LINK + ROWS_PER_LINK;
      } else {
        const mode = board.displayMode || appSettings.defaultDisplayMode;
        const iconSz = board.iconSize || appSettings.defaultIconSize;
        const linkCount = Math.max(board.links.length, 1);

        if (mode === 'icons-vertical') {
          const stripW = Math.ceil((iconSz + 8) / 12);
          const stripH = Math.ceil((linkCount * (iconSz + 4) + 4) / 12);
          contentH = stripH;
          iconWidthOverride.set(board.id, Math.max(stripW, 2));
        } else if (mode === 'icons-horizontal' || mode === 'icons-floating') {
          const sections = board.showSections ?? appSettings.defaultShowSections;
          const iconSlotW = iconSz + (sections ? 5 : 4);
          const totalPx = (linkCount * iconSlotW) + 8;
          const stripH = Math.ceil((iconSz + 8) / 12);
          contentH = Math.max(stripH, 2);
          iconWidthOverride.set(board.id, Math.max(Math.ceil(totalPx / 12), MIN_W));
        } else {
          contentH = getContentH(board.links.length, board.hideHeader);
        }
      }

      // ── Boards WITH a saved layout: use saved x/y/w exactly. ──
      // Only h is derived from content (because content can change without a drag).
      if (board.layout) {
        const savedStep = board.layout.gridStep ?? 24;
        const scale = savedStep / GRID_STEP;

        let x = Math.round(board.layout.x * scale);
        let w = Math.round(board.layout.w * scale);
        let y = Math.round(board.layout.y * scale);

        // Legacy 172-col layouts need width rescaling
        if (w > grid.cols) {
          x = Math.round((x * grid.cols) / OLD_COLS);
          w = Math.round((w * grid.cols) / OLD_COLS);
        }

        w = Math.min(Math.max(w, MIN_W), grid.cols);
        x = Math.max(Math.min(x, grid.cols - w), 0);

        const iconW = iconWidthOverride.get(board.id);
        if (iconW) {
          w = Math.min(iconW, grid.cols);
          x = Math.max(Math.min(x, grid.cols - w), 0);
        }

        y = snapEven(y);

        // Apply per-widget width bounds (clamp saved width into [min, max]).
        const wb = widthBounds.get(board.id);
        if (wb) {
          const maxW = Math.min(wb.max ?? grid.cols, grid.cols);
          w = Math.min(Math.max(w, wb.min), maxW);
          x = Math.max(Math.min(x, grid.cols - w), 0);
        }

        return { i: board.id, x, y, w, h: contentH, minW: wb?.min ?? iconW ?? MIN_W, maxW: wb?.max };
      }

      // ── Boards WITHOUT a saved layout: index-based initial placement. ──
      // These will be saved to the store on the next frame (see useEffect below).
      const iconW = iconWidthOverride.get(board.id);
      const wb = widthBounds.get(board.id);
      const finalW = iconW || (wb ? Math.min(wb.min + 4, wb.max ?? DEFAULT_W) : DEFAULT_W);
      const perRow = Math.max(Math.floor(grid.cols / (finalW + 1)), 1);
      const col = index % perRow;
      const row = Math.floor(index / perRow);
      const x = Math.max(Math.min(col * (finalW + 1), grid.cols - finalW), 0);
      const y = snapEven(row * (contentH + ROWS_PER_LINK));

      return { i: board.id, x, y, w: finalW, h: contentH, minW: wb?.min ?? iconW ?? MIN_W, maxW: wb?.max };
    });

    // ── Step 2: run pushDownAndOverflow on ALL boards for display. ──
    // This ensures that when a board grows (link added), boards below it
    // visually shift down to maintain the 24px gap and wrap to the next
    // column if they'd overflow the canvas.
    //
    // IMPORTANT: these display-adjusted positions are NOT written back to
    // the store here. Only handleGridLayoutChange (onDragStop/onResizeStop)
    // persists positions — and it only saves the single moved board.
    return pushDownAndOverflow(rawLayout, grid.cols, grid.maxRows);
  }, [
    activeWorkspace,
    visibleBoards,
    grid.cols,
    grid.maxRows,
    appSettings.defaultDisplayMode,
    appSettings.defaultIconSize,
    appSettings.defaultShowSections,
    appSettings.fontSize,
  ]);

  // Save initial placement for any boards that don't have a saved layout yet.
  // Without this they get index-based coordinates that shift whenever the board
  // list changes (add/remove/search).
  useEffect(() => {
    if (!activeWorkspace) return;
    const unsaved = gridLayout.filter((item) => {
      const board = activeWorkspace.boards.find((b) => b.id === item.i);
      return board && !board.layout;
    });
    if (unsaved.length === 0) return;

    updateBoardLayouts(activeWorkspace.id, unsaved.map((item) => ({
      id: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    })));
  // Only run when the workspace changes or boards are added/removed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id, activeWorkspace?.boards.length]);

  // Only persist the single item that was actually moved or resized.
  // RGL passes (layout, oldItem, newItem) — we only need newItem.
  const handleGridLayoutChange = (
    _layout: RGL.Layout[],
    _oldItem: RGL.Layout,
    newItem: RGL.Layout
  ) => {
    if (!activeWorkspace) return;

    updateBoardLayouts(activeWorkspace.id, [{
      id: newItem.i,
      x: newItem.x,
      y: snapEven(newItem.y),
      w: newItem.w,
      h: newItem.h,
    }]);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setSearch(''); return; }
    if (e.key !== 'Enter') return;
    const term = search.trim();
    if (!term) return;
    e.preventDefault();
    const dest = buildSearchUrl(term, appSettings.searchEngine);
    if (appSettings.openLinksNewTab) {
      window.open(dest, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = dest;
    }
  };

const handleImportBookmarks = async (folderId?: string) => {
  if (!activeWorkspace) return;

  if (!folderId || typeof folderId !== 'string') {
    showToast('Select a valid bookmarks folder', 'error');
    return;
  }

  try {
    const nodes = await getBookmarkSubTree(folderId);
    const root = nodes?.[0];

    if (!root) {
      showToast('Bookmarks folder not found', 'error');
      return;
    }

    const { boards, overflow } = importBookmarkFolder(
      root,
      activeWorkspace.boards.length
    );

    if (boards.length === 0 && overflow.length === 0) {
      showToast('No bookmark links found in this folder', 'error');
      return;
    }

    // Import boards into current workspace
    for (const board of boards) {
      importBoard(activeWorkspace.id, board);
    }

    // If overflow, create a new workspace for them
    if (overflow.length > 0) {
      const overflowName = `Overflow (${root.title || 'Import'})`;
      addWorkspace(overflowName);

      // Small delay to let store update, then import overflow boards
      setTimeout(() => {
        const state = useWorkspaceStore.getState();
        const overflowWorkspace = state.workspaces.find(
          (ws) => ws.name === overflowName
        );
        if (overflowWorkspace) {
          for (const board of overflow) {
            state.importBoard(overflowWorkspace.id, board);
          }
        }
      }, 50);

      const totalImported = boards.reduce((sum, b) => sum + b.links.length, 0);
      const totalOverflow = overflow.reduce((sum, b) => sum + b.links.length, 0);
      showToast(
        `${totalImported} bookmarks here, ${totalOverflow} saved to "${overflowName}"`,
        'info'
      );
    } else {
      const totalImported = boards.reduce((sum, b) => sum + b.links.length, 0);
      showToast(`${totalImported} bookmarks imported`, 'success');
    }
  } catch (error) {
    console.error('Bookmarks import failed:', error);
    showToast('Bookmarks import failed', 'error');
  }
};

  const handleExport = async () => {
    try {
      const data = await storageGetAll();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `frontly-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      showToast('Exported', 'success');
    } catch {
      showToast('Export failed', 'error');
    }
  };

  const handleImportBackup = (file?: File) => {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const result = reader.result;
        if (typeof result !== 'string') return;

        const parsed = JSON.parse(result) as Record<string, unknown>;

        // ── Single-workspace file (exported via right-click "Export workspace") ──
        // Shape: a bare WorkspaceItem { id, name, boards: [...] } at top level.
        const looksLikeWorkspace =
          typeof parsed.id === 'string' &&
          typeof parsed.name === 'string' &&
          Array.isArray((parsed as Record<string, unknown>).boards);

        if (looksLikeWorkspace) {
          const ws = parsed as unknown as import('../lib/workspaceTypes').WorkspaceItem;
          // Give it a fresh id so it never collides with an existing workspace,
          // then merge it into the current set and switch to it.
          const freshId = crypto.randomUUID();
          const merged: import('../lib/workspaceTypes').WorkspaceItem = {
            ...ws,
            id: freshId,
            wallpaper: ws.wallpaper ?? null,
            videoWallpaper: null, // video blobs live in IndexedDB, not portable via JSON
            liveWallpaper: ws.liveWallpaper ?? null,
            // Remap all board + link ids so re-importing the same file never
            // creates duplicate ids across workspaces (breaks transfer/undo/drag).
            boards: (Array.isArray(ws.boards) ? ws.boards : []).map((b) => ({
              ...b,
              id: crypto.randomUUID(),
              links: (b.links || []).map((l) => ({ ...l, id: crypto.randomUUID() })),
            })),
            createdAt: ws.createdAt ?? Date.now(),
            updatedAt: Date.now(),
          };
          useWorkspaceStore.setState((s) => ({
            workspaces: [...s.workspaces, merged],
            activeWorkspaceId: freshId,
          }));
          showToast(`Imported workspace "${merged.name}"`, 'success');
          return;
        }

        // ── Full backup file — ask merge vs replace ──
        const existingBackup = parsed[WORKSPACE_STORE_KEY];
        if (existingBackup) {
          const replace = confirm(
            'Import backup:\n\nOK = REPLACE everything with this backup.\nCancel = MERGE its workspaces into your current setup.'
          );
          if (!replace) {
            // Merge: parse the incoming store's workspaces and append them
            try {
              const incoming = typeof existingBackup === 'string'
                ? JSON.parse(existingBackup)
                : existingBackup;
              const incomingWs = incoming?.state?.workspaces;
              if (Array.isArray(incomingWs) && incomingWs.length > 0) {
                const remapped = incomingWs.map((w: import('../lib/workspaceTypes').WorkspaceItem) => ({
                  ...w,
                  id: crypto.randomUUID(),
                  videoWallpaper: null, // video blobs are not carried in a JSON backup
                  boards: (w.boards || []).map((b) => ({
                    ...b,
                    id: crypto.randomUUID(),
                    links: (b.links || []).map((l) => ({ ...l, id: crypto.randomUUID() })),
                  })),
                  updatedAt: Date.now(),
                }));
                const hadVideo = incomingWs.some((w: import('../lib/workspaceTypes').WorkspaceItem) => !!w.videoWallpaper);
                useWorkspaceStore.setState((s) => ({
                  workspaces: [...s.workspaces, ...remapped],
                  activeWorkspaceId: remapped[0].id,
                }));
                showToast(
                  hadVideo
                    ? `Merged ${remapped.length} workspace(s) (video wallpapers not included)`
                    : `Merged ${remapped.length} workspace(s)`,
                  'success'
                );
                return;
              }
            } catch {
              showToast('Invalid backup file', 'error');
              return;
            }
            showToast('No workspaces found to merge', 'error');
            return;
          }
          // replace === true → fall through to full-storage overwrite below
        }

        const alreadyNewStore = parsed[WORKSPACE_STORE_KEY];
        const legacyBoardStore = normalizeImportedBoardStore(
          parsed[LEGACY_BOARD_STORE_KEY]
        );
        const legacyBoards = legacyBoardStore?.state?.boards ?? [];
        const importedQuickSaveBoardId =
          typeof parsed[QUICK_SAVE_BOARD_KEY] === 'string'
            ? (parsed[QUICK_SAVE_BOARD_KEY] as string)
            : '';

        const payloadToWrite: Record<string, unknown> = { ...parsed };

        if (!alreadyNewStore && legacyBoards.length > 0) {
          const now = Date.now();
          const workspaceId = crypto.randomUUID();

          const migratedBoards = legacyBoards.map((board) => ({
            id: String(board.id ?? crypto.randomUUID()),
            name: board.name ?? 'New Board',
            color: board.color ?? '',
            links: Array.isArray(board.links)
              ? board.links
                  .filter((link) => !!link?.url)
                  .map((link) => ({
                    id: String(link.id ?? crypto.randomUUID()),
                    title: link.title ?? link.url ?? 'Untitled',
                    url: link.url ?? '',
                    favicon: link.favicon ?? '',
                    createdAt: link.createdAt ?? now,
                    updatedAt: link.updatedAt ?? now,
                  }))
              : [],
            createdAt: board.createdAt ?? now,
            updatedAt: board.updatedAt ?? now,
          }));

          const migratedStore = {
            state: {
              workspaces: [
                {
                  id: workspaceId,
                  name: 'Home',
                  boards: migratedBoards,
                  wallpaper: null,
                  createdAt: now,
                  updatedAt: now,
                },
              ],
              activeWorkspaceId: workspaceId,
            },
            version: 0,
          };

          payloadToWrite[WORKSPACE_STORE_KEY] = JSON.stringify(migratedStore);

          if (!importedQuickSaveBoardId && migratedBoards[0]?.id) {
            payloadToWrite[QUICK_SAVE_BOARD_KEY] = migratedBoards[0].id;
          }
        }

        await storageSet(payloadToWrite);
        showToast('Imported', 'success');
        setTimeout(() => window.location.reload(), 500);
      } catch {
        showToast('Invalid file', 'error');
      }
    };

    reader.readAsText(file);
  };

  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);

  // Load video wallpaper from IndexedDB on mount/workspace change
  useEffect(() => {
    if (!activeWorkspace?.videoWallpaper) {
      setVideoObjectUrl(null);
      return;
    }

    let url: string | null = null;

    getVideoBlob(activeWorkspace.videoWallpaper)
      .then((blob) => {
        if (blob) {
          url = URL.createObjectURL(blob);
          setVideoObjectUrl(url);
        }
      })
      .catch(() => setVideoObjectUrl(null));

    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [activeWorkspace?.videoWallpaper]);

  const handleWallpaper = async (file?: File) => {
    if (!file || !activeWorkspace) return;

    // Video files → store in IndexedDB + create object URL for immediate playback
    if (file.type.startsWith('video/')) {
      try {
        const videoKey = `video-${activeWorkspace.id}`;
        await storeVideoBlob(videoKey, file);
        setVideoWallpaper(activeWorkspace.id, videoKey);
        // Create immediate object URL for playback
        const url = URL.createObjectURL(file);
        setVideoObjectUrl(url);
        showToast('Video wallpaper applied', 'success');
      } catch (err) {
        console.error('Failed to store video:', err);
        showToast('Failed to apply video wallpaper', 'error');
      }
      return;
    }

    // Image/GIF → store as data URL
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setWorkspaceWallpaper(activeWorkspace.id, result);
        setVideoObjectUrl(null);
        showToast('Wallpaper updated', 'success');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleClearWallpaper = async () => {
    if (!activeWorkspace) return;

    if (!confirm('Clear ALL boards, links, notes, and wallpapers from this workspace? This cannot be undone.')) {
      return;
    }

    if (activeWorkspace.videoWallpaper) {
      await deleteVideoBlob(activeWorkspace.videoWallpaper).catch(() => {});
    }

    setWorkspaceWallpaper(activeWorkspace.id, null);
    setVideoWallpaper(activeWorkspace.id, null);
    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
      setVideoObjectUrl(null);
    }

    // Clear all boards
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === activeWorkspace.id ? { ...w, boards: [], wallpaper: null, videoWallpaper: null, updatedAt: Date.now() } : w
      ),
    }));

    showToast('Workspace cleared', 'info');
  };

  if (!activeWorkspace) return null;

  const hasVideoWallpaper = !!videoObjectUrl;
  const hasLiveWallpaper = !!activeWorkspace.liveWallpaper && !hasVideoWallpaper;
  const wallpaperUrl = (hasVideoWallpaper || hasLiveWallpaper) ? undefined : (activeWorkspace.wallpaper || '/frontly.png');

  return (
    <div
      className={`td-page ${appSettings.textMode === 'light' ? 'td-text-light' : appSettings.textMode === 'dark' ? 'td-text-dark' : ''}`}
      style={
        wallpaperUrl
          ? {
              backgroundImage: `url(${wallpaperUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : { backgroundColor: '#0a0a0a' }
      }
    >
      {hasVideoWallpaper && (
        <video
          className="td-video-wallpaper"
          src={videoObjectUrl}
          autoPlay
          loop
          muted
          playsInline
        />
      )}
      {hasLiveWallpaper && (
        <div className={`td-live-wallpaper td-live-wallpaper--${activeWorkspace.liveWallpaper}`} />
      )}
      <Toast />

      {!showOnboarding && <WhatsNew />}

      {showOnboarding && (
        <Onboarding
          onComplete={() => {
            localStorage.setItem('frontly-onboarding-done', '1');
            setShowOnboarding(false);
          }}
        />
      )}

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />

      <div className="td-topbar" style={{ justifyContent: appSettings.toolbarPosition === 'center' ? 'center' : appSettings.toolbarPosition === 'right' ? 'flex-end' : 'flex-start' }}>
        {/* Logo toggle button — always visible */}
        <button
          className="td-logo-btn"
          type="button"
          onClick={() => setToolbarOpen((v) => !v)}
          title="Toggle toolbar"
          aria-label="Toggle toolbar"
        >
          <img src="/icons/icon128.png" alt="Frontly" />
        </button>

        {/* Toolbar row — slides in/out */}
        <div className={`td-topbar-row ${toolbarOpen ? 'is-open' : ''}`}>
          <div className="td-topbar-left">
            <WorkspaceTabs
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSelect={setActiveWorkspace}
              onAdd={() => addWorkspace(`Space ${workspaces.length + 1}`)}
              onRename={renameWorkspace}
              onDelete={removeWorkspace}
            />
          </div>

          <div className="td-topbar-center">
            <button
              className="td-create-board-btn"
              type="button"
              onClick={() => {
                if (activeWorkspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) {
                  showToast('Workspace is full (max 10 boards)', 'error');
                  return;
                }
                addBoard(activeWorkspace.id);
              }}
              title="Create board (Ctrl+B)"
              aria-label="Create board"
            >
              <Plus size={18} strokeWidth={2.4} />
            </button>

            {/* Widgets dropdown */}
            <div className="td-widgets-wrapper">
              <button
                className="td-create-board-btn"
                type="button"
                onClick={() => setWidgetsOpen((v) => !v)}
                title="Widgets"
                aria-label="Widgets"
              >
                <LayoutGrid size={16} strokeWidth={2.2} />
              </button>

              {widgetsOpen && (
                <div className="td-widgets-dropdown">
                  <button
                    className="td-link-context-item"
                    type="button"
                    onClick={() => {
                      setWidgetsOpen(false);
                      if (activeWorkspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) { showToast('Workspace full', 'error'); return; }
                      useWorkspaceStore.getState().addNoteBoard(activeWorkspace.id);
                    }}
                  >
                    <StickyNote size={14} strokeWidth={2} />
                    <span>Note</span>
                  </button>
                  <button
                    className="td-link-context-item"
                    type="button"
                    onClick={() => {
                      setWidgetsOpen(false);
                      if (activeWorkspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) { showToast('Workspace full', 'error'); return; }
                      useWorkspaceStore.getState().addTodoBoard(activeWorkspace.id);
                    }}
                  >
                    <CheckSquare size={14} strokeWidth={2} />
                    <span>Todo List</span>
                  </button>
                  <button
                    className="td-link-context-item"
                    type="button"
                    onClick={() => {
                      setWidgetsOpen(false);
                      if (activeWorkspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) { showToast('Workspace full', 'error'); return; }
                      useWorkspaceStore.getState().addBoard(activeWorkspace.id, 'Weather');
                      setTimeout(() => {
                        const state = useWorkspaceStore.getState();
                        const ws = state.getActiveWorkspace();
                        const lastBoard = ws?.boards[ws.boards.length - 1];
                        if (lastBoard && lastBoard.name === 'Weather') {
                          useWorkspaceStore.setState((s) => ({
                            workspaces: s.workspaces.map((w) =>
                              w.id === activeWorkspace.id
                                ? { ...w, boards: w.boards.map((b) => b.id === lastBoard.id ? { ...b, type: 'weather' as const } : b) }
                                : w
                            ),
                          }));
                        }
                      }, 50);
                    }}
                  >
                    <CloudSun size={14} strokeWidth={2} />
                    <span>Weather</span>
                  </button>
                  <button
                    className="td-link-context-item"
                    type="button"
                    onClick={() => {
                      setWidgetsOpen(false);
                      if (activeWorkspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) { showToast('Workspace full', 'error'); return; }
                      useWorkspaceStore.getState().addClockBoard(activeWorkspace.id);
                    }}
                  >
                    <ClockIcon size={14} strokeWidth={2} />
                    <span>Clock</span>
                  </button>
                  <button
                    className="td-link-context-item"
                    type="button"
                    onClick={() => {
                      setWidgetsOpen(false);
                      if (activeWorkspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) { showToast('Workspace full', 'error'); return; }
                      useWorkspaceStore.getState().addTimerBoard(activeWorkspace.id);
                    }}
                  >
                    <TimerIcon size={14} strokeWidth={2} />
                    <span>Timer</span>
                  </button>
                  <button
                    className="td-link-context-item"
                    type="button"
                    onClick={() => {
                      setWidgetsOpen(false);
                      if (activeWorkspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) { showToast('Workspace full', 'error'); return; }
                      useWorkspaceStore.getState().addRssBoard(activeWorkspace.id);
                    }}
                  >
                    <RssIcon size={14} strokeWidth={2} />
                    <span>Headlines (RSS)</span>
                  </button>
                  <button
                    className="td-link-context-item"
                    type="button"
                    onClick={() => {
                      setWidgetsOpen(false);
                      if (activeWorkspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) { showToast('Workspace full', 'error'); return; }
                      if (activeWorkspace.boards.some((b) => b.type === 'volt')) { showToast('VOLT widget already added', 'info'); return; }
                      useWorkspaceStore.getState().addVoltBoard(activeWorkspace.id);
                    }}
                  >
                    <ZapIcon size={14} strokeWidth={2} />
                    <span>VOLT</span>
                  </button>
                  <button
                    className="td-link-context-item"
                    type="button"
                    onClick={() => {
                      setWidgetsOpen(false);
                      if (activeWorkspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) { showToast('Workspace full', 'error'); return; }
                      useWorkspaceStore.getState().addCalendarBoard(activeWorkspace.id);
                    }}
                  >
                    <CalendarIcon size={14} strokeWidth={2} />
                    <span>Calendar</span>
                  </button>
                </div>
              )}
            </div>

            <div className="td-search-bar">
              <Search size={16} strokeWidth={2.2} />
              <input
                className="td-search-input"
                placeholder="Search boards, or press Enter to search the web"
                aria-label="Search boards or search the web"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
          </div>

          <div className="td-top-actions">
            <button
              className={`td-lock-btn ${layoutLocked ? 'is-locked' : ''}`}
              type="button"
              onClick={() => {
                setLayoutLocked((v) => {
                  showToast(!v ? 'Layout locked' : 'Layout unlocked', 'info');
                  return !v;
                });
              }}
              title={layoutLocked ? 'Unlock layout' : 'Lock layout'}
              aria-label={layoutLocked ? 'Unlock layout' : 'Lock layout'}
            >
              {layoutLocked ? '🔒' : '🔓'}
            </button>
            <Toolbar
              boards={activeWorkspace.boards as any}
              quickSaveBoardId={quickSaveBoardId}
              setQuickSaveBoardId={setQuickSaveBoardId}
              onImportBookmarks={handleImportBookmarks}
              onExport={handleExport}
              onImportJson={handleImportBackup}
              onWallpaper={handleWallpaper}
              onClearWallpaper={handleClearWallpaper}
              currentLiveWallpaper={activeWorkspace.liveWallpaper}
              onLiveWallpaper={(type) => setWorkspaceLiveWallpaper(activeWorkspace.id, type)}
            />
          </div>
        </div>
      </div>

      {activeWorkspace.boards.length === 0 ? (
        <div className="td-empty-home">
          <div className="f-empty-card">
            <div className="f-empty-logo">
              <img src="/icons/icon128.png" alt="Frontly" />
            </div>
            <h2 className="f-empty-title">This workspace is empty</h2>
            <p className="f-empty-sub">Add a board, start from a template, or bring in your existing backup.</p>

            <div className="f-empty-actions">
              <button
                className="f-empty-action f-empty-action--primary"
                type="button"
                onClick={() => addBoard(activeWorkspace.id)}
              >
                <Plus size={16} strokeWidth={2.4} />
                <span>Add a board</span>
              </button>

              <button
                className="f-empty-action"
                type="button"
                onClick={() => {
                  // getStarterTemplateBoards() mints fresh ids on every call,
                  // so loading it repeatedly never duplicates ids.
                  getStarterTemplateBoards().forEach((b) => importBoard(activeWorkspace.id, b));
                  showToast('Starter template loaded', 'success');
                }}
              >
                <LayoutTemplate size={16} strokeWidth={2.2} />
                <span>Load starter template</span>
              </button>

              <button
                className="f-empty-action"
                type="button"
                onClick={() =>
                  (document.querySelector('input[accept="application/json"]') as HTMLInputElement)?.click()
                }
              >
                <Bookmark size={16} strokeWidth={2.2} />
                <span>Import a backup</span>
              </button>
            </div>

            <p className="f-empty-hint">Tip: press <kbd>Ctrl</kbd>+<kbd>K</kbd> to search, or open the toolbar menu to import browser bookmarks.</p>
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragLink(null)}
        >
          <RGL
            className={`td-board-grid ${boardDragging ? 'is-dragging' : ''}`}
            layout={gridLayout}
            cols={grid.cols}
            rowHeight={GRID_STEP}
            width={grid.width}
            margin={[0, 0]}
            containerPadding={[0, 0]}
            isDraggable={!layoutLocked}
            isResizable={!layoutLocked}
            isBounded={false}
            compactType={null}
            preventCollision={true}
            autoSize={true}
            style={{ minHeight: grid.height, width: grid.width }}
            draggableHandle=".td-board-drag-bar"
            onDragStart={() => setBoardDragging(true)}
            onDragStop={(l, o, n, ph, e, el) => { setBoardDragging(false); handleGridLayoutChange(l, o, n); void ph; void e; void el; }}
            onResizeStart={() => setBoardDragging(true)}
            onResizeStop={(l, o, n, ph, e, el) => { setBoardDragging(false); handleGridLayoutChange(l, o, n); void ph; void e; void el; }}
            resizeHandles={['e']}
            resizeHandle={<span className="f-resize-bar" />}
          >
            {visibleBoards.map((board) => (
              <div key={board.id}>
                <Board
                  workspaceId={activeWorkspace.id}
                  board={board}
                  workspaces={workspaces}
                />
              </div>
            ))}
          </RGL>

          <DragOverlay dropAnimation={null}>
            {activeDragLink ? (
              <div className="f-drag-chip">
                <img
                  className="f-drag-chip-icon"
                  src={activeDragLink.favicon?.trim() || getFaviconUrl(activeDragLink.url, 32)}
                  alt=""
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                />
                <span className="f-drag-chip-title">{activeDragLink.title}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <SettingsButton onResetOnboarding={() => {
        localStorage.removeItem('frontly-onboarding-done');
        setShowOnboarding(true);
      }} />
    </div>
  );
}
