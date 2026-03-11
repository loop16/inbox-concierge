"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useRef, useEffect } from "react";
import { formatRelativeDate } from "@/lib/date";

/* ─── types ─── */

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
  bucket: { id: string; name: string; sortOrder: number } | null;
}

interface TreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ─── squarified treemap layout ─── */

function layoutTreemap(
  values: number[],
  x: number,
  y: number,
  w: number,
  h: number
): TreeRect[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0 || values.length === 0)
    return values.map(() => ({ x, y, w: 0, h: 0 }));

  const rects: TreeRect[] = new Array(values.length);
  const indices = values
    .map((_, i) => i)
    .sort((a, b) => values[b] - values[a]);

  let cx = x,
    cy = y,
    cw = w,
    ch = h;
  let remaining = total;
  let i = 0;

  while (i < indices.length) {
    const isWide = cw >= ch;
    const side = isWide ? ch : cw;
    const row: number[] = [];
    let rowSum = 0;
    let bestAspect = Infinity;

    for (let j = i; j < indices.length; j++) {
      const val = values[indices[j]];
      const newSum = rowSum + val;
      const rowFraction = newSum / remaining;
      const rowSize = rowFraction * (isWide ? cw : ch);

      let worstAspect = 0;
      for (const idx of [...row, indices[j]]) {
        const itemFraction = values[idx] / newSum;
        const itemSize = itemFraction * side;
        const aspect = Math.max(rowSize / itemSize, itemSize / rowSize);
        worstAspect = Math.max(worstAspect, aspect);
      }

      if (worstAspect > bestAspect && row.length > 0) break;
      bestAspect = worstAspect;
      row.push(indices[j]);
      rowSum = newSum;
    }

    const rowFraction = rowSum / remaining;
    const rowSize = rowFraction * (isWide ? cw : ch);
    let offset = 0;

    for (const idx of row) {
      const itemFraction = values[idx] / rowSum;
      const itemSize = itemFraction * side;
      if (isWide) {
        rects[idx] = { x: cx, y: cy + offset, w: rowSize, h: itemSize };
      } else {
        rects[idx] = { x: cx + offset, y: cy, w: itemSize, h: rowSize };
      }
      offset += itemSize;
    }

    if (isWide) {
      cx += rowSize;
      cw -= rowSize;
    } else {
      cy += rowSize;
      ch -= rowSize;
    }
    remaining -= rowSum;
    i += row.length;
  }

  return rects;
}

/* ─── warm light color palette ─── */

const PALETTE = [
  { bg: "#D4A574", hi: "#E0BB94", text: "#4A2C12", glow: "#D4A57430", border: "#C4955A" },
  { bg: "#7BA68A", hi: "#95BBA1", text: "#1A3D28", glow: "#7BA68A30", border: "#6B967A" },
  { bg: "#7B9BB8", hi: "#96B2CA", text: "#1C3448", glow: "#7B9BB830", border: "#6B8BA8" },
  { bg: "#B87B8A", hi: "#CA96A2", text: "#481C28", glow: "#B87B8A30", border: "#A86B7A" },
  { bg: "#C4A84A", hi: "#D4BC70", text: "#4A3C08", glow: "#C4A84A30", border: "#B49838" },
  { bg: "#6B8FA8", hi: "#88A8BC", text: "#1A3040", glow: "#6B8FA830", border: "#5B7F98" },
  { bg: "#C08858", hi: "#D0A078", text: "#4A2C10", glow: "#C0885830", border: "#B07848" },
  { bg: "#6BA87B", hi: "#88BC95", text: "#1A3D20", glow: "#6BA87B30", border: "#5B986B" },
  { bg: "#9878A0", hi: "#B098B8", text: "#301838", glow: "#9878A030", border: "#886890" },
  { bg: "#A89060", hi: "#BCA880", text: "#3A3010", glow: "#A8906030", border: "#988050" },
  { bg: "#6BA0A0", hi: "#88B8B8", text: "#1A3838", glow: "#6BA0A030", border: "#5B9090" },
  { bg: "#A06878", hi: "#B88898", text: "#3A1820", glow: "#A0687830", border: "#905868" },
];

