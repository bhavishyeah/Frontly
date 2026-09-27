import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { BoardItem, BoardDisplayMode, CalendarConfig, CalendarEvent, IconSize, LinkItem, LiveWallpaperType, TodoItem, WorkspaceItem } from '../lib/workspaceTypes';
import { MAX_BOARDS_PER_WORKSPACE, MAX_LINKS_PER_BOARD } from '../lib/bookmarkImport';
import { GRID_STEP, gridExtent } from '../lib/useGridDimensions';
import { useSettingsStore } from './useSettingsStore';

const uid = () => crypto.randomUUID();
const now = () => Date.now();

/**
 * Pick a free-ish slot for a new board and clamp it inside the canvas.
 * `y` is snapped to an even row so link rows stay aligned across boards.
 */
function placeNewBoard(boardCount: number) {
  const { cols, maxRows } = gridExtent();
  const s = useSettingsStore.getState();

  const w = Math.max(Math.min(s.defaultBoardW, cols - 1), 8);
  const h = Math.max(Math.min(s.defaultBoardH, maxRows - 1), 2);

  const perRow = Math.max(Math.floor(cols / (w + 1)), 1);
  const col = boardCount % perRow;
  const row = Math.floor(boardCount / perRow);

  const x = Math.max(Math.min(col * (w + 1), cols - w), 0);
  const rawY = row * (h + 2);
  const y = Math.max(Math.min(rawY - (rawY % 2), maxRows - h), 0);

  return { x, y, w, h, gridStep: GRID_STEP };
}

const createBoard = (name = 'New Board'): BoardItem => ({
  id: uid(),
  name,
  links: [],
  createdAt: now(),
  updatedAt: now(),
});

const createWorkspace = (name = 'Home'): WorkspaceItem => ({
  id: uid(),
  name,
  boards: [],
  wallpaper: null,
  videoWallpaper: null,
  liveWallpaper: null,
  createdAt: now(),
  updatedAt: now(),
});

const chromeStorage: StateStorage = {
  getItem: async (name) => {
    const result = await chrome.storage.local.get(name);
    return (result[name] as string) ?? null;
  },
  setItem: async (name, value) => {
    await chrome.storage.local.set({ [name]: value });
  },
  removeItem: async (name) => {
    await chrome.storage.local.remove(name);
  },
};

