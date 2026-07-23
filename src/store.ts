import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { FileEntry, OpenFile } from "./types";

type WorkspaceStore = {
  root: string | null;
  recent: string[];
  entries: Record<string, FileEntry[]>;
  expanded: string[];
  tabs: OpenFile[];
  activePath: string | null;
  busy: boolean;
  error: string | null;
  loadRecent: () => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  loadDirectory: (path?: string) => Promise<void>;
  toggleDirectory: (entry: FileEntry) => Promise<void>;
  openFile: (entry: FileEntry) => Promise<void>;
  updateFile: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  refreshOpenFiles: () => Promise<void>;
  closeTab: (path: string) => void;
  setActive: (path: string) => void;
};

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  root: null,
  recent: [],
  entries: {},
  expanded: [""],
  tabs: [],
  activePath: null,
  busy: false,
  error: null,

  loadRecent: async () => {
    try { set({ recent: await invoke<string[]>("recent_projects") }); } catch { set({ recent: [] }); }
  },

  openWorkspace: async (path) => {
    set({ busy: true, error: null });
    try {
      const recent = await invoke<string[]>("set_workspace", { path });
      set({ root: path, recent, entries: {}, expanded: [""], tabs: [], activePath: null });
      await get().loadDirectory();
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ busy: false });
    }
  },

  loadDirectory: async (path = "") => {
    try {
      const entries = await invoke<FileEntry[]>("list_directory", { path });
      set((state) => ({ entries: { ...state.entries, [path]: entries }, error: null }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  toggleDirectory: async (entry) => {
    const expanded = get().expanded;
    if (expanded.includes(entry.path)) {
      set({ expanded: expanded.filter((path) => path !== entry.path) });
      return;
    }
    set({ expanded: [...expanded, entry.path] });
    if (!get().entries[entry.path]) await get().loadDirectory(entry.path);
  },

  openFile: async (entry) => {
    const existing = get().tabs.find((tab) => tab.path === entry.path);
    if (existing) {
      set({ activePath: entry.path });
      return;
    }
    set({ busy: true, error: null });
    try {
      const content = await invoke<string>("read_file", { path: entry.path });
      set((state) => ({ tabs: [...state.tabs, { path: entry.path, name: entry.name, content, dirty: false }], activePath: entry.path }));
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ busy: false });
    }
  },

  updateFile: (path, content) => set((state) => ({ tabs: state.tabs.map((tab) => tab.path === path ? { ...tab, content, dirty: true } : tab) })),

  saveFile: async (path) => {
    const file = get().tabs.find((tab) => tab.path === path);
    if (!file) return;
    set({ busy: true, error: null });
    try {
      await invoke("write_file", { path, contents: file.content });
      set((state) => ({ tabs: state.tabs.map((tab) => tab.path === path ? { ...tab, dirty: false } : tab) }));
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ busy: false });
    }
  },

  refreshOpenFiles: async () => {
    const tabs = get().tabs;
    const updates = await Promise.all(tabs.filter((tab) => !tab.dirty).map(async (tab) => {
      try { return [tab.path, await invoke<string>("read_file", { path: tab.path })] as const; } catch { return null; }
    }));
    const contents = new Map(updates.filter((item): item is readonly [string, string] => item !== null));
    set((state) => ({ tabs: state.tabs.map((tab) => contents.has(tab.path) ? { ...tab, content: contents.get(tab.path)!, dirty: false } : tab) }));
  },

  closeTab: (path) => set((state) => {
    const tabs = state.tabs.filter((tab) => tab.path !== path);
    return { tabs, activePath: state.activePath === path ? tabs.at(-1)?.path ?? null : state.activePath };
  }),

  setActive: (path) => set({ activePath: path }),
}));
