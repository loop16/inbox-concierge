"use client";

import { useAppStore } from "@/lib/store";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";

export default function OnboardingModal() {
  const { onboardingOpen, setOnboardingOpen } = useAppStore();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"classifying" | "done" | "error">("classifying");
  const [status, setStatus] = useState("Starting classification...");
  const [error, setError] = useState<string | null>(null);

  const hasStarted = useRef(false);

  const runClassify = async () => {
    setStep("classifying");
    setStatus("Classifying your emails...");
    setError(null);

    try {
      const res = await fetch("/api/classify", { method: "POST" });
      if (!res.body) {
        setError("No response from server");
        setStep("error");
        return;
      }

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
            if (evt.phase === "rules") {
              const ruleCount = evt.rulesCaught + (evt.rulesSuggested || 0);
              setStatus(
                ruleCount > 0
                  ? `Rules matched ${ruleCount} emails, AI classifying ${evt.needsLLM} more...`
                  : `AI classifying ${evt.needsLLM} emails...`
              );
            } else if (evt.phase === "llm") {
              setStatus(`AI classifying ${evt.total} emails...`);
            } else if (evt.phase === "llm-progress") {
              setStatus(`Classified ${evt.processed} / ${evt.total}`);
              queryClient.invalidateQueries({ queryKey: ["buckets"] });
              queryClient.invalidateQueries({ queryKey: ["threads"] });
            } else if (evt.phase === "discover") {
              setStatus(evt.message);
            } else if (evt.phase === "discover-created") {
              setStatus(`Created new buckets: ${evt.buckets?.join(", ")}`);
              queryClient.invalidateQueries({ queryKey: ["buckets"] });
            } else if (evt.phase === "complete") {
              // done
            } else if (evt.phase === "error") {
              setError(evt.message);
              setStep("error");
              return;
            }
          } catch { /* ignore malformed */ }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["buckets"] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });

      setStep("done");
      setTimeout(() => {
        setOnboardingOpen(false);
        setStep("classifying");
        hasStarted.current = false;
      }, 1500);
    } catch {
      setError("Classification failed. You can try again from the toolbar.");
      setStep("error");
    }
  };

  // Auto-start when modal opens
  useEffect(() => {
    if (onboardingOpen && !hasStarted.current) {
      hasStarted.current = true;
      runClassify();
    }
    if (!onboardingOpen) {
      hasStarted.current = false;
    }
  }, [onboardingOpen]);

  if (!onboardingOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 border border-stone-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-stone-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-stone-900">Organizing your inbox</h2>
              <p className="text-sm text-stone-500">Rules + AI are classifying your emails</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-8">
          {step === "classifying" && (
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="w-10 h-10 border-3 border-amber-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-stone-600 font-medium text-center">{status}</p>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-stone-900">All set! Your inbox is organized.</p>
            </div>
          )}

          {step === "error" && (
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <p className="text-sm text-red-600 text-center">{error}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { hasStarted.current = false; runClassify(); }}
                  className="px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 cursor-pointer transition-colors"
                >
                  Retry
                </button>
                <button
                  onClick={() => setOnboardingOpen(false)}
                  className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