const UNCLASSIFIED = {
  bg: "#C0BBB0",
  hi: "#D0CBC0",
  text: "#4A4540",
  glow: "#C0BBB030",
  border: "#B0AAA0",
};

function colorFor(sortOrder: number, id: string) {
  if (id === "__unclassified__") return UNCLASSIFIED;
  return PALETTE[sortOrder % PALETTE.length];
}

/* ─── provider/mailbox colors ─── */

const PROVIDER_COLORS: Record<string, { bg: string; text: string }> = {
  gmail: { bg: "#EA433520", text: "#D93025" },
  google: { bg: "#EA433520", text: "#D93025" },
  icloud: { bg: "#007AFF20", text: "#0071E3" },
  apple: { bg: "#007AFF20", text: "#0071E3" },
  outlook: { bg: "#0078D420", text: "#0067B8" },
  microsoft: { bg: "#0078D420", text: "#0067B8" },
  yahoo: { bg: "#6001D220", text: "#5A00C8" },
  protonmail: { bg: "#6D4AFF20", text: "#6D4AFF" },
  proton: { bg: "#6D4AFF20", text: "#6D4AFF" },
  fastmail: { bg: "#69A3FF20", text: "#3B82CC" },
  imap: { bg: "#78716C20", text: "#57534E" },
};

const DEFAULT_PROVIDER_COLOR = { bg: "#78716C18", text: "#6B6560" };

function providerColor(provider: string) {
  const key = provider.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(PROVIDER_COLORS)) {
    if (key.includes(k)) return v;
  }
  return DEFAULT_PROVIDER_COLOR;
}

/* ─── layout constants ─── */

const OUTER_GAP = 4;
const SENDER_GAP = 2;
const EMAIL_GAP = 1;

/* ─── component ─── */

