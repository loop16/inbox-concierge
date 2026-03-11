"use client";

import { useState } from "react";
import { formatRelativeDate } from "@/lib/date";

interface TopEmail {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  date: string;
  bucket: string | null;
  provider: string;
  providerLabel: string;
  aiUrgency: string | null;
  aiRisk: string | null;
  why: string;
}

export default function TopEmails() {
  const [emails, setEmails] = useState<TopEmail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTop = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/top-emails", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to get top emails");
        return;
      }
      setEmails(data.top);
      setCollapsed(false);
    } catch {
      setError("Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  // Not loaded yet — show trigger button
  if (emails === null && !loading) {
    return (
      <div className="px-5 py-3 border-b border-stone-200 bg-gradient-to-r from-amber-50/80 to-stone-50">
        <button
          onClick={fetchTop}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white border border-amber-200 text-amber-800 rounded-xl hover:bg-amber-50 hover:border-amber-300 transition-all cursor-pointer shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          AI Top 5 — What needs my attention?
        </button>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="px-5 py-4 border-b border-stone-200 bg-gradient-to-r from-amber-50/80 to-stone-50">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-stone-500">Scanning your inbox for what matters most...</span>
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="px-5 py-3 border-b border-stone-200 bg-red-50/50">
        <div className="flex items-center gap-3">
          <span className="text-sm text-red-600">{error}</span>
          <button onClick={fetchTop} className="text-xs text-red-500 underline cursor-pointer">Retry</button>
          <button onClick={() => { setEmails(null); setError(null); }} className="text-xs text-stone-400 cursor-pointer">Dismiss</button>
        </div>
      </div>
    );
  }

  // Empty
  if (emails && emails.length === 0) {
    return (
      <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-400">No priority emails found. You&apos;re all caught up!</span>
          <button onClick={() => setEmails(null)} className="text-xs text-stone-400 hover:text-stone-600 cursor-pointer">Dismiss</button>
        </div>
      </div>
    );
  }

  // Results
  return (
    <div className="border-b border-amber-200/60 bg-gradient-to-b from-amber-50/60 to-white">
      {/* Header */}
      <div className="px-5 py-2.5 flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 cursor-pointer"
        >
          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          <span className="text-sm font-semibold text-stone-800">AI Top 5</span>
          <svg className={`w-3.5 h-3.5 text-stone-400 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchTop}
            className="text-xs text-amber-600 hover:text-amber-800 cursor-pointer font-medium"
          >
            Refresh
          </button>
          <button
            onClick={() => setEmails(null)}
            className="text-xs text-stone-400 hover:text-stone-600 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>

      {/* Cards */}
      {!collapsed && emails && (
        <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-5 gap-2">
          {emails.map((email, i) => (
            <div
              key={email.id}
              className={`relative bg-white rounded-xl border p-3 transition-all hover:shadow-md hover:-translate-y-0.5 cursor-default ${
                email.aiUrgency === "high" || email.aiRisk === "high"
                  ? "border-red-200 shadow-sm"
                  : "border-stone-200"
              }`}
            >
              {/* Rank badge */}
              <div className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-amber-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm">
                {i + 1}
              </div>

              {/* Risk/urgency indicator */}
              {(email.aiUrgency === "high" || email.aiRisk === "high") && (
                <div className="absolute top-2 right-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 block animate-pulse" />
                </div>
              )}

              <div className="mt-1">
                <p className="text-xs font-semibold text-stone-900 line-clamp-2 leading-snug">
                  {email.subject}
                </p>
                <p className="text-[11px] text-stone-500 mt-1 truncate">
                  {email.sender}
                </p>
                <p className="text-[11px] text-amber-700 mt-1.5 line-clamp-2 leading-snug italic">
                  {email.why}
                </p>
                <div className="flex items-center justify-between mt-2">
                  {email.bucket && (
                    <span className="text-[10px] text-stone-400 truncate">
                      {email.bucket}
                    </span>
                  )}
                  <span className="text-[10px] text-stone-400 flex-shrink-0 ml-auto">
                    {formatRelativeDate(email.date)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
