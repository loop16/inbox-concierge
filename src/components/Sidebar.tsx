"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { getBucketColor } from "@/lib/colors";
import { useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

interface Bucket {
  id: string;
  name: string;
  description: string | null;
  examples: string | null;
  isDefault: boolean;
  sortOrder: number;
  _count: { threads: number };
}

interface ImapAccount {
  id: string;
  label: string;
  email: string;
  connected: boolean;
}

export default function Sidebar() {
  const queryClient = useQueryClient();
  const {
    selectedBucketId,
    setSelectedBucketId,
    selectedProvider,
    setSelectedProvider,
    setNewBucketOpen,
    draggingThreadId,
    setActionToast,
    failedClassifyCount,
    setFailedClassifyCount,
    retryingClassify,
    setRetryingClassify,
  } = useAppStore();

  const [resetting, setResetting] = useState(false);

  const handleResetBuckets = async () => {
    if (!confirm("Reset all buckets to defaults? All threads will become unclassified.")) return;
    setResetting(true);
    try {
      await fetch("/api/buckets", { method: "DELETE" });
      setSelectedBucketId(null);
      queryClient.invalidateQueries({ queryKey: ["buckets"] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    } finally {
      setResetting(false);
    }
  };

  const pathname = usePathname();
  const router = useRouter();

  const [menuBucket, setMenuBucket] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const [deleteToast, setDeleteToast] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const handleDrop = async (e: React.DragEvent, bucketId: string, bucketName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    // Get thread ID from store (more reliable than dataTransfer across containers)
    const threadId = useAppStore.getState().draggingThreadId;
    if (!threadId) return;

    try {
      const res = await fetch(`/api/threads/${threadId}/bucket`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId }),
      });
      const data = await res.json();

      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["buckets"] });

      if (data.otherThreadsFromSender > 0) {
        setActionToast({
          id: threadId,
          message: `Moved to ${data.bucketName}. ${data.otherThreadsFromSender} more from ${data.senderEmail}`,
          actionLabel: "Apply to all",
          onAction: async () => {
            const applyRes = await fetch(`/api/threads/${threadId}/bucket/apply-to-sender`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bucketId }),
            });
            const applyData = await applyRes.json();
            setActionToast({
              id: "applied",
              message: `Moved ${applyData.moved} more threads from this sender`,
            });
            setTimeout(() => setActionToast(null), 4000);
            queryClient.invalidateQueries({ queryKey: ["threads"] });
            queryClient.invalidateQueries({ queryKey: ["buckets"] });
          },
        });
        setTimeout(() => {
          useAppStore.setState((s) => s.actionToast?.id === threadId ? { actionToast: null } : {});
        }, 8000);
      } else {
        setActionToast({
          id: threadId,
          message: `Moved to ${bucketName}. Rule learned for ${data.senderEmail}`,
        });
        setTimeout(() => {
          useAppStore.setState((s) => s.actionToast?.id === threadId ? { actionToast: null } : {});
        }, 4000);
      }
    } catch {
      // silent fail, queries will refetch
    }
  };

  const { data: buckets = [], isLoading } = useQuery<Bucket[]>({
    queryKey: ["buckets"],
    queryFn: () => fetch("/api/buckets").then((r) => r.json()),
  });

  const { data: imapAccounts = [] } = useQuery<ImapAccount[]>({
    queryKey: ["imap-accounts"],
    queryFn: () => fetch("/api/imap/accounts").then((r) => r.json()),
  });

  const totalThreads = buckets.reduce((sum, b) => sum + b._count.threads, 0);

  const handleRetryFailed = async () => {
    setRetryingClassify(true);
    try {
      const res = await fetch("/api/classify", { method: "POST" });
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line);
              if (evt.phase === "llm-progress" || evt.phase === "complete") {
                queryClient.invalidateQueries({ queryKey: ["buckets"] });
                queryClient.invalidateQueries({ queryKey: ["threads"] });
              }
              if (evt.phase === "complete") {
                setFailedClassifyCount(evt.failed || 0);
              }
            } catch { /* ignore */ }
          }
        }
      }
    } finally {
      setRetryingClassify(false);
      queryClient.invalidateQueries({ queryKey: ["buckets"] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    }
  };

  useEffect(() => {
    const handler = () => setMenuBucket(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const goToInbox = () => {
    if (pathname !== "/inbox") router.push("/inbox");
  };

  const handleContextMenu = (e: React.MouseEvent, bucketId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuBucket(bucketId);
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleEditBucket = (bucket: Bucket) => {
    setMenuBucket(null);
    useAppStore.setState({
      newBucketOpen: true,
      editingBucket: { id: bucket.id, name: bucket.name, description: bucket.description || "", examples: bucket.examples || "" },
    });
  };

  const handleDeleteBucket = async (bucket: Bucket) => {
    setMenuBucket(null);
    if (bucket.isDefault) {
      setDeleteToast("Cannot delete default buckets");
      setTimeout(() => setDeleteToast(null), 3000);
      return;
    }
    if (!confirm(`Delete "${bucket.name}"? Threads will become unclassified.`)) return;

    const res = await fetch(`/api/buckets/${bucket.id}`, { method: "DELETE" });
    if (res.ok) {
      if (selectedBucketId === bucket.id) setSelectedBucketId(null);
      queryClient.invalidateQueries({ queryKey: ["buckets"] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    }
  };

  const activeBucket = menuBucket ? buckets.find((b) => b.id === menuBucket) : null;

  return (
    <aside
      className="w-72 bg-white border-r border-stone-200 flex flex-col h-full relative"
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => e.preventDefault()}
    >
      <div className="p-4 flex-1 overflow-y-auto">
        {/* Drag hint */}
        {draggingThreadId && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-medium text-center animate-pulse">
            Drop on a bucket to move
          </div>
        )}
        {/* Retry banner for failed classifications */}
        {failedClassifyCount > 0 && (
          <div className="mb-3 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {retryingClassify ? (
                  <svg className="w-3.5 h-3.5 animate-spin text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                )}
                <span className="text-xs text-amber-800 font-medium">
                  {retryingClassify ? "Retrying..." : `${failedClassifyCount} emails unclassified`}
                </span>
              </div>
              <button
                onClick={handleRetryFailed}
                disabled={retryingClassify}
                className="text-xs font-semibold text-amber-700 hover:text-amber-900 cursor-pointer disabled:opacity-50 flex-shrink-0 px-2 py-1 rounded hover:bg-amber-100 transition-colors"
              >
                {retryingClassify ? "" : "Retry"}
              </button>
            </div>
          </div>
        )}

        {/* Buckets */}
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 px-3 mb-2">
          Buckets
        </p>
        <nav className="space-y-0.5" onDragOver={(e) => e.preventDefault()} onDragEnter={(e) => e.preventDefault()}>
          <button
            onClick={() => {
              setSelectedBucketId(null);
              setSelectedProvider(null);
              goToInbox();
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer focus:outline-none ${
              selectedBucketId === null && selectedProvider === null && pathname === "/inbox"
                ? "bg-amber-50 text-amber-900"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            <span>All</span>
            <span className="text-xs text-stone-400">{totalThreads}</span>
          </button>

          {isLoading ? (
            <div className="space-y-1 pt-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-9 bg-stone-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            buckets.map((bucket, i) => {
              const color = getBucketColor(i);
              const isDropTarget = draggingThreadId && dropTargetId === bucket.id;
              return (
                <div
                  key={bucket.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedBucketId(bucket.id);
                    setSelectedProvider(null);
                    goToInbox();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setSelectedBucketId(bucket.id);
                      setSelectedProvider(null);
                      goToInbox();
                    }
                  }}
                  onContextMenu={(e) => handleContextMenu(e, bucket.id)}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDropTargetId(bucket.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dropTargetId !== bucket.id) setDropTargetId(bucket.id);
                  }}
                  onDragLeave={(e) => {
                    // Only clear if leaving the element entirely (not entering a child)
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDropTargetId(null);
                    }
                  }}
                  onDrop={(e) => handleDrop(e, bucket.id, bucket.name)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all cursor-pointer focus:outline-none select-none ${
                    isDropTarget
                      ? "bg-amber-100 text-amber-900 ring-2 ring-amber-400 font-medium scale-[1.02]"
                      : selectedBucketId === bucket.id
                      ? "bg-amber-50 text-amber-900 font-medium"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color.dot}`} />
                    <span className="truncate">{bucket.name}</span>
                  </div>
                  <span className="text-xs text-stone-400 ml-2">
                    {bucket._count.threads}
                  </span>
                </div>
              );
            })
          )}
        </nav>

        {/* Sources */}
        {imapAccounts.length > 0 && (
          <div className="mt-6">
            <button
              onClick={() => setSourcesOpen(!sourcesOpen)}
              className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400 px-3 mb-2 cursor-pointer hover:text-stone-600 w-full"
            >
              <svg className={`w-3 h-3 transition-transform ${sourcesOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Sources
            </button>
            {sourcesOpen && (
              <nav className="space-y-0.5">
                <button
                  onClick={() => {
                    setSelectedProvider(null);
                    goToInbox();
                  }}
                  className={`w-full flex items-center px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer focus:outline-none ${
                    selectedProvider === null
                      ? "bg-stone-100 text-stone-900 font-medium"
                      : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
                  }`}
                >
                  All Sources
                </button>
                <button
                  onClick={() => {
                    setSelectedProvider("gmail");
                    goToInbox();
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer focus:outline-none ${
                    selectedProvider === "gmail"
                      ? "bg-stone-100 text-stone-900 font-medium"
                      : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  Gmail
                </button>
                {imapAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => {
                      setSelectedProvider(acc.id);
                      goToInbox();
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer focus:outline-none ${
                      selectedProvider === acc.id
                        ? "bg-stone-100 text-stone-900 font-medium"
                        : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${acc.connected ? "bg-sky-500" : "bg-stone-400"}`} />
                    {acc.label}
                  </button>
                ))}
              </nav>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-stone-200 p-4 space-y-2">
        <button
          onClick={() => useAppStore.getState().setOnboardingOpen(true)}
          className="w-full py-2.5 px-4 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors cursor-pointer focus:outline-none inline-flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          AI Suggest Buckets
        </button>
        <button
          onClick={() => {
            useAppStore.setState({ editingBucket: null });
            setNewBucketOpen(true);
          }}
          className="w-full py-2.5 px-4 text-sm font-medium border border-stone-300 text-stone-600 rounded-lg hover:bg-stone-50 hover:text-stone-800 transition-colors cursor-pointer focus:outline-none"
        >
          + New Bucket
        </button>
        <button
          onClick={handleResetBuckets}
          disabled={resetting}
          className="w-full py-2 px-4 text-xs text-stone-400 hover:text-red-600 transition-colors cursor-pointer focus:outline-none disabled:opacity-50"
        >
          {resetting ? "Resetting..." : "Reset Buckets to Defaults"}
        </button>
      </div>

      {/* Context menu */}
      {menuBucket && activeBucket && (
        <div
          ref={menuRef}
          className="fixed bg-white border border-stone-200 rounded-lg shadow-xl py-1 z-[60] min-w-[140px]"
          style={{ left: menuPos.x, top: menuPos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleEditBucket(activeBucket)}
            className="w-full text-left px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 cursor-pointer"
          >
            Edit
          </button>
          <button
            onClick={() => handleDeleteBucket(activeBucket)}
            className={`w-full text-left px-4 py-2 text-sm hover:bg-stone-50 cursor-pointer ${
              activeBucket.isDefault ? "text-stone-400" : "text-red-600"
            }`}
          >
            Delete
          </button>
        </div>
      )}

      {/* Delete toast */}
      {deleteToast && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-zinc-900 text-white text-sm px-4 py-3 rounded-lg shadow-xl border border-zinc-700 z-[70]">
          {deleteToast}
        </div>
      )}
    </aside>
  );
}
