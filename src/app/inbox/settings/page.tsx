"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useAppStore } from "@/lib/store";

/* ───── types ───── */

interface ImapAccount {
  id: string;
  label: string;
  email: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface SenderRule {
  id: string;
  senderEmail: string;
  senderDomain: string | null;
  bucket: { id: string; name: string };
  matchCount: number;
  source: string;
  createdAt: string;
}

interface Preset {
  id: string;
  label: string;
  host: string;
  port: number;
  tls: boolean;
  note: string;
}

const PRESETS: Preset[] = [
  { id: "outlook", label: "Outlook", host: "imap-mail.outlook.com", port: 993, tls: true, note: "Warning: Microsoft is deprecating basic auth for Outlook.com/Hotmail. IMAP with password may not work for personal Microsoft accounts. Work/school (Microsoft 365) accounts managed by IT may still work. If login fails, your organization may require OAuth which is not yet supported here." },
  { id: "icloud", label: "iCloud", host: "imap.mail.me.com", port: 993, tls: true, note: "Requires an app-specific password. Go to account.apple.com > Sign-In and Security > App-Specific Passwords" },
  { id: "yahoo", label: "Yahoo", host: "imap.mail.yahoo.com", port: 993, tls: true, note: "Requires an app password. Generate one in Yahoo Account Security settings." },
  { id: "aol", label: "AOL", host: "imap.aol.com", port: 993, tls: true, note: "Requires an app password" },
  { id: "fastmail", label: "Fastmail", host: "imap.fastmail.com", port: 993, tls: true, note: "App password recommended" },
  { id: "protonmail", label: "ProtonMail", host: "127.0.0.1", port: 1143, tls: false, note: "Requires ProtonMail Bridge running locally" },
  { id: "zoho", label: "Zoho", host: "imap.zoho.com", port: 993, tls: true, note: "App-specific password if 2FA enabled" },
  { id: "custom", label: "Other", host: "", port: 993, tls: true, note: "" },
];

/* ───── component ───── */

export default function SettingsPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const { setOnboardingOpen } = useAppStore();

  /* ── IMAP accounts state ── */
  const { data: imapAccounts = [] } = useQuery<ImapAccount[]>({
    queryKey: ["imap-accounts"],
    queryFn: () => fetch("/api/imap/accounts").then((r) => r.json()),
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [imapLabel, setImapLabel] = useState("");
  const [imapEmail, setImapEmail] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [showImapPassword, setShowImapPassword] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [imapTls, setImapTls] = useState(true);
  const [imapTesting, setImapTesting] = useState(false);
  const [imapTestResult, setImapTestResult] = useState<string | null>(null);
  const [imapAdding, setImapAdding] = useState(false);
  const [imapError, setImapError] = useState<string | null>(null);

  const selectPreset = (presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPreset(presetId);
    setImapLabel(preset.label === "Other" ? "" : preset.label);
    setImapHost(preset.host);
    setImapPort(preset.port);
    setImapTls(preset.tls);
    setImapTestResult(null);
    setImapError(null);
  };

  const resetImapForm = () => {
    setShowAddForm(false);
    setSelectedPreset(null);
    setImapLabel("");
    setImapEmail("");
    setImapPassword("");
    setImapHost("");
    setImapPort(993);
    setImapTls(true);
    setImapTesting(false);
    setImapTestResult(null);
    setImapError(null);
  };

  const handleImapTest = async () => {
    setImapTesting(true);
    setImapTestResult(null);
    try {
      const res = await fetch("/api/imap/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: imapHost, port: imapPort, email: imapEmail, password: imapPassword, tls: imapTls }),
      });
      const data = await res.json();
      setImapTestResult(data.success ? `pass:Connected! ${data.mailboxCount} messages in inbox` : `fail:${data.error}`);
    } catch {
      setImapTestResult("fail:Connection error");
    } finally {
      setImapTesting(false);
    }
  };

  const handleImapAdd = async () => {
    setImapAdding(true);
    setImapError(null);
    try {
      const res = await fetch("/api/imap/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: imapLabel, email: imapEmail, imapHost, imapPort, password: imapPassword, imapTls }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImapError(data.error || "Failed to add account");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["imap-accounts"] });
      resetImapForm();
    } catch {
      setImapError("Failed to add account");
    } finally {
      setImapAdding(false);
    }
  };

  const handleImapDelete = async (id: string, label: string) => {
    if (!confirm(`Remove "${label}"? Threads from this account will remain.`)) return;
    await fetch(`/api/imap/accounts/${id}`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: ["imap-accounts"] });
  };

  /* ── Sender rules state ── */
  const { data: senderRules = [] } = useQuery<SenderRule[]>({
    queryKey: ["sender-rules"],
    queryFn: () => fetch("/api/sender-rules").then((r) => r.json()),
  });

  const handleDeleteRule = async (ruleId: string) => {
    await fetch(`/api/sender-rules/${ruleId}`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: ["sender-rules"] });
  };

