"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { getBucketColor } from "@/lib/colors";
import { formatRelativeDate } from "@/lib/date";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";

interface Bucket {
  id: string;
  name: string;
  sortOrder: number;
}

interface Thread {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  date: string;
  confidence: number | null;
  reason: string | null;
  manualOverride: boolean;
  provider: string;
  providerLabel: string;
  bucket: Bucket | null;
  aiCategory: string | null;
  aiActionability: string | null;
  aiUrgency: string | null;
  aiRisk: string | null;
  aiSenderType: string | null;
}

const PROVIDER_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  Gmail:      { bg: "bg-red-50",     text: "text-red-600",     border: "border-red-200",     dot: "bg-red-500" },
  iCloud:     { bg: "bg-sky-50",     text: "text-sky-600",     border: "border-sky-200",     dot: "bg-sky-500" },
  Outlook:    { bg: "bg-indigo-50",  text: "text-indigo-600",  border: "border-indigo-200",  dot: "bg-indigo-500" },
  Yahoo:      { bg: "bg-violet-50",  text: "text-violet-600",  border: "border-violet-200",  dot: "bg-violet-500" },
  Fastmail:   { bg: "bg-cyan-50",    text: "text-cyan-600",    border: "border-cyan-200",    dot: "bg-cyan-500" },
  ProtonMail: { bg: "bg-fuchsia-50", text: "text-fuchsia-600", border: "border-fuchsia-200", dot: "bg-fuchsia-500" },
  Zoho:       { bg: "bg-orange-50",  text: "text-orange-600",  border: "border-orange-200",  dot: "bg-orange-500" },
  AOL:        { bg: "bg-teal-50",    text: "text-teal-600",    border: "border-teal-200",    dot: "bg-teal-500" },
};

const FALLBACK_COLORS = [
  { bg: "bg-emerald-50",  text: "text-emerald-600",  border: "border-emerald-200",  dot: "bg-emerald-500" },
  { bg: "bg-pink-50",     text: "text-pink-600",     border: "border-pink-200",     dot: "bg-pink-500" },
  { bg: "bg-lime-50",     text: "text-lime-600",     border: "border-lime-200",     dot: "bg-lime-500" },
  { bg: "bg-amber-50",    text: "text-amber-600",    border: "border-amber-200",    dot: "bg-amber-500" },
];

