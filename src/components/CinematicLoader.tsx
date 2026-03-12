"use client";

import { useEffect, useRef, useState } from "react";

// ─── Props ───

interface CinematicLoaderProps {
  isLoading: boolean;
  progress?: number; // 0-100, maps animation to loading progress
  message?: string;
  color?: string;
  backgroundColor?: string;
  dotCount?: number;
  duration?: number; // total loop duration in seconds
  onRevealComplete?: () => void;
  inline?: boolean; // render inside a container instead of full-screen overlay
}

// ─── Math Helpers ───

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function distToSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ─── Shape Definitions ───
// Each function tests if a normalized point (0-1, 0-1) is inside the shape

function shapeRing(x: number, y: number): boolean {
  const d = Math.hypot(x - 0.5, y - 0.5);
  return d > 0.17 && d < 0.29;
}

function shapeEnvelope(x: number, y: number): boolean {
  // Body rectangle
  if (x >= 0.15 && x <= 0.85 && y >= 0.40 && y <= 0.75) return true;
  // Flap triangle: (0.15, 0.40) → (0.50, 0.22) → (0.85, 0.40)
  if (y >= 0.22 && y < 0.40) {
    const t = (0.40 - y) / 0.18;
    return x >= 0.15 + t * 0.35 && x <= 0.85 - t * 0.35;
  }
  return false;
}

function shapeGrid(x: number, y: number): boolean {
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 4; r++) {
      const cx = 0.18 + c * 0.16;
      const cy = 0.25 + r * 0.15;
      if (Math.abs(x - cx) < 0.042 && Math.abs(y - cy) < 0.042) return true;
    }
  }
  return false;
}

function shapeBars(x: number, y: number): boolean {
  const bars = [
    { left: 0.12, h: 0.48 },
    { left: 0.26, h: 0.33 },
    { left: 0.40, h: 0.62 },
    { left: 0.54, h: 0.41 },
    { left: 0.68, h: 0.55 },
  ];
  for (const b of bars) {
    if (x >= b.left && x <= b.left + 0.12 && y >= 0.80 - b.h && y <= 0.80) return true;
  }
  return false;
}

function shapeCheckmark(x: number, y: number): boolean {
  return (
    distToSegment(x, y, 0.18, 0.52, 0.42, 0.73) < 0.058 ||
    distToSegment(x, y, 0.42, 0.73, 0.83, 0.24) < 0.058
  );
}

function shapeFilledCircle(x: number, y: number): boolean {
  return Math.hypot(x - 0.5, y - 0.5) < 0.30;
}

// ─── Formation Generator ───
// Samples evenly-distributed points inside a shape

function sampleShape(
  test: (x: number, y: number) => boolean,
  count: number,
): [number, number][] {
  const res = 60;
  const candidates: [number, number][] = [];
  for (let i = 0; i < res; i++) {
    for (let j = 0; j < res; j++) {
      const nx = (i + 0.5) / res;
      const ny = (j + 0.5) / res;
      if (test(nx, ny)) candidates.push([nx, ny]);
    }
  }

  if (candidates.length === 0) {
    return Array.from({ length: count }, () => [0.5, 0.5] as [number, number]);
  }

  // Evenly pick 'count' points
  const result: [number, number][] = [];
  const step = candidates.length / count;
  for (let i = 0; i < count; i++) {
    result.push(candidates[Math.min(Math.floor(i * step), candidates.length - 1)]);
  }
  return result;
}

// ─── Formation Data ───

interface Formation {
  points: [number, number][];
  scales: number[];
  label: string; // story beat name
}

function buildFormations(count: number): Formation[] {
  const allScales = new Array(count).fill(1);

  // Origin: all dots at center, only first is visible
  const originScales = new Array(count).fill(0);
  originScales[0] = 1;

  return [
    {
      label: "origin",
      points: Array.from({ length: count }, () => [0.5, 0.5] as [number, number]),
      scales: originScales,
    },
    {
      label: "ring",
      points: sampleShape(shapeRing, count),
      scales: [...allScales],
    },
    {
      label: "envelope",
      points: sampleShape(shapeEnvelope, count),
      scales: [...allScales],
    },
    {
      label: "grid",
      points: sampleShape(shapeGrid, count),
      scales: [...allScales],
    },
    {
      label: "bars",
      points: sampleShape(shapeBars, count),
      scales: [...allScales],
    },
    {
      label: "checkmark",
      points: sampleShape(shapeCheckmark, count),
      scales: [...allScales],
    },
    {
      label: "circle",
      points: sampleShape(shapeFilledCircle, count),
      scales: [...allScales],
    },
  ];
}