  const handleClearAllRules = async () => {
    if (!confirm("Delete all learned rules? This cannot be undone.")) return;
    await fetch("/api/sender-rules", { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: ["sender-rules"] });
  };

  const [fullResetting, setFullResetting] = useState(false);

  const handleFullReset = async () => {
    if (!confirm("This will delete ALL your threads, buckets, learned rules, and classifications. You'll start fresh like a new user. Are you sure?")) return;
    if (!confirm("Really? This cannot be undone.")) return;
    setFullResetting(true);
    try {
      await fetch("/api/reset", { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["buckets"] });
      queryClient.invalidateQueries({ queryKey: ["sender-rules"] });
    } finally {
      setFullResetting(false);
    }
  };

  const activePreset = selectedPreset ? PRESETS.find((p) => p.id === selectedPreset) : null;

  /* ── render ── */
  return (
    <div className="max-w-2xl mx-auto p-6 md:p-8 space-y-10">

      {/* ═══ EMAIL ACCOUNTS ═══ */}
      <section>
        <h2 className="text-2xl font-bold text-stone-900 mb-1">Email Accounts</h2>
        <p className="text-sm text-stone-500 mb-6">Manage connected email sources</p>

        {/* Gmail — always shown */}
        <div className="bg-white border border-stone-200 rounded-xl p-4 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-red-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 18h-2V9.25L12 13 6 9.25V18H4V6h1.2l6.8 4.25L18.8 6H20m0-2H4c-1.11 0-2 .89-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2z" />
              </svg>
            </div>
            <div>
              <div className="font-medium text-stone-900 text-sm">Gmail</div>
              <div className="text-xs text-stone-500">{session?.user?.email || "Primary account"}</div>
            </div>
          </div>
          <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">Primary</span>
        </div>

        {/* IMAP accounts */}
        {imapAccounts.map((acc) => (
          <div key={acc.id} className="bg-white border border-stone-200 rounded-xl p-4 mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <div>
                <div className="font-medium text-stone-900 text-sm">{acc.label}</div>
                <div className="text-xs text-stone-500">{acc.email}</div>
                {acc.lastError && (
                  <div className="text-xs text-red-600 mt-0.5">{acc.lastError}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${acc.connected ? "bg-emerald-500" : "bg-red-500"}`} />
              <button
                onClick={() => handleImapDelete(acc.id, acc.label)}
                className="text-xs text-stone-400 hover:text-red-600 cursor-pointer transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        {/* Add account */}
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full py-3 px-4 text-sm font-medium border-2 border-dashed border-stone-300 text-stone-500 rounded-xl hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50/50 transition-all cursor-pointer"
          >
            + Add Email Account
          </button>
        ) : (
          <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-stone-900">Add Email Account</h3>
              <button onClick={resetImapForm} className="text-xs text-stone-400 hover:text-stone-600 cursor-pointer">Cancel</button>
            </div>

            {/* Preset buttons */}
            {!selectedPreset && (
              <div>
                <p className="text-sm text-stone-600 mb-3">Choose your email provider:</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => selectPreset(p.id)}
                      className="py-2.5 px-3 text-sm font-medium border border-stone-300 rounded-lg hover:border-amber-400 hover:bg-amber-50 text-stone-700 transition-all cursor-pointer"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Form fields */}
            {selectedPreset && (
              <div className="space-y-3">
                <button onClick={() => setSelectedPreset(null)} className="text-xs text-amber-600 hover:text-amber-800 cursor-pointer font-medium">&larr; Back to providers</button>

                {activePreset?.note && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                    {activePreset.note}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Label</label>
                    <input type="text" value={imapLabel} onChange={(e) => setImapLabel(e.target.value)} placeholder="e.g. Work Email" className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Email</label>
                    <input type="email" value={imapEmail} onChange={(e) => setImapEmail(e.target.value)} placeholder="you@example.com" className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={showImapPassword ? "text" : "password"}
                      value={imapPassword}
                      onChange={(e) => setImapPassword(e.target.value)}
                      placeholder="App password or account password"
                      className="w-full px-3 py-2 pr-14 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white"
                    />
                    <button onClick={() => setShowImapPassword(!showImapPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-stone-500 hover:text-stone-700 cursor-pointer px-2 py-1 rounded hover:bg-stone-100">
                      {showImapPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <label className="block text-xs font-medium text-stone-600 mb-1">IMAP Host</label>
                    <input type="text" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white font-mono text-xs" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1">Port</label>
                    <input type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white font-mono text-xs" />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={imapTls} onChange={(e) => setImapTls(e.target.checked)} className="rounded" />
                      <span className="text-sm text-stone-700">TLS</span>
                    </label>
                  </div>
                </div>

                {/* Test + Add buttons */}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={handleImapTest}
                    disabled={imapTesting || !imapHost || !imapEmail || !imapPassword}
                    className="px-4 py-2 text-sm font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {imapTesting ? "Testing..." : "Test Connection"}
                  </button>
                  <button
                    onClick={handleImapAdd}
                    disabled={imapAdding || !imapHost || !imapEmail || !imapPassword || !imapLabel}
                    className="px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {imapAdding ? "Adding..." : "Add Account"}
                  </button>
                </div>

                {/* Test result */}
                {imapTestResult && (
                  <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${imapTestResult.startsWith("pass:") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                    <span>{imapTestResult.startsWith("pass:") ? "\u2713" : "\u2717"}</span>
                    <span>{imapTestResult.replace(/^(pass:|fail:)/, "")}</span>
                  </div>
                )}
                {imapError && (
                  <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700">{imapError}</div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ═══ AI BUCKET SETUP ═══ */}
      <section>
        <h2 className="text-2xl font-bold text-stone-900 mb-1">AI Bucket Setup</h2>
        <p className="text-sm text-stone-500 mb-4">
          Let AI analyze your emails and suggest personalized buckets. This replaces your current buckets.
        </p>
        <button
          onClick={() => setOnboardingOpen(true)}
          className="px-5 py-3 text-sm font-medium bg-amber-600 text-white rounded-xl hover:bg-amber-700 cursor-pointer transition-colors inline-flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Suggest Buckets with AI
        </button>
      </section>

      {/* ═══ LEARNED RULES ═══ */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-2xl font-bold text-stone-900">Learned Rules</h2>
          {senderRules.length > 0 && (
            <span className="text-xs font-medium text-stone-400 bg-stone-100 px-2.5 py-1 rounded-full">
              {senderRules.length} rule{senderRules.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <p className="text-sm text-stone-500 mb-6">
          Rules learned from your manual bucket assignments. These fire before AI classification.
        </p>

        {senderRules.length === 0 ? (
          <div className="bg-white border border-stone-200 rounded-xl p-6 text-center">
            <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <p className="text-sm text-stone-500">No rules yet. Move a thread to a different bucket to start learning.</p>
          </div>
        ) : (
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="divide-y divide-stone-100">
              {senderRules.map((rule) => (
                <div key={rule.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-stone-900 truncate">
                      {rule.senderEmail}
                    </div>
                    <div className="text-xs text-stone-400 mt-0.5 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1">
                        → <span className="font-medium text-stone-600">{rule.bucket.name}</span>
                      </span>
                      <span>·</span>
                      <span>{rule.matchCount} match{rule.matchCount !== 1 ? "es" : ""}</span>
                      <span>·</span>
                      <span className="capitalize">{rule.source}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className="text-xs text-stone-400 hover:text-red-600 cursor-pointer transition-colors flex-shrink-0 px-2 py-1 rounded hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-stone-200 px-4 py-3 bg-stone-50">
              <button
                onClick={handleClearAllRules}
                className="text-xs text-red-600 hover:text-red-800 cursor-pointer font-medium"
              >
                Clear All Rules
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ═══ DANGER ZONE ═══ */}
      <section>
        <h2 className="text-2xl font-bold text-red-600 mb-1">Danger Zone</h2>
        <p className="text-sm text-stone-500 mb-4">
          Irreversible actions that will delete your data.
        </p>
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-stone-900 text-sm">Full Reset</div>
              <div className="text-xs text-stone-500 mt-0.5">
                Deletes all threads, buckets, learned rules, and classifications. Starts fresh like a new user.
              </div>
            </div>
            <button
              onClick={handleFullReset}
              disabled={fullResetting}
              className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 cursor-pointer transition-colors flex-shrink-0"
            >
              {fullResetting ? "Resetting..." : "Reset Everything"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