interface WorkspaceState {
  workspaces: WorkspaceItem[];
  activeWorkspaceId: string;
  setActiveWorkspace: (workspaceId: string) => void;
  addWorkspace: (name?: string) => void;
  renameWorkspace: (workspaceId: string, name: string) => void;
  removeWorkspace: (workspaceId: string) => void;
  addBoard: (workspaceId: string, name?: string) => void;
  addNoteBoard: (workspaceId: string, name?: string) => void;
  addTodoBoard: (workspaceId: string, name?: string) => void;
  addClockBoard: (workspaceId: string) => void;
  addTimerBoard: (workspaceId: string) => void;
  addRssBoard: (workspaceId: string) => void;
  addVoltBoard: (workspaceId: string) => void;
  addCalendarBoard: (workspaceId: string) => void;
  setTimerConfig: (workspaceId: string, boardId: string, config: import('../lib/workspaceTypes').TimerConfig) => void;
  setRssConfig: (workspaceId: string, boardId: string, config: import('../lib/workspaceTypes').RssConfig) => void;
  setVoltConfig: (workspaceId: string, boardId: string, config: import('../lib/workspaceTypes').VoltConfig) => void;
  setCalendarConfig: (workspaceId: string, boardId: string, config: CalendarConfig) => void;
  /** Add a local calendar event. Routes to workspace-shared or per-widget storage based on the widget's sharedCalendar config. */
  addCalendarEvent: (workspaceId: string, boardId: string, event: Omit<CalendarEvent, 'id' | 'source'>) => void;
  updateCalendarEvent: (workspaceId: string, boardId: string, eventId: string, patch: Partial<Omit<CalendarEvent, 'id' | 'source'>>) => void;
  removeCalendarEvent: (workspaceId: string, boardId: string, eventId: string) => void;
  duplicateBoard: (workspaceId: string, boardId: string) => void;
  updateNoteContent: (workspaceId: string, boardId: string, content: string) => void;
  updateTodos: (workspaceId: string, boardId: string, todos: TodoItem[]) => void;
  renameBoard: (workspaceId: string, boardId: string, name: string) => void;
  setBoardColor: (workspaceId: string, boardId: string, color: string | undefined) => void;
  toggleBoardHeader: (workspaceId: string, boardId: string) => void;
  setBoardDisplayMode: (workspaceId: string, boardId: string, mode: BoardDisplayMode) => void;
  setBoardIconSize: (workspaceId: string, boardId: string, size: IconSize) => void;
  setBoardSections: (workspaceId: string, boardId: string, show: boolean) => void;
  setClockConfig: (workspaceId: string, boardId: string, config: import('../lib/workspaceTypes').ClockConfig) => void;
  setWeatherConfig: (workspaceId: string, boardId: string, config: import('../lib/workspaceTypes').WeatherConfig) => void;
  removeBoard: (workspaceId: string, boardId: string) => void;
  transferBoard: (fromWorkspaceId: string, toWorkspaceId: string, boardId: string) => void;
  updateBoardLayouts: (workspaceId: string, layouts: { id: string; x: number; y: number; w: number; h: number }[]) => void;
  importBoard: (workspaceId: string, board: BoardItem) => void;
  /** Replace all workspaces (used to apply data pulled from cross-device sync). */
  replaceAll: (workspaces: WorkspaceItem[], activeWorkspaceId: string) => void;
  addLink: (workspaceId: string, boardId: string, title: string, url: string) => void;
  renameLink: (workspaceId: string, boardId: string, linkId: string, title: string) => void;
  /** Edit a link's title/url/favicon in one action (favicon '' clears the override). */
  updateLink: (workspaceId: string, boardId: string, linkId: string, patch: { title?: string; url?: string; favicon?: string }) => void;
  transferLink: (fromWorkspaceId: string, fromBoardId: string, linkId: string, toWorkspaceId: string, toBoardId: string) => void;
  reorderLinks: (workspaceId: string, boardId: string, fromIndex: number, toIndex: number) => void;
  removeLink: (workspaceId: string, boardId: string, linkId: string) => void;
  moveLink: (
    workspaceId: string,
    activeLinkId: string,
    overLinkId: string,
    fromBoardId: string,
    toBoardId: string
  ) => void;
  setWorkspaceWallpaper: (workspaceId: string, wallpaper: string | null) => void;
  setVideoWallpaper: (workspaceId: string, videoKey: string | null) => void;
  setWorkspaceLiveWallpaper: (workspaceId: string, liveWallpaper: LiveWallpaperType) => void;
  getActiveWorkspace: () => WorkspaceItem | undefined;
}