export default function HeatmapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoveredBucket, setHoveredBucket] = useState<string | null>(null);
  const [hoveredSender, setHoveredSender] = useState<string | null>(null);
  const [hoveredEmail, setHoveredEmail] = useState<Thread | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const { data: threads = [], isLoading } = useQuery<Thread[]>({
    queryKey: ["threads"],
    queryFn: () => fetch("/api/threads").then((r) => r.json()),
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ─── data ─── */

  const buckets = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; sortOrder: number; threads: Thread[] }
    >();
    for (const t of threads) {
      const id = t.bucket?.id || "__unclassified__";
      const name = t.bucket?.name || "Unclassified";
      const so = t.bucket?.sortOrder ?? 999;
      const ex = map.get(id);
      if (ex) ex.threads.push(t);
      else map.set(id, { id, name, sortOrder: so, threads: [t] });
    }
    return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [threads]);

  const sendersByBucket = useMemo(() => {
    const result = new Map<
      string,
      { email: string; name: string; count: number; threads: Thread[] }[]
    >();
    for (const b of buckets) {
      const sm = new Map<
        string,
        { email: string; name: string; count: number; threads: Thread[] }
      >();
      for (const t of b.threads) {
        const ex = sm.get(t.senderEmail);
        if (ex) {
          ex.count++;
          ex.threads.push(t);
        } else {
          sm.set(t.senderEmail, {
            email: t.senderEmail,
            name: t.sender,
            count: 1,
            threads: [t],
          });
        }
      }
      result.set(
        b.id,
        Array.from(sm.values()).sort((a, b) => b.count - a.count)
      );
    }
    return result;
  }, [buckets]);

  /* ─── layout: buckets ─── */

  const { w: W, h: H } = size;

  const bucketRects = useMemo(
    () => layoutTreemap(buckets.map((b) => b.threads.length), 0, 0, W, H),
    [buckets, W, H]
  );

  /* ─── layout: sender sub-rects ─── */

  const senderLayoutMap = useMemo(() => {
    const result = new Map<string, TreeRect[]>();
    for (let bi = 0; bi < buckets.length; bi++) {
      const bucket = buckets[bi];
      const br = bucketRects[bi];
      if (!br) continue;
      const cellW = br.w - OUTER_GAP;
      const cellH = br.h - OUTER_GAP;
      if (cellW < 50 || cellH < 40) continue;

      const senders = sendersByBucket.get(bucket.id) || [];
      if (senders.length === 0) continue;

      const labelH = Math.min(26, Math.max(18, cellH * 0.13));
      const pad = 3;
      const iw = cellW - pad * 2;
      const ih = cellH - labelH - pad;

      if (iw > 10 && ih > 10) {
        result.set(
          bucket.id,
          layoutTreemap(senders.map((s) => s.count), pad, labelH, iw, ih)
        );
      }
    }
    return result;
  }, [buckets, bucketRects, sendersByBucket]);

  /* ─── layout: email sub-rects ─── */

  const { emailRects, emailThreads } = useMemo(() => {
    if (!hoveredBucket || !hoveredSender)
      return { emailRects: [] as TreeRect[], emailThreads: [] as Thread[] };

    const senders = sendersByBucket.get(hoveredBucket) || [];
    const si = senders.findIndex((s) => s.email === hoveredSender);
    if (si === -1)
      return { emailRects: [] as TreeRect[], emailThreads: [] as Thread[] };

    const sRects = senderLayoutMap.get(hoveredBucket);
    if (!sRects?.[si])
      return { emailRects: [] as TreeRect[], emailThreads: [] as Thread[] };

    const sr = sRects[si];
    const cellW = sr.w - SENDER_GAP;
    const cellH = sr.h - SENDER_GAP;
    if (cellW < 25 || cellH < 20)
      return { emailRects: [] as TreeRect[], emailThreads: [] as Thread[] };

    const sorted = [...senders[si].threads].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    const labelH = Math.min(16, Math.max(12, cellH * 0.12));
    const pad = 2;
    const iw = cellW - pad * 2;
    const ih = cellH - labelH - pad;

    if (iw > 5 && ih > 5) {
      return {
        emailRects: layoutTreemap(sorted.map(() => 1), pad, labelH, iw, ih),
        emailThreads: sorted,
      };
    }
    return { emailRects: [] as TreeRect[], emailThreads: [] as Thread[] };
  }, [hoveredBucket, hoveredSender, sendersByBucket, senderLayoutMap]);

  /* ─── tooltip for small senders ─── */

  const senderTooltipData = useMemo(() => {
    if (!hoveredBucket || !hoveredSender) return null;
    if (emailRects.length > 0) return null;
    const senders = sendersByBucket.get(hoveredBucket) || [];
    return senders.find((s) => s.email === hoveredSender) || null;
  }, [hoveredBucket, hoveredSender, emailRects, sendersByBucket]);

  // Find bucket name for hovered email
  const hoveredEmailBucket = useMemo(() => {
    if (!hoveredEmail) return null;
    return hoveredEmail.bucket?.name || "Unclassified";
  }, [hoveredEmail]);

  // Find bucket name for sender tooltip
  const senderTooltipBucket = useMemo(() => {
    if (!hoveredBucket) return null;
    return buckets.find((b) => b.id === hoveredBucket)?.name || "Unclassified";
  }, [hoveredBucket, buckets]);

  /* ─── render ─── */

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-[#F5F3EF]">
        <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 bg-[#F5F3EF]">
        <p className="text-stone-400 text-sm">
          No threads to visualize. Sync first.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full relative overflow-hidden select-none"
      style={{ background: "#F5F3EF" }}
    >
      {buckets.map((bucket, bi) => {
        const br = bucketRects[bi];
        if (!br || br.w < 1 || br.h < 1) return null;

        const color = colorFor(bucket.sortOrder, bucket.id);
        const isOpen = hoveredBucket === bucket.id;
        const cellW = br.w - OUTER_GAP;
        const cellH = br.h - OUTER_GAP;
        const isTiny = cellW < 50 || cellH < 40;
        const hasSenderLayout = senderLayoutMap.has(bucket.id);
        const senders = sendersByBucket.get(bucket.id) || [];
        const sRects = senderLayoutMap.get(bucket.id) || [];
        const labelH = Math.min(26, Math.max(18, cellH * 0.13));

        return (
          <div
            key={bucket.id}
            onMouseEnter={() => {
              setHoveredBucket(bucket.id);
              setHoveredSender(null);
              setHoveredEmail(null);
            }}
            onMouseLeave={() => {
              setHoveredBucket(null);
              setHoveredSender(null);
              setHoveredEmail(null);
            }}
            className="absolute"
            style={{
              left: br.x + OUTER_GAP / 2,
              top: br.y + OUTER_GAP / 2,
              width: cellW,
              height: cellH,
              background: color.bg,
              borderRadius: 10,
              overflow: "hidden",
              transition: "box-shadow 0.25s ease, transform 0.2s ease",
              boxShadow: isOpen
                ? `0 8px 30px ${color.glow}, 0 0 0 2px ${color.border}`
                : `0 1px 3px rgba(0,0,0,0.08), inset 0 0 0 1px ${color.border}40`,
              zIndex: isOpen ? 10 : 1,
            }}
          >
            {/* Bucket label: "Name - Count" */}
            <div
              className="absolute left-0 right-0 top-0 flex items-center px-3 pointer-events-none"
              style={{ height: labelH, zIndex: 20 }}
            >
              <span
                className="font-bold truncate"
                style={{
                  color: color.text,
                  fontSize: isTiny ? 9 : cellW < 120 ? 11 : 13,
                  letterSpacing: "0.01em",
                }}
              >
                {bucket.name}
                <span style={{ fontWeight: 700, color: "white", textShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
                  {" "}&mdash; {bucket.threads.length}
                </span>
              </span>
            </div>

            {/* Big watermark count — when not expanded */}
            {!isOpen && !isTiny && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span
                  style={{
                    color: "white",
                    fontSize: Math.max(20, Math.min(48, cellW * 0.15)),
                    fontWeight: 800,
                    opacity: 0.25,
                    textShadow: "0 2px 6px rgba(0,0,0,0.1)",
                  }}
                >
                  {bucket.threads.length}
                </span>
              </div>
            )}

            {/* ─── Sender sub-cells ─── */}
            {isOpen &&
              hasSenderLayout &&
              senders.map((sender, si) => {
                const sr = sRects[si];
                if (!sr || sr.w < 3 || sr.h < 3) return null;

                const isSenderOpen = hoveredSender === sender.email;
                const sCellW = sr.w - SENDER_GAP;
                const sCellH = sr.h - SENDER_GAP;
                const sTiny = sCellW < 35 || sCellH < 18;
                const sLabelH = Math.min(16, Math.max(12, sCellH * 0.12));

                const eRects = isSenderOpen ? emailRects : [];
                const eThreads = isSenderOpen ? emailThreads : [];

                return (
                  <div
                    key={sender.email}
                    onMouseEnter={(e) => {
                      setHoveredSender(sender.email);
                      setHoveredEmail(null);
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseMove={(e) =>
                      setTooltipPos({ x: e.clientX, y: e.clientY })
                    }
                    onMouseLeave={() => {
                      setHoveredSender(null);
                      setHoveredEmail(null);
                    }}
                    className="absolute"
                    style={{
                      left: sr.x + SENDER_GAP / 2,
                      top: sr.y + SENDER_GAP / 2,
                      width: sCellW,
                      height: sCellH,
                      background: isSenderOpen ? color.hi : `${color.hi}`,
                      borderRadius: 6,
                      overflow: "hidden",
                      transition:
                        "background 0.2s ease, box-shadow 0.2s ease",
                      boxShadow: isSenderOpen
                        ? `0 4px 16px ${color.glow}`
                        : `inset 0 0 0 1px ${color.border}30`,
                      animation: "heatFadeIn 0.2s ease",
                      zIndex: isSenderOpen ? 5 : 1,
                    }}
                  >
                    {/* Sender label */}
                    {!sTiny && (
                      <div
                        className="absolute left-0 right-0 top-0 flex items-center justify-between px-1.5 pointer-events-none"
                        style={{ height: sLabelH, zIndex: 10 }}
                      >
                        <span
                          className="font-semibold truncate"
                          style={{
                            color: color.text,
                            fontSize: sCellW < 80 ? 8 : 9,
                          }}
                        >
                          {sender.name}
                        </span>
                        <span
                          className="flex-shrink-0 ml-1"
                          style={{
                            color: "white",
                            fontSize: 8,
                            fontWeight: 700,
                            textShadow: "0 1px 2px rgba(0,0,0,0.2)",
                          }}
                        >
                          {sender.count}
                        </span>
                      </div>
                    )}
                    {sTiny && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span
                          style={{
                            color: "white",
                            fontSize: 8,
                            fontWeight: 700,
                            textShadow: "0 1px 2px rgba(0,0,0,0.2)",
                          }}
                        >
                          {sender.count}
                        </span>
                      </div>
                    )}

                    {/* ─── Email sub-cells ─── */}
                    {isSenderOpen &&
                      eThreads.map((thread, ei) => {
                        const er = eRects[ei];
                        if (!er || er.w < 2 || er.h < 2) return null;

                        const isEmailHovered =
                          hoveredEmail?.id === thread.id;
                        const eCellW = er.w - EMAIL_GAP;
                        const eCellH = er.h - EMAIL_GAP;

                        return (
                          <div
                            key={thread.id}
                            onMouseEnter={(e) => {
                              setHoveredEmail(thread);
                              setTooltipPos({
                                x: e.clientX,
                                y: e.clientY,
                              });
                            }}
                            onMouseMove={(e) =>
                              setTooltipPos({
                                x: e.clientX,
                                y: e.clientY,
                              })
                            }
                            onMouseLeave={() => setHoveredEmail(null)}
                            className="absolute"
                            style={{
                              left: er.x + EMAIL_GAP / 2,
                              top: er.y + EMAIL_GAP / 2,
                              width: eCellW,
                              height: eCellH,
                              background: isEmailHovered
                                ? `${color.border}40`
                                : `${color.bg}bb`,
                              borderRadius: 3,
                              overflow: "hidden",
                              transition: "background 0.15s ease",
                              animation: "heatFadeIn 0.15s ease",
                              border: isEmailHovered
                                ? `1px solid ${color.border}60`
                                : "1px solid transparent",
                            }}
                          >
                            {eCellH > 12 && (
                              <div className="absolute inset-0 flex items-center px-1 pointer-events-none overflow-hidden">
                                <span
                                  className="truncate"
                                  style={{
                                    color: color.text,
                                    fontSize: Math.max(
                                      7,
                                      Math.min(9, eCellH * 0.4)
                                    ),
                                    opacity: 0.7,
                                  }}
                                >
                                  {thread.subject}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
          </div>
        );
      })}

      {/* ─── Email detail tooltip ─── */}
      {hoveredEmail && (
        <div
          className="fixed pointer-events-none z-[200]"
          style={{
            left: Math.min(
              tooltipPos.x + 16,
              (typeof window !== "undefined" ? window.innerWidth : 1200) - 370
            ),
            top: Math.min(
              tooltipPos.y + 16,
              (typeof window !== "undefined" ? window.innerHeight : 800) - 220
            ),
          }}
        >
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: "white",
              border: "1px solid #E5E2DC",
              boxShadow:
                "0 12px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
              maxWidth: 350,
            }}
          >
            {/* Bucket tag */}
            {hoveredEmailBucket && (
              <div
                className="px-3.5 pt-2.5 pb-1"
              >
                <span
                  className="inline-block px-2 py-0.5 rounded-full text-white font-medium"
                  style={{
                    fontSize: 9,
                    background: colorFor(
                      hoveredEmail.bucket?.sortOrder ?? 999,
                      hoveredEmail.bucket?.id || "__unclassified__"
                    ).bg,
                  }}
                >
                  {hoveredEmailBucket}
                </span>
              </div>
            )}
            <div
              className="px-3.5 pt-1.5 pb-2.5"
              style={{ borderBottom: "1px solid #F0EDE8" }}
            >
              <div
                className="font-semibold leading-snug"
                style={{ color: "#1A1A1A", fontSize: 12 }}
              >
                {hoveredEmail.subject}
              </div>
              <div
                className="mt-1 flex items-center gap-2 flex-wrap"
                style={{ fontSize: 10 }}
              >
                <span style={{ color: "#6B6560" }}>
                  {hoveredEmail.sender}
                </span>
                <span style={{ color: "#D0CBC4" }}>&middot;</span>
                <span style={{ color: "#9B9590" }}>
                  {formatRelativeDate(hoveredEmail.date)}
                </span>
                <span style={{ color: "#D0CBC4" }}>&middot;</span>
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium"
                  style={{
                    fontSize: 9,
                    background: providerColor(hoveredEmail.provider).bg,
                    color: providerColor(hoveredEmail.provider).text,
                  }}
                >
                  {hoveredEmail.providerLabel}
                </span>
              </div>
            </div>
            {hoveredEmail.snippet && (
              <div
                className="px-3.5 py-2.5"
                style={{ color: "#7A756E", fontSize: 10, lineHeight: 1.6 }}
              >
                {hoveredEmail.snippet.slice(0, 180)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Sender tooltip (tiny cells) ─── */}
      {senderTooltipData && !hoveredEmail && (
        <div
          className="fixed pointer-events-none z-[200]"
          style={{
            left: Math.min(
              tooltipPos.x + 16,
              (typeof window !== "undefined" ? window.innerWidth : 1200) - 340
            ),
            top: Math.min(
              tooltipPos.y + 16,
              (typeof window !== "undefined" ? window.innerHeight : 800) - 280
            ),
          }}
        >
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: "white",
              border: "1px solid #E5E2DC",
              boxShadow:
                "0 12px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
              maxWidth: 320,
            }}
          >
            <div
              className="px-3.5 py-2.5"
              style={{ borderBottom: "1px solid #F0EDE8" }}
            >
              {senderTooltipBucket && (
                <span
                  className="inline-block px-2 py-0.5 rounded-full text-white font-medium mb-1.5"
                  style={{
                    fontSize: 9,
                    background: hoveredBucket
                      ? colorFor(
                          buckets.find((b) => b.id === hoveredBucket)
                            ?.sortOrder ?? 999,
                          hoveredBucket
                        ).bg
                      : "#999",
                  }}
                >
                  {senderTooltipBucket}
                </span>
              )}
              <div
                className="font-semibold truncate"
                style={{ color: "#1A1A1A", fontSize: 11 }}
              >
                {senderTooltipData.name}
              </div>
              <div style={{ color: "#9B9590", fontSize: 9 }}>
                {senderTooltipData.email} &middot; {senderTooltipData.count}{" "}
                email{senderTooltipData.count !== 1 ? "s" : ""}
              </div>
            </div>
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {senderTooltipData.threads
                .sort(
                  (a, b) =>
                    new Date(b.date).getTime() - new Date(a.date).getTime()
                )
                .slice(0, 8)
                .map((t) => (
                  <div
                    key={t.id}
                    className="px-3.5 py-1.5"
                    style={{
                      borderBottom: "1px solid #F5F2ED",
                    }}
                  >
                    <div
                      className="truncate"
                      style={{ color: "#3A3530", fontSize: 10 }}
                    >
                      {t.subject}
                    </div>
                    <div className="flex items-center gap-1.5" style={{ fontSize: 8 }}>
                      <span style={{ color: "#A0998F" }}>{formatRelativeDate(t.date)}</span>
                      <span
                        className="px-1 py-px rounded font-medium"
                        style={{
                          background: providerColor(t.provider).bg,
                          color: providerColor(t.provider).text,
                          fontSize: 7,
                        }}
                      >
                        {t.providerLabel}
                      </span>
                    </div>
                  </div>
                ))}
              {senderTooltipData.threads.length > 8 && (
                <div
                  className="px-3.5 py-1.5"
                  style={{ color: "#B0A8A0", fontSize: 9 }}
                >
                  +{senderTooltipData.threads.length - 8} more
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Stats ─── */}
      <div
        className="absolute bottom-2.5 right-3.5 pointer-events-none"
        style={{
          color: "#C0BAB0",
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: "0.04em",
        }}
      >
        {buckets.length} buckets &middot; {threads.length} emails
      </div>

      <style>{`
        @keyframes heatFadeIn {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