// Precompute stagger values for each formation (distance from center, normalized)
function buildStaggers(formations: Formation[]): number[][] {
  return formations.map((f) => {
    const dists = f.points.map(([x, y]) => Math.hypot(x - 0.5, y - 0.5));
    const maxDist = Math.max(...dists, 0.001);
    return dists.map((d) => d / maxDist);
  });
}

// ─── Component ───

export default function CinematicLoader({
  isLoading,
  progress,
  message,
  color = "#f59e0b",
  backgroundColor = "#000000",
  dotCount = 500,
  duration = 26,
  onRevealComplete,
  inline = false,
}: CinematicLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const [opacity, setOpacity] = useState(0);
  const [visible, setVisible] = useState(false);
  const wasLoadingRef = useRef(false);

  const bg = inline ? (backgroundColor === "#000000" ? "#ffffff" : backgroundColor) : backgroundColor;

  // Fade in when isLoading becomes true, fade out when false
  useEffect(() => {
    if (isLoading) {
      wasLoadingRef.current = true;
      setVisible(true);
      const raf = requestAnimationFrame(() => setOpacity(1));
      return () => cancelAnimationFrame(raf);
    } else if (wasLoadingRef.current) {
      wasLoadingRef.current = false;
      setOpacity(0);
      const timer = setTimeout(() => {
        setVisible(false);
        onRevealComplete?.();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isLoading, onRevealComplete]);

  // Main animation
  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;

    // Build formations
    const formations = buildFormations(dotCount);
    const staggers = buildStaggers(formations);
    const numFormations = formations.length;

    // Timing
    const holdTime = 2.0;
    const transitionTime = 1.7;
    const phaseLength = holdTime + transitionTime;
    const totalDuration = numFormations * phaseLength;

    const staggerSpread = 0.55;
    const dotTransFrac = 1 - staggerSpread;

    // Dot radii — smaller for inline mode
    const radiusBase = inline ? 1.4 : 2.8;
    const radiusRange = inline ? 0.6 : 1.2;
    const baseRadii = Array.from({ length: dotCount }, () => radiusBase + Math.random() * radiusRange);

    // Resize handler
    const resize = () => {
      if (inline) {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      } else {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = (now - startTime) / 1000;

      let w: number, h: number;
      if (inline) {
        const container = containerRef.current;
        if (!container) { animRef.current = requestAnimationFrame(animate); return; }
        const rect = container.getBoundingClientRect();
        w = rect.width;
        h = rect.height;
      } else {
        w = window.innerWidth;
        h = window.innerHeight;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const dim = Math.min(w, h);
      const shapeScale = inline ? dim * 0.7 : dim * 0.52;
      const offsetX = (w - shapeScale) / 2;
      const offsetY = inline
        ? (h - shapeScale) / 2
        : (h - shapeScale) / 2 - dim * 0.03;

      const dotSizeScale = inline ? Math.max(dim / 350, 0.6) : Math.max(dim / 550, 0.8);

      if (prefersReduced) {
        const circle = formations[numFormations - 1];
        ctx.fillStyle = color;
        for (let i = 0; i < dotCount; i++) {
          const [nx, ny] = circle.points[i];
          ctx.beginPath();
          ctx.arc(
            offsetX + nx * shapeScale,
            offsetY + ny * shapeScale,
            baseRadii[i] * dotSizeScale,
            0, Math.PI * 2,
          );
          ctx.fill();
        }
        animRef.current = requestAnimationFrame(animate);
        return;
      }

      let loopTime: number;
      if (progress !== undefined && progress >= 0) {
        loopTime = Math.min(progress / 100, 0.99) * totalDuration;
      } else {
        loopTime = elapsed % totalDuration;
      }

      const phaseIdx = Math.floor(loopTime / phaseLength) % numFormations;
      const phaseTime = loopTime - phaseIdx * phaseLength;
      const nextIdx = (phaseIdx + 1) % numFormations;

      const isTransitioning = phaseTime >= holdTime;
      const rawTransProgress = isTransitioning
        ? (phaseTime - holdTime) / transitionTime
        : 0;

      const current = formations[phaseIdx];
      const next = formations[nextIdx];
      const nextStaggers = staggers[nextIdx];

      ctx.fillStyle = color;

      for (let i = 0; i < dotCount; i++) {
        const [cx, cy] = current.points[i];
        const cScale = current.scales[i];

        let x: number, y: number, scale: number;

        if (isTransitioning) {
          const [nx, ny] = next.points[i];
          const nScale = next.scales[i];
          const sg = nextStaggers[i];

          const dotStart = sg * staggerSpread;
          const dotEnd = dotStart + dotTransFrac;
          let dp: number;
          if (rawTransProgress >= dotEnd) {
            dp = 1;
          } else if (rawTransProgress > dotStart) {
            dp = easeInOutCubic(
              (rawTransProgress - dotStart) / dotTransFrac,
            );
          } else {
            dp = 0;
          }

          x = cx + (nx - cx) * dp;
          y = cy + (ny - cy) * dp;
          scale = cScale + (nScale - cScale) * dp;
        } else {
          x = cx;
          y = cy;
          scale = cScale;

          if (phaseIdx === 0 && i === 0) {
            const pulse = 0.6 + Math.sin(elapsed * 2.8) * 0.4;
            scale = pulse;
          }
        }

        if (scale < 0.02) continue;

        const px = offsetX + x * shapeScale;
        const py = offsetY + y * shapeScale;
        const r = baseRadii[i] * dotSizeScale * scale;

        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [visible, dotCount, color, bg, duration, progress, inline]);

  if (!visible) return null;

  // Inline mode: render inside parent container
  if (inline) {
    return (
      <div
        ref={containerRef}
        className="relative z-10 w-full flex flex-col items-center"
        style={{ opacity, transition: "opacity 0.5s ease-in-out" }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: 260, display: "block" }}
        />
        {message && (
          <p
            className="text-xs font-medium tracking-[0.15em] uppercase mt-3 text-center"
            style={{ color: "#b45309", opacity: 0.8 }}
          >
            {message}
          </p>
        )}
      </div>
    );
  }

  // Full-screen overlay mode
  return (
    <div
      className="fixed inset-0 z-[100]"
      style={{
        opacity,
        backgroundColor: bg,
        transition: "opacity 0.7s ease-in-out",
        pointerEvents: isLoading ? "all" : "none",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {message && (
        <div className="absolute bottom-14 left-0 right-0 text-center px-6">
          <p
            className="text-sm font-medium tracking-[0.2em] uppercase"
            style={{ color, opacity: 0.7 }}
          >
            {message}
          </p>
        </div>
      )}
    </div>
  );
}

/*
 ─── Story Beat Mapping ───

 Phase 0 — "Origin"     → Single dot pulses at center. Emergence. Creation.
 Phase 1 — "Ring"       → Dot expands into a ring of many. Awakening.
 Phase 2 — "Envelope"   → Ring morphs into mail icon. "Reading your emails."
 Phase 3 — "Grid"       → Envelope dissolves into organized grid. "Analyzing patterns."
 Phase 4 — "Bars"       → Grid reshapes into bar chart. "Classifying into categories."
 Phase 5 — "Checkmark"  → Bars morph into checkmark. "Organized."
 Phase 6 — "Circle"     → Checkmark becomes filled circle. Brand mark. Hold.
 Loop    — Circle collapses back to single dot. Seamless restart.

 ─── Timing (default 26s loop) ───

 Each phase: 2.0s hold + 1.7s transition = 3.7s
 7 phases × 3.7s = 25.9s ≈ 26s

 ─── Tuning Guide ───

 color           — Dot color. Default: "#f59e0b" (amber-500)
 backgroundColor — Overlay background. Default: "#000000"
 dotCount        — Number of dots. More = denser shapes. Default: 500
 duration        — Not currently used for timing (phases are fixed), reserved for future
 progress        — If set (0-100), maps animation phases linearly to loading progress
                   If unset, animation loops on a timer
 holdTime        — How long each shape holds before transitioning (line ~180)
 transitionTime  — How long each morph takes (line ~181)
 staggerSpread   — How spread-out the per-dot stagger is (line ~186). Higher = more wave-like
 baseRadii range — Dot size variation (line ~190). Narrow range = more uniform
 shapeScale      — How large shapes render relative to screen (line ~214)
*/