const initialWorkspace = createWorkspace('Home');

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [initialWorkspace],
      activeWorkspaceId: initialWorkspace.id,

      setActiveWorkspace: (workspaceId) => set({ activeWorkspaceId: workspaceId }),

      addWorkspace: (name = 'New Space') =>
        set((state) => {
          const workspace = createWorkspace(name);
          return {
            workspaces: [...state.workspaces, workspace],
            activeWorkspaceId: workspace.id,
          };
        }),

      renameWorkspace: (workspaceId, name) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? { ...workspace, name, updatedAt: now() }
              : workspace
          ),
        })),

      removeWorkspace: (workspaceId) =>
        set((state) => {
          if (state.workspaces.length === 1) return state;

          const nextWorkspaces = state.workspaces.filter(
            (workspace) => workspace.id !== workspaceId
          );

          const nextActive =
            state.activeWorkspaceId === workspaceId
              ? nextWorkspaces[0]?.id ?? ''
              : state.activeWorkspaceId;

          return {
            workspaces: nextWorkspaces,
            activeWorkspaceId: nextActive,
          };
        }),

      addBoard: (workspaceId, name = 'New Board') =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            if (workspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) return workspace;
            const layout = placeNewBoard(workspace.boards.length);
            return {
              ...workspace,
              boards: [...workspace.boards, { ...createBoard(name), layout }],
              updatedAt: now(),
            };
          }),
        })),

      addNoteBoard: (workspaceId, name = 'Note') =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            if (workspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) return workspace;
            const layout = placeNewBoard(workspace.boards.length);
            return {
              ...workspace,
              boards: [...workspace.boards, { ...createBoard(name), type: 'note' as const, noteContent: '', layout }],
              updatedAt: now(),
            };
          }),
        })),

      addTodoBoard: (workspaceId, name = 'Todo') =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            if (workspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) return workspace;
            const layout = placeNewBoard(workspace.boards.length);
            return {
              ...workspace,
              boards: [...workspace.boards, { ...createBoard(name), type: 'todo' as const, todos: [], layout }],
              updatedAt: now(),
            };
          }),
        })),

      addClockBoard: (workspaceId) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            if (workspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) return workspace;
            const layout = placeNewBoard(workspace.boards.length);
            const clockLayout = { ...layout, w: Math.min(24, Math.max(22, layout.w)) };
            return {
              ...workspace,
              boards: [...workspace.boards, { ...createBoard('Clock'), type: 'clock' as const, layout: clockLayout }],
              updatedAt: now(),
            };
          }),
        })),

      addTimerBoard: (workspaceId) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            if (workspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) return workspace;
            const base = placeNewBoard(workspace.boards.length);
            const layout = { ...base, w: Math.min(20, base.w) }; // compact by default
            return {
              ...workspace,
              boards: [...workspace.boards, { ...createBoard('Timer'), type: 'timer' as const, timerConfig: { mode: 'countdown' }, layout }],
              updatedAt: now(),
            };
          }),
        })),

      addRssBoard: (workspaceId) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            if (workspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) return workspace;
            const layout = placeNewBoard(workspace.boards.length);
            return {
              ...workspace,
              boards: [...workspace.boards, { ...createBoard('Headlines'), type: 'rss' as const, rssConfig: { count: 6 }, layout }],
              updatedAt: now(),
            };
          }),
        })),

      addVoltBoard: (workspaceId) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            if (workspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) return workspace;
            // VOLT is a singleton — only one inbox widget per workspace.
            if (workspace.boards.some((b) => b.type === 'volt')) return workspace;
            const base = placeNewBoard(workspace.boards.length);
            // VOLT widget works best at medium width — enough to read content
            const layout = { ...base, w: Math.min(28, Math.max(22, base.w)) };
            return {
              ...workspace,
              boards: [
                ...workspace.boards,
                {
                  ...createBoard('VOLT'),
                  type: 'volt' as const,
                  voltConfig: {
                    maxItems: 5,
                    showSender: true,
                    showTimestamps: true,
                    showText: true,
                    showLinks: true,
                    showImages: true,
                    showFiles: true,
                  },
                  layout,
                },
              ],
              updatedAt: now(),
            };
          }),
        })),

      addCalendarBoard: (workspaceId) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            if (workspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) return workspace;
            const base = placeNewBoard(workspace.boards.length);
            // Calendar is wider than tall — needs room for the month grid + agenda.
            const layout = { ...base, w: Math.min(40, Math.max(28, base.w)) };
            return {
              ...workspace,
              boards: [
                ...workspace.boards,
                {
                  ...createBoard('Calendar'),
                  type: 'calendar' as const,
                  calendarConfig: {
                    sharedCalendar: false,
                    weekStart: 0 as const,
                    showMonthGrid: true,
                    googleConnected: false,
                    agendaDays: 14,
                  },
                  calendarEvents: [],
                  layout,
                },
              ],
              updatedAt: now(),
            };
          }),
        })),

      duplicateBoard: (workspaceId, boardId) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            if (workspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) return workspace;
            const board = workspace.boards.find((b) => b.id === boardId);
            if (!board) return workspace;
            // VOLT is a singleton inbox — a second instance would share the
            // same global store and create a conflicting realtime channel.
            if (board.type === 'volt') return workspace;
            const duplicate = {
              ...board,
              id: uid(),
              name: `${board.name} (copy)`,
              layout: undefined,
              links: board.links.map((l) => ({ ...l, id: uid() })),
              todos: board.todos?.map((t) => ({ ...t, id: uid() })),
              createdAt: now(),
              updatedAt: now(),
            };
            return {
              ...workspace,
              boards: [...workspace.boards, duplicate],
              updatedAt: now(),
            };
          }),
        })),

      updateNoteContent: (workspaceId, boardId, content) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, noteContent: content, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      updateTodos: (workspaceId, boardId, todos) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, todos, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      renameBoard: (workspaceId, boardId, name) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, name, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      setBoardColor: (workspaceId, boardId, color) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, color, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      toggleBoardHeader: (workspaceId: string, boardId: string) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, hideHeader: !board.hideHeader, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      setBoardDisplayMode: (workspaceId, boardId, mode) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, displayMode: mode, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      setBoardIconSize: (workspaceId, boardId, size) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, iconSize: size, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      setBoardSections: (workspaceId, boardId, show) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, showSections: show, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      setClockConfig: (workspaceId, boardId, config) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, clockConfig: { ...board.clockConfig, ...config }, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      setWeatherConfig: (workspaceId, boardId, config) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, weatherConfig: { ...board.weatherConfig, ...config }, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      setTimerConfig: (workspaceId, boardId, config) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, timerConfig: { ...board.timerConfig, ...config }, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      setRssConfig: (workspaceId, boardId, config) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, rssConfig: { ...board.rssConfig, ...config }, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      setVoltConfig: (workspaceId, boardId, config) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, voltConfig: { ...board.voltConfig, ...config }, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      setCalendarConfig: (workspaceId, boardId, config) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? { ...board, calendarConfig: { ...board.calendarConfig, ...config }, updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      addCalendarEvent: (workspaceId, boardId, event) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            const board = workspace.boards.find((b) => b.id === boardId);
            const shared = board?.calendarConfig?.sharedCalendar ?? false;
            const newEvent: CalendarEvent = { ...event, id: uid(), source: 'local' };

            if (shared) {
              // Store on the workspace so every calendar widget sees it.
              return {
                ...workspace,
                sharedCalendarEvents: [...(workspace.sharedCalendarEvents ?? []), newEvent],
                updatedAt: now(),
              };
            }
            // Store on this specific board.
            return {
              ...workspace,
              boards: workspace.boards.map((b) =>
                b.id === boardId
                  ? { ...b, calendarEvents: [...(b.calendarEvents ?? []), newEvent], updatedAt: now() }
                  : b
              ),
              updatedAt: now(),
            };
          }),
        })),

      updateCalendarEvent: (workspaceId, boardId, eventId, patch) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            const board = workspace.boards.find((b) => b.id === boardId);
            const shared = board?.calendarConfig?.sharedCalendar ?? false;

            if (shared) {
              return {
                ...workspace,
                sharedCalendarEvents: (workspace.sharedCalendarEvents ?? []).map((e) =>
                  e.id === eventId ? { ...e, ...patch } : e
                ),
                updatedAt: now(),
              };
            }
            return {
              ...workspace,
              boards: workspace.boards.map((b) =>
                b.id === boardId
                  ? {
                      ...b,
                      calendarEvents: (b.calendarEvents ?? []).map((e) =>
                        e.id === eventId ? { ...e, ...patch } : e
                      ),
                      updatedAt: now(),
                    }
                  : b
              ),
              updatedAt: now(),
            };
          }),
        })),

      removeCalendarEvent: (workspaceId, boardId, eventId) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            const board = workspace.boards.find((b) => b.id === boardId);
            const shared = board?.calendarConfig?.sharedCalendar ?? false;

            if (shared) {
              return {
                ...workspace,
                sharedCalendarEvents: (workspace.sharedCalendarEvents ?? []).filter((e) => e.id !== eventId),
                updatedAt: now(),
              };
            }
            return {
              ...workspace,
              boards: workspace.boards.map((b) =>
                b.id === boardId
                  ? { ...b, calendarEvents: (b.calendarEvents ?? []).filter((e) => e.id !== eventId), updatedAt: now() }
                  : b
              ),
              updatedAt: now(),
            };
          }),
        })),

      removeBoard: (workspaceId, boardId) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.filter((board) => board.id !== boardId),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      transferBoard: (fromWorkspaceId, toWorkspaceId, boardId) =>
        set((state) => {
          const fromWs = state.workspaces.find((ws) => ws.id === fromWorkspaceId);
          const toWs = state.workspaces.find((ws) => ws.id === toWorkspaceId);
          if (!fromWs || !toWs) return state;

          const board = fromWs.boards.find((b) => b.id === boardId);
          if (!board) return state;

          // Check target workspace capacity
          if (toWs.boards.length >= MAX_BOARDS_PER_WORKSPACE) return state;

          return {
            workspaces: state.workspaces.map((workspace) => {
              if (workspace.id === fromWorkspaceId) {
                return {
                  ...workspace,
                  boards: workspace.boards.filter((b) => b.id !== boardId),
                  updatedAt: now(),
                };
              }
              if (workspace.id === toWorkspaceId) {
                return {
                  ...workspace,
                  boards: [...workspace.boards, { ...board, layout: undefined }],
                  updatedAt: now(),
                };
              }
              return workspace;
            }),
          };
        }),

      updateBoardLayouts: (workspaceId, layouts) =>
        set((state) => {
          let changed = false;

          const workspaces = state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;

            const boards = workspace.boards.map((board) => {
              const layout = layouts.find((l) => l.id === board.id);
              if (!layout) return board;

              const next = {
                x: layout.x,
                // Keep y on an even row so link rows line up across boards
                y: layout.y - (layout.y % 2),
                w: layout.w,
                h: layout.h,
                gridStep: GRID_STEP,
              };

              const prev = board.layout;
              // Guard: skip write if nothing changed (works for both defined and undefined prev)
              if (
                prev !== undefined &&
                prev.x === next.x &&
                prev.y === next.y &&
                prev.w === next.w &&
                prev.h === next.h &&
                prev.gridStep === next.gridStep
              ) {
                return board;
              }

              changed = true;
              return { ...board, layout: next };
            });

            return changed ? { ...workspace, boards, updatedAt: now() } : workspace;
          });

          // Nothing moved — avoid a pointless write and re-render loop
          return changed ? { workspaces } : {};
        }),

      importBoard: (workspaceId, board) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;
            if (workspace.boards.length >= MAX_BOARDS_PER_WORKSPACE) return workspace;
            return {
              ...workspace,
              boards: [...workspace.boards, board],
              updatedAt: now(),
            };
          }),
        })),

      replaceAll: (workspaces, activeWorkspaceId) =>
        set((state) => {
          if (!workspaces.length) return state;
          const activeExists = workspaces.some((w) => w.id === activeWorkspaceId);
          return {
            workspaces,
            activeWorkspaceId: activeExists ? activeWorkspaceId : workspaces[0].id,
          };
        }),

      addLink: (workspaceId, boardId, title, url) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) => {
                    if (board.id !== boardId) return board;
                    if (board.links.length >= MAX_LINKS_PER_BOARD) return board;
                    return {
                      ...board,
                      links: [
                        ...board.links,
                        {
                          id: uid(),
                          title,
                          url,
                          createdAt: now(),
                          updatedAt: now(),
                        } as LinkItem,
                      ],
                      updatedAt: now(),
                    };
                  }),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      renameLink: (workspaceId, boardId, linkId, title) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? {
                          ...board,
                          links: board.links.map((link) =>
                            link.id === linkId
                              ? { ...link, title, updatedAt: now() }
                              : link
                          ),
                          updatedAt: now(),
                        }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      updateLink: (workspaceId, boardId, linkId, patch) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? {
                          ...board,
                          links: board.links.map((link) => {
                            if (link.id !== linkId) return link;
                            const next = { ...link, updatedAt: now() };
                            if (patch.title !== undefined) next.title = patch.title;
                            if (patch.url !== undefined) {
                              const u = patch.url.trim();
                              next.url = /^https?:\/\//i.test(u) || !u ? u : `https://${u}`;
                            }
                            if (patch.favicon !== undefined) {
                              // Empty string clears the override so render falls back to the service.
                              next.favicon = patch.favicon.trim() || undefined;
                            }
                            return next;
                          }),
                          updatedAt: now(),
                        }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      transferLink: (fromWorkspaceId, fromBoardId, linkId, toWorkspaceId, toBoardId) =>
        set((state) => {
          // Find the link
          const fromWs = state.workspaces.find((ws) => ws.id === fromWorkspaceId);
          const fromBoard = fromWs?.boards.find((b) => b.id === fromBoardId);
          const link = fromBoard?.links.find((l) => l.id === linkId);
          if (!link) return state;

          // Check target board capacity
          const toWs = state.workspaces.find((ws) => ws.id === toWorkspaceId);
          const toBoard = toWs?.boards.find((b) => b.id === toBoardId);
          if (!toBoard || toBoard.links.length >= MAX_LINKS_PER_BOARD) return state;

          return {
            workspaces: state.workspaces.map((workspace) => {
              if (workspace.id === fromWorkspaceId) {
                return {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === fromBoardId
                      ? { ...board, links: board.links.filter((l) => l.id !== linkId), updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                };
              }
              if (workspace.id === toWorkspaceId) {
                return {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === toBoardId
                      ? { ...board, links: [...board.links, link], updatedAt: now() }
                      : board
                  ),
                  updatedAt: now(),
                };
              }
              return workspace;
            }),
          };
        }),

      reorderLinks: (workspaceId, boardId, fromIndex, toIndex) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) => {
                    if (board.id !== boardId) return board;
                    const links = [...board.links];
                    const [moved] = links.splice(fromIndex, 1);
                    links.splice(toIndex, 0, moved);
                    return { ...board, links, updatedAt: Date.now() };
                  }),
                  updatedAt: Date.now(),
                }
              : workspace
          ),
        })),

      removeLink: (workspaceId, boardId, linkId) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? {
                  ...workspace,
                  boards: workspace.boards.map((board) =>
                    board.id === boardId
                      ? {
                          ...board,
                          links: board.links.filter((link) => link.id !== linkId),
                          updatedAt: now(),
                        }
                      : board
                  ),
                  updatedAt: now(),
                }
              : workspace
          ),
        })),

      moveLink: (workspaceId, activeLinkId, overLinkId, fromBoardId, toBoardId) =>
        set((state) => {
          const workspaces = state.workspaces.map((workspace) => {
            if (workspace.id !== workspaceId) return workspace;

            const fromBoard = workspace.boards.find((board) => board.id === fromBoardId);
            const toBoard = workspace.boards.find((board) => board.id === toBoardId);
            if (!fromBoard || !toBoard) return workspace;

            const activeLink = fromBoard.links.find((link) => link.id === activeLinkId);
            if (!activeLink) return workspace;

            const cleanedBoards = workspace.boards.map((board) =>
              board.id === fromBoardId
                ? {
                    ...board,
                    links: board.links.filter((link) => link.id !== activeLinkId),
                    updatedAt: now(),
                  }
                : board
            );

            const rebuiltBoards = cleanedBoards.map((board) => {
              if (board.id !== toBoardId) return board;

              const overIndex = board.links.findIndex((link) => link.id === overLinkId);
              const nextLinks = [...board.links];

              if (overIndex === -1 || overLinkId.startsWith('board-drop-')) {
                nextLinks.push(activeLink);
              } else {
                nextLinks.splice(overIndex, 0, activeLink);
              }

              return {
                ...board,
                links: nextLinks,
                updatedAt: now(),
              };
            });

            return {
              ...workspace,
              boards: rebuiltBoards,
              updatedAt: now(),
            };
          });

          return { workspaces };
        }),

      setWorkspaceWallpaper: (workspaceId, wallpaper) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? { ...workspace, wallpaper, liveWallpaper: null, videoWallpaper: null, updatedAt: now() }
              : workspace
          ),
        })),

      setVideoWallpaper: (workspaceId, videoKey) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? { ...workspace, videoWallpaper: videoKey, wallpaper: null, liveWallpaper: null, updatedAt: now() }
              : workspace
          ),
        })),

      setWorkspaceLiveWallpaper: (workspaceId, liveWallpaper) =>
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? { ...workspace, liveWallpaper, wallpaper: null, videoWallpaper: null, updatedAt: now() }
              : workspace
          ),
        })),

      getActiveWorkspace: () =>
        get().workspaces.find(
          (workspace) => workspace.id === get().activeWorkspaceId
        ),
    }),
    {
      name: 'frontly-workspaces',
      storage: createJSONStorage(() => chromeStorage),
      partialize: (state) => ({
        workspaces: state.workspaces,
        activeWorkspaceId: state.activeWorkspaceId,
      }),
    }
  )
);
