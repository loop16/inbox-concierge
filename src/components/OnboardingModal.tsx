"use client";

import { useAppStore } from "@/lib/store";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import CinematicLoader from "./CinematicLoader";

interface SuggestedBucket {
  name: string;
  description: string;
  examples: string;
  enabled: boolean;
}

export default function OnboardingModal() {
  const { onboardingOpen, setOnboardingOpen } = useAppStore();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"loading" | "review" | "applying" | "done" | "error">("loading");
  const [suggestions, setSuggestions] = useState<SuggestedBucket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [applyStatus, setApplyStatus] = useState("");

  const hasFetched = useRef(false);

  const fetchSuggestions = async () => {
    setStep("loading");
    setError(null);
    try {
      const res = await fetch("/api/suggest-buckets", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to get suggestions");
        setStep("error");
        return;
      }

      // Filter out suggestions that duplicate existing default bucket names
      const bucketsRes = await fetch("/api/buckets");
      const existingBuckets = await bucketsRes.json();
      const existingNames = new Set(
        existingBuckets.map((b: { name: string }) => b.name.toLowerCase())
      );

      const newSuggestions = data.suggestions
        .filter((s: { name: string }) => !existingNames.has(s.name.toLowerCase()))
        .map((s: { name: string; description: string; examples: string }) => ({
          ...s,
          enabled: true,
        }));

      setSuggestions(newSuggestions);
      setStep("review");
    } catch {
      setError("Failed to connect. Check your AI provider in Settings.");
      setStep("error");
    }
  };

  const handleAccept = async () => {
    const enabled = suggestions.filter((s) => s.enabled);

    setStep("applying");
    setApplyStatus("Creating buckets");

    try {
      // Add new AI-suggested buckets alongside defaults (don't delete defaults)
      if (enabled.length > 0) {
        for (const s of enabled) {
          await fetch("/api/buckets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: s.name,
              description: s.description,
              examples: s.examples,
            }),
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["buckets"] });

      // Classify with all buckets (defaults + new ones)
      setApplyStatus("Classifying emails");
      const classifyRes = await fetch("/api/classify", { method: "POST" });
      if (classifyRes.body) {
        const reader = classifyRes.body.getReader();
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
              if (evt.phase === "llm-progress") {
                setApplyStatus(`Classifying ${evt.processed} of ${evt.total}`);
                queryClient.invalidateQueries({ queryKey: ["buckets"] });
                queryClient.invalidateQueries({ queryKey: ["threads"] });
              } else if (evt.phase === "rules") {
                const ruleCount = evt.rulesCaught || 0;
                setApplyStatus(
                  ruleCount > 0
                    ? `Rules matched ${ruleCount} — AI classifying ${evt.needsLLM}`
                    : `AI classifying ${evt.needsLLM} emails`
                );
              } else if (evt.phase === "llm") {
                setApplyStatus(`AI classifying ${evt.total} emails`);
              } else if (evt.phase === "discover") {
                setApplyStatus(evt.message);
              } else if (evt.phase === "discover-created") {
                setApplyStatus(`New buckets: ${evt.buckets?.join(", ")}`);
                queryClient.invalidateQueries({ queryKey: ["buckets"] });
              }
            } catch { /* ignore malformed */ }
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["buckets"] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });

      setStep("done");
      setTimeout(() => {
        setOnboardingOpen(false);
        setStep("loading");
        setSuggestions([]);
        setEditingIdx(null);
        hasFetched.current = false;
      }, 1500);
    } catch {
      setError("Something went wrong. You can set up buckets manually.");
      setStep("error");
    }
  };

  // Auto-start fetching when modal opens — always reset state on reopen
  useEffect(() => {
    if (onboardingOpen && !hasFetched.current) {
      hasFetched.current = true;
      setStep("loading");
      setSuggestions([]);
      setEditingIdx(null);
      setError(null);
      fetchSuggestions();
    }
    if (!onboardingOpen) {
      hasFetched.current = false;
    }
  }, [onboardingOpen]);

  if (!onboardingOpen) return null;

  const cinematicActive = step === "loading" || step === "applying";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 border border-stone-200 overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-stone-100 flex-shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-stone-900">Smart Setup</h2>
              <p className="text-sm text-stone-500">
                {cinematicActive
                  ? step === "loading"
                    ? "Analyzing your inbox..."
                    : "Setting up your inbox..."
                  : step === "review"
                    ? "AI found new categories for your inbox"
                    : "Your inbox is organized"}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Inline cinematic animation — always mounted, controlled by isLoading */}
          <CinematicLoader
            isLoading={cinematicActive}
            inline
            dotCount={80}
            message={
              cinematicActive
                ? step === "loading"
                  ? "Analyzing your inbox"
                  : applyStatus
                : undefined
            }
          />

          {/* Error */}
          {step === "error" && (
            <div className="py-8 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-red-50 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <p className="text-sm text-red-600">{error}</p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => { setError(null); hasFetched.current = false; fetchSuggestions(); }}
                  className="px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 cursor-pointer transition-colors"
                >
                  Retry
                </button>
                <button
                  onClick={() => setOnboardingOpen(false)}
                  className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700 cursor-pointer"
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* Review suggestions */}
          {step === "review" && (
            <div className="space-y-2">
              {suggestions.length > 0 ? (
                <>
                  <p className="text-xs text-stone-400 mb-3">
                    AI suggests these additional buckets for your inbox. Your default buckets (Finance, Newsletters, etc.) are kept. Toggle to include.
                  </p>
                  {suggestions.map((s, i) => (
                    <div
                      key={i}
                      className={`rounded-xl border-2 p-3 transition-all ${
                        s.enabled
                          ? "border-amber-200 bg-amber-50/30"
                          : "border-stone-200 bg-stone-50 opacity-50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() =>
                            setSuggestions((prev) =>
                              prev.map((ss, j) => (j === i ? { ...ss, enabled: !ss.enabled } : ss))
                            )
                          }
                          className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center cursor-pointer transition-colors ${
                            s.enabled
                              ? "bg-amber-600 border-amber-600 text-white"
                              : "border-stone-300 bg-white"
                          }`}
                        >
                          {s.enabled && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          {editingIdx === i ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={s.name}
                                onChange={(e) =>
                                  setSuggestions((prev) =>
                                    prev.map((ss, j) => (j === i ? { ...ss, name: e.target.value } : ss))
                                  )
                                }
                                className="w-full px-2 py-1 text-sm font-semibold border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                                autoFocus
                              />
                              <textarea
                                value={s.description}
                                onChange={(e) =>
                                  setSuggestions((prev) =>
                                    prev.map((ss, j) => (j === i ? { ...ss, description: e.target.value } : ss))
                                  )
                                }
                                rows={2}
                                className="w-full px-2 py-1 text-xs border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white resize-none"
                              />
                              <button
                                onClick={() => setEditingIdx(null)}
                                className="text-xs text-amber-600 font-medium cursor-pointer"
                              >
                                Done editing
                              </button>
                            </div>
                          ) : (
                            <div onClick={() => s.enabled && setEditingIdx(i)} className={s.enabled ? "cursor-pointer" : ""}>
                              <div className="font-semibold text-sm text-stone-900">{s.name}</div>
                              <div className="text-xs text-stone-500 mt-0.5">{s.description}</div>
                              {s.examples && (
                                <div className="text-xs text-stone-400 mt-1 italic">{s.examples}</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-sm text-stone-500">Your default buckets already cover everything. Ready to classify!</p>
                </div>
              )}
            </div>
          )}

          {/* Done */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-stone-900">All set! Your inbox is organized.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === "review" && (
          <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-between flex-shrink-0">
            <button
              onClick={() => setOnboardingOpen(false)}
              className="text-sm text-stone-400 hover:text-stone-600 cursor-pointer"
            >
              Skip for now
            </button>
            <button
              onClick={handleAccept}
              className="px-5 py-2.5 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 cursor-pointer transition-colors inline-flex items-center gap-2"
            >
              {suggestions.filter((s) => s.enabled).length > 0 ? (
                <>
                  Accept & Classify
                  <span className="text-amber-200 text-xs">
                    ({suggestions.filter((s) => s.enabled).length} new)
                  </span>
                </>
              ) : (
                "Classify Now"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