function getProviderColor(label: string, index: number) {
  return PROVIDER_COLORS[label] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function classificationSource(thread: Thread): string {
  if (thread.manualOverride) return "Manual";
  if (!thread.reason) return "Unclassified";
  if (thread.reason.startsWith("Sender rule:")) return "Sender rule";
  if (thread.reason.startsWith("Domain rule:")) return "Domain rule";
  if (thread.reason === "Manually assigned") return "Manual";
  if (thread.confidence === 1.0) return "Rule";
  return "AI";
}

export default function ThreadList() {
  const { selectedBucketId, selectedProvider, searchQuery, setActionToast, setDraggingThreadId } = useAppStore();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(new Set());
  const [dropdownThreadId, setDropdownThreadId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const wasDragging = useRef(false);

  const { data: threads = [], isLoading } = useQuery<Thread[]>({
    queryKey: ["threads", selectedBucketId, selectedProvider],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedBucketId) params.set("bucketId", selectedBucketId);
      if (selectedProvider) params.set("provider", selectedProvider);
      const qs = params.toString();
      return fetch(`/api/threads${qs ? `?${qs}` : ""}`).then((r) => r.json());
    },
  });

  const { data: buckets = [] } = useQuery<Bucket[]>({
    queryKey: ["buckets"],
    queryFn: () => fetch("/api/buckets").then((r) => r.json()),
  });

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownThreadId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleMoveBucket = useCallback(async (threadId: string, bucketId: string) => {
    setDropdownThreadId(null);

    // Optimistic update
    queryClient.setQueryData<Thread[]>(
      ["threads", selectedBucketId, selectedProvider],
      (old) => old?.map((t) =>
        t.id === threadId
          ? { ...t, bucket: buckets.find((b) => b.id === bucketId) || t.bucket, manualOverride: true, confidence: 1.0, reason: "Manually assigned" }
          : t
      )
    );

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
          message: `Moved to ${data.bucketName}. Rule learned for ${data.senderEmail}`,
        });
        setTimeout(() => {
          useAppStore.setState((s) => s.actionToast?.id === threadId ? { actionToast: null } : {});
        }, 4000);
      }
    } catch {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    }
  }, [queryClient, selectedBucketId, selectedProvider, buckets, setActionToast]);

  // Collect unique sources with stable ordering
  const sources = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of threads) {
      if (!seen.has(t.provider)) seen.set(t.provider, t.providerLabel);
    }
    return Array.from(seen.entries()).map(([provider, label]) => ({ provider, label }));
  }, [threads]);

  // Build a label→index map for fallback colors
  const labelIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const s of sources) {
      if (!PROVIDER_COLORS[s.label]) {
        map.set(s.label, idx++);
      }
    }
    return map;
  }, [sources]);

  const filtered = useMemo(() => {
    let result = threads;
    if (hiddenSources.size > 0) {
      result = result.filter((t) => !hiddenSources.has(t.provider));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.sender.toLowerCase().includes(q) ||
          t.senderEmail.toLowerCase().includes(q) ||
          t.snippet.toLowerCase().includes(q) ||
          t.bucket?.name.toLowerCase().includes(q) ||
          t.providerLabel.toLowerCase().includes(q)
      );
    }
    return result;
  }, [threads, searchQuery, hiddenSources]);

  const toggleSource = (provider: string) => {
    setHiddenSources((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-1 p-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-stone-200 p-4 animate-pulse">
            <div className="h-4 bg-stone-200 rounded w-3/4 mb-2.5" />
            <div className="h-3 bg-stone-100 rounded w-1/3 mb-2" />
            <div className="h-3 bg-stone-100 rounded w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </div>
        <p className="text-stone-400 text-sm">
          No threads yet. Click &quot;Sync&quot; to get started.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Source filter pills */}
      {sources.length > 1 && (
        <div className="px-5 py-2.5 border-b border-stone-200 bg-white flex items-center gap-2 overflow-x-auto">
          <span className="text-xs text-stone-400 font-medium flex-shrink-0 mr-1">Sources:</span>
          {sources.map((s) => {
            const active = !hiddenSources.has(s.provider);
            const pc = getProviderColor(s.label, labelIndexMap.get(s.label) ?? 0);
            const count = threads.filter((t) => t.provider === s.provider).length;
            return (
              <button
                key={s.provider}
                onClick={() => toggleSource(s.provider)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer flex-shrink-0 border ${
                  active
                    ? `${pc.bg} ${pc.text} ${pc.border}`
                    : "bg-stone-100 text-stone-400 border-stone-200 line-through"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${active ? pc.dot : "bg-stone-300"}`} />
                {s.label}
                <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* No results after filter */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-stone-400 text-sm">
            {searchQuery ? `No results for "${searchQuery}"` : "No threads match the selected sources"}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-stone-200/70">
          {filtered.map((thread) => {
            const expanded = expandedId === thread.id;
            const color = thread.bucket
              ? getBucketColor(thread.bucket.sortOrder)
              : null;
            const pc = getProviderColor(thread.providerLabel, labelIndexMap.get(thread.providerLabel) ?? 0);
            const showDropdown = dropdownThreadId === thread.id;

            return (
              <div
                key={thread.id}
                draggable
                onDragStart={(e) => {
                  wasDragging.current = true;
                  // Set data on dataTransfer AND store
                  e.dataTransfer.setData("text/plain", thread.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingThreadId(thread.id);
                  // Custom drag image
                  const ghost = document.createElement("div");
                  ghost.textContent = thread.subject.slice(0, 40);
                  ghost.style.cssText = "position:fixed;top:-100px;padding:8px 12px;background:#1c1917;color:#fff;border-radius:8px;font-size:13px;max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:9999";
                  document.body.appendChild(ghost);
                  e.dataTransfer.setDragImage(ghost, 0, 0);
                  requestAnimationFrame(() => document.body.removeChild(ghost));
                }}
                onDragEnd={() => {
                  // Delay clearing so onDrop reads it first
                  setTimeout(() => {
                    setDraggingThreadId(null);
                    wasDragging.current = false;
                  }, 100);
                }}
                onClick={() => {
                  if (wasDragging.current) return;
                  setExpandedId(expanded ? null : thread.id);
                }}
                className={`px-5 py-3.5 hover:bg-white cursor-grab active:cursor-grabbing transition-colors select-none border-l-[3px] ${
                  thread.aiUrgency === "high"
                    ? "border-l-red-400"
                    : thread.aiUrgency === "medium"
                    ? "border-l-amber-400"
                    : "border-l-transparent"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-stone-900 truncate text-sm">
                        {thread.subject}
                      </span>
                      {/* Bucket pill — clickable to open dropdown */}
                      <div className="relative flex-shrink-0" ref={showDropdown ? dropdownRef : undefined}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDropdownThreadId(showDropdown ? null : thread.id);
                          }}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all cursor-pointer border ${
                            color
                              ? `${color.bg} ${color.text} border-transparent hover:border-stone-300`
                              : "bg-stone-100 text-stone-500 border-stone-200 hover:border-stone-400"
                          }`}
                          title={thread.reason || "Click to reassign bucket"}
                        >
                          {thread.bucket?.name || "Unclassified"}
                          <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {/* Bucket dropdown */}
                        {showDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-xl py-1 z-50 min-w-[180px] max-h-64 overflow-y-auto">
                            {buckets.map((b, i) => {
                              const bc = getBucketColor(i);
                              const isCurrent = thread.bucket?.id === b.id;
                              return (
                                <button
                                  key={b.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isCurrent) handleMoveBucket(thread.id, b.id);
                                    else setDropdownThreadId(null);
                                  }}
                                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                                    isCurrent
                                      ? "bg-amber-50 text-amber-900 font-medium"
                                      : "text-stone-700 hover:bg-stone-50"
                                  }`}
                                >
                                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${bc.dot}`} />
                                  {b.name}
                                  {isCurrent && (
                                    <svg className="w-3.5 h-3.5 ml-auto text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 border ${pc.bg} ${pc.text} ${pc.border}`}>
                        {thread.providerLabel}
                      </span>
                      {thread.aiRisk === "high" && (
                        <span
                          className="flex-shrink-0 text-amber-600"
                          title="Protected: security/financial signals detected"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                          </svg>
                        </span>
                      )}
                      {thread.confidence !== null && (
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            thread.confidence >= 0.8
                              ? "bg-emerald-500"
                              : thread.confidence >= 0.5
                              ? "bg-amber-500"
                              : "bg-red-500"
                          }`}
                          title={`Confidence: ${Math.round(thread.confidence * 100)}%`}
                        />
                      )}
                    </div>
                    <div className="text-sm text-stone-500 mt-0.5">
                      {thread.sender}
                    </div>
                    {!expanded && (
                      <div className="text-sm text-stone-400 mt-0.5 truncate">
                        {thread.snippet}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-stone-400 whitespace-nowrap pt-0.5">
                    {formatRelativeDate(thread.date)}
                  </span>
                </div>

                {expanded && (
                  <div className="mt-3 pl-0 space-y-2 text-sm border-t border-stone-200 pt-3">
                    <p className="text-stone-600">{thread.snippet}</p>
                    <p className="text-stone-400">
                      From: {thread.sender} &lt;{thread.senderEmail}&gt;
                      <span className={`ml-2 ${pc.text}`}>via {thread.providerLabel}</span>
                    </p>
                    <div className="flex items-center gap-3 text-xs text-stone-400">
                      <span>
                        Classified by: <span className="font-medium text-stone-600">{classificationSource(thread)}</span>
                      </span>
                      {thread.reason && thread.reason !== "Manually assigned" && (
                        <span className="text-stone-400">{thread.reason}</span>
                      )}
                    </div>
                    {/* Dimensional classification card */}
                    {thread.aiCategory && (
                      <div className="mt-2 bg-stone-50 rounded-lg px-3 py-2 text-xs text-stone-500 space-y-1 border border-stone-200/70">
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          <span>Category: <span className="font-medium text-stone-700">{thread.aiCategory}</span></span>
                          <span>Sender: <span className="font-medium text-stone-700">{thread.aiSenderType}</span></span>
                          <span>
                            Urgency:{" "}
                            <span className={`font-medium ${
                              thread.aiUrgency === "high" ? "text-red-600" : thread.aiUrgency === "medium" ? "text-amber-600" : "text-stone-700"
                            }`}>{thread.aiUrgency}</span>
                          </span>
                          <span>
                            Action:{" "}
                            <span className={`font-medium ${
                              thread.aiActionability === "high" ? "text-red-600" : thread.aiActionability === "low" ? "text-amber-600" : "text-stone-700"
                            }`}>{thread.aiActionability}</span>
                          </span>
                          <span>
                            Risk:{" "}
                            <span className={`font-medium ${
                              thread.aiRisk === "high" ? "text-red-600" : thread.aiRisk === "medium" ? "text-amber-600" : "text-stone-700"
                            }`}>{thread.aiRisk}</span>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
