import { create } from "zustand";

export interface EditingBucket {
  id: string;
  name: string;
  description: string;
  examples: string;
}

export interface ActionToast {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface AppState {
  selectedBucketId: string | null;
  setSelectedBucketId: (id: string | null) => void;
  selectedProvider: string | null;
  setSelectedProvider: (p: string | null) => void;
  syncLoading: boolean;
  setSyncLoading: (v: boolean) => void;
  classifyLoading: "classify" | "reclassify" | null;
  setClassifyLoading: (v: "classify" | "reclassify" | null) => void;
  newBucketOpen: boolean;
  setNewBucketOpen: (v: boolean) => void;
  editingBucket: EditingBucket | null;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  actionToast: ActionToast | null;
  setActionToast: (t: ActionToast | null) => void;
  draggingThreadId: string | null;
  setDraggingThreadId: (id: string | null) => void;
  onboardingOpen: boolean;
  setOnboardingOpen: (v: boolean) => void;
  classifyProgress: string | null;
  setClassifyProgress: (v: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedBucketId: null,
  setSelectedBucketId: (id) => set({ selectedBucketId: id }),
  selectedProvider: null,
  setSelectedProvider: (p) => set({ selectedProvider: p }),
  syncLoading: false,
  setSyncLoading: (v) => set({ syncLoading: v }),
  classifyLoading: null,
  setClassifyLoading: (v) => set({ classifyLoading: v }),
  newBucketOpen: false,
  setNewBucketOpen: (v) => set({ newBucketOpen: v }),
  editingBucket: null,
  sidebarOpen: false,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),
  actionToast: null,
  setActionToast: (t) => set({ actionToast: t }),
  draggingThreadId: null,
  setDraggingThreadId: (id) => set({ draggingThreadId: id }),
  onboardingOpen: false,
  setOnboardingOpen: (v) => set({ onboardingOpen: v }),
  classifyProgress: null,
  setClassifyProgress: (v) => set({ classifyProgress: v }),
}));
