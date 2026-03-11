"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import Sidebar from "@/components/Sidebar";
import NewBucketModal from "@/components/NewBucketModal";
import OnboardingModal from "@/components/OnboardingModal";
import { useAppStore } from "@/lib/store";

export default function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const {
    sidebarOpen,
    setSidebarOpen,
    syncLoading,
    setSyncLoading,
    classifyLoading,
    setClassifyLoading,
    searchQuery,
    setSearchQuery,
    classifyProgress,
    setClassifyProgress,
  } = useAppStore();

  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  };

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  const handleSync = async () => {
    setSyncLoading(true);
    try {
      const res = await fetch("/api/gmail/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) showToast(`Synced ${data.synced} threads`);
      else if (res.status === 401) showToast("Session expired. Please sign in again.");
      else if (res.status === 429) showToast("Gmail rate limit hit. Try again in a minute.");
      else showToast(`Sync error: ${data.error}`);
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["buckets"] });

      // Check if this is a first-time setup: all buckets are defaults and no threads classified
      if (res.ok && data.synced > 0) {
        try {
          const bucketsRes = await fetch("/api/buckets");
          const buckets = await bucketsRes.json();
          const allDefault = buckets.length > 0 && buckets.every((b: { isDefault: boolean }) => b.isDefault);
          const noneClassified = buckets.every((b: { _count: { threads: number } }) => b._count.threads === 0);
          if (allDefault && noneClassified) {
            useAppStore.getState().setOnboardingOpen(true);
          }
        } catch { /* ignore */ }
      }
    } catch {
      showToast("Sync failed. Check your connection.");
    } finally {
      setSyncLoading(false);
    }
  };

  const handleClassify = async (reclassify = false) => {
    setClassifyLoading(reclassify ? "reclassify" : "classify");
    setClassifyProgress("Starting...");
    try {
      const url = reclassify ? "/api/classify?reclassify=true" : "/api/classify";
      const res = await fetch(url, { method: "POST" });

      if (!res.body) {
        showToast("Classification error: no response stream");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);

            if (evt.phase === "loading") {
              setClassifyProgress("Loading...");
            } else if (evt.phase === "started") {
              setClassifyProgress(`0 / ${evt.total}`);
            } else if (evt.phase === "rules") {
              setClassifyProgress(
                evt.needsLLM > 0
                  ? `${evt.rulesCaught} by rules, ${evt.needsLLM} need AI`
                  : `${evt.rulesCaught} / ${evt.total} by rules`
              );
            } else if (evt.phase === "llm") {
              setClassifyProgress(`${evt.processed} / ${evt.total} — ${evt.message}`);
            } else if (evt.phase === "llm-progress") {
              setClassifyProgress(`${evt.processed} / ${evt.total} — AI ${evt.batchesCompleted}/${evt.totalBatches}`);
            } else if (evt.phase === "fallback") {
              setClassifyProgress("No AI provider");
            } else if (evt.phase === "complete") {
              const ruleTotal = (evt.senderRules || 0) + (evt.autoDetect || 0) + (evt.keywords || 0) + (evt.customMatch || 0) + (evt.labels || 0);
              const timeStr = evt.timeMs ? ` in ${(evt.timeMs / 1000).toFixed(1)}s` : "";
              const parts: string[] = [];
              if (ruleTotal) parts.push(`${ruleTotal} by rules`);
              if (evt.llmBased) parts.push(`${evt.llmBased} by AI`);
              if (evt.failed) parts.push(`${evt.failed} failed`);
              if (evt.skippedManualOverrides) parts.push(`${evt.skippedManualOverrides} manual`);
              showToast(
                `Classified ${evt.classified} / ${evt.total} threads${timeStr}${parts.length ? ` (${parts.join(", ")})` : ""}`
              );
            } else if (evt.phase === "error") {
              showToast(`Classification error: ${evt.message}`);
            }
          } catch {
            // ignore malformed lines
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["buckets"] });
    } catch {
      showToast("Classification failed. Check your connection.");
    } finally {
      setClassifyLoading(null);
      setClassifyProgress(null);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="w-6 h-6 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  const initials = (session.user?.name || session.user?.email || "?")
    .charAt(0)
    .toUpperCase();

  const isSettings = pathname === "/inbox/settings";
  const isHeatmap = pathname === "/inbox/heatmap";
  const isInbox = !isSettings && !isHeatmap;

  return (
    <div className="h-screen flex flex-col bg-stone-50">
      {/* Top bar */}
      <header className="bg-white border-b border-stone-200 px-4 md:px-6 py-2.5 flex items-center gap-3 flex-shrink-0">
        {/* Left: hamburger + logo + tabs */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-1.5 rounded-lg hover:bg-stone-100 text-stone-600 cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-zinc-900 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <h1 className="text-lg font-bold text-stone-900 tracking-tight hidden sm:block">Inbox Concierge</h1>
          </div>

          {/* Tab switcher — pill style */}
          <div className="hidden sm:flex items-center bg-stone-100 rounded-full p-0.5 gap-0.5 ml-3">
            <Link
              href="/inbox"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                isInbox
                  ? "bg-white text-stone-900 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 13.5V6.75A2.25 2.25 0 014.5 4.5h15a2.25 2.25 0 012.25 2.25v6.75" />
              </svg>
              Inbox
            </Link>
            <Link
              href="/inbox/heatmap"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                isHeatmap
                  ? "bg-white text-stone-900 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
              Heatmap
            </Link>
          </div>
        </div>

        {/* Center: search bar */}
        <div className="flex-1 max-w-xl mx-auto">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search emails..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-stone-100 border border-transparent rounded-lg focus:outline-none focus:bg-white focus:border-stone-300 focus:ring-1 focus:ring-amber-500/30 text-stone-900 placeholder:text-stone-400 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Right: actions + user */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Sync + Classify */}
          <button
            onClick={handleSync}
            disabled={syncLoading}
            title="Sync Inbox"
            className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors cursor-pointer hidden sm:inline-flex items-center gap-1.5"
          >
            {syncLoading ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {syncLoading ? "Syncing" : "Sync"}
            {syncLoading && <span className="inline-flex w-5"><span className="animate-bounce [animation-delay:0ms]">.</span><span className="animate-bounce [animation-delay:150ms]">.</span><span className="animate-bounce [animation-delay:300ms]">.</span></span>}
          </button>
          {classifyLoading ? (
            <div className="relative hidden sm:block">
              <button
                disabled
                className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-100 rounded-lg disabled:opacity-80 inline-flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {classifyLoading === "reclassify" ? "Reclassifying" : "Classifying"}
              </button>
              <div className="absolute top-full right-0 mt-1.5 z-50">
                <div className="bg-zinc-900 text-zinc-100 text-xs px-3 py-2 rounded-lg shadow-xl border border-zinc-700 whitespace-nowrap">
                  {classifyProgress || "Starting..."}
                </div>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => handleClassify(false)}
                title="Classify new threads"
                className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-100 rounded-lg hover:bg-zinc-700 transition-colors cursor-pointer hidden sm:inline-flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Classify
              </button>
              <button
                onClick={() => handleClassify(true)}
                title="Reclassify all threads"
                className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-100 rounded-lg hover:bg-zinc-700 transition-colors cursor-pointer hidden sm:inline-flex items-center gap-1.5"
              >
                Reclassify
              </button>
            </>
          )}

          <div className="w-px h-6 bg-stone-200 mx-1 hidden sm:block" />

          {/* Settings gear */}
          <Link
            href="/inbox/settings"
            className={`p-2 rounded-lg transition-colors ${
              isSettings
                ? "bg-amber-100 text-amber-700"
                : "text-stone-400 hover:text-stone-600 hover:bg-stone-100"
            }`}
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>

          <div className="w-px h-6 bg-stone-200 mx-1" />

          {/* User */}
          <div className="w-8 h-8 rounded-full bg-amber-600 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
            {initials}
          </div>
          <span className="text-sm text-stone-500 hidden lg:inline ml-1 truncate max-w-[180px]">
            {session.user?.email}
          </span>
          <button
            onClick={async () => {
              await fetch("/api/auth/cleanup", { method: "POST" });
              signOut({ callbackUrl: "/" });
            }}
            title="Signs out and clears email data"
            className="px-3 py-1.5 text-sm text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer ml-1 flex-shrink-0"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={(e) => e.preventDefault()}
          className={`${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } md:translate-x-0 fixed md:relative z-50 md:z-auto transition-transform duration-200 h-[calc(100vh-57px)]`}
        >
          <Sidebar />
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <NewBucketModal />
      <OnboardingModal />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-zinc-900 text-white text-sm px-4 py-3 rounded-lg shadow-xl border border-zinc-700 z-[70]">
          {toast}
        </div>
      )}

      {/* Action toast (for bucket moves) */}
      <ActionToastComponent />
    </div>
  );
}

function ActionToastComponent() {
  const { actionToast, setActionToast } = useAppStore();

  if (!actionToast) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-[420px] bg-zinc-900 text-white text-sm px-4 py-3 rounded-lg shadow-xl border border-zinc-700 z-[80] flex items-center gap-3">
      <span className="flex-1">{actionToast.message}</span>
      {actionToast.actionLabel && actionToast.onAction && (
        <button
          onClick={() => actionToast.onAction?.()}
          className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-md hover:bg-amber-500 transition-colors cursor-pointer flex-shrink-0"
        >
          {actionToast.actionLabel}
        </button>
      )}
      <button
        onClick={() => setActionToast(null)}
        className="text-zinc-400 hover:text-white cursor-pointer flex-shrink-0"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
