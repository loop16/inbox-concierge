"use client";

import { useEffect, useRef, useState } from "react";

// ─── Props ───

interface CinematicLoaderProps {
  isLoading: boolean;
  progress?: number;
  message?: string;
  color?: string;
  backgroundColor?: string;
  dotCount?: number;
  duration?: number;
  onRevealComplete?: () => void;
  inline?: boolean;
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

function shapeRing(x: number, y: number): boolean {
  const d = Math.hypot(x - 0.5, y - 0.5);
  return d > 0.17 && d < 0.29;
}

function shapeEnvelope(x: number, y: number): boolean {
  if (x >= 0.15 && x <= 0.85 && y >= 0.40 && y <= 0.75) return true;
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

function shapeHorse(x: number, y: number): boolean {
  const bodyDx = (x - 0.48) / 0.22;
  const bodyDy = (y - 0.44) / 0.11;
  if (bodyDx * bodyDx + bodyDy * bodyDy < 1) return true;
  const headDx = (x - 0.22) / 0.06;
  const headDy = (y - 0.28) / 0.07;
  if (headDx * headDx + headDy * headDy < 1) return true;
  if (distToSegment(x, y, 0.30, 0.36, 0.25, 0.30) < 0.045) return true;
  if (distToSegment(x, y, 0.20, 0.22, 0.18, 0.17) < 0.02) return true;
  if (distToSegment(x, y, 0.23, 0.22, 0.22, 0.17) < 0.02) return true;
  if (distToSegment(x, y, 0.34, 0.53, 0.22, 0.72) < 0.028) return true;
  if (distToSegment(x, y, 0.38, 0.54, 0.30, 0.72) < 0.028) return true;
  if (distToSegment(x, y, 0.62, 0.52, 0.74, 0.72) < 0.028) return true;
  if (distToSegment(x, y, 0.58, 0.53, 0.68, 0.72) < 0.028) return true;
  if (distToSegment(x, y, 0.68, 0.37, 0.80, 0.28) < 0.035) return true;
  return false;
}

function shapeFilledCircle(x: number, y: number): boolean {
  return Math.hypot(x - 0.5, y - 0.5) < 0.30;
}

// ─── Formation Generator ───

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
  label: string;
}

function buildFormations(count: number): Formation[] {
  const allScales = new Array(count).fill(1);

  return [
    { label: "ring", points: sampleShape(shapeRing, count), scales: [...allScales] },
    { label: "envelope", points: sampleShape(shapeEnvelope, count), scales: [...allScales] },
    { label: "horse", points: sampleShape(shapeHorse, count), scales: [...allScales] },
    { label: "grid", points: sampleShape(shapeGrid, count), scales: [...allScales] },
    { label: "bars", points: sampleShape(shapeBars, count), scales: [...allScales] },
    { label: "circle", points: sampleShape(shapeFilledCircle, count), scales: [...allScales] },
  ];
}

function buildStaggers(formations: Formation[]): number[][] {
  return formations.map((f) => {
    const dists = f.points.map(([x, y]) => Math.hypot(x - 0.5, y - 0.5));
    const maxDist = Math.max(...dists, 0.001);
    return dists.map((d) => d / maxDist);
  });
}

// ─── Shared animation loop ───

function startAnimation(
  canvas: HTMLCanvasElement,
  getSize: () => { w: number; h: number },
  dotCount: number,
  color: string,
  bg: string,
  isInline: boolean,
  progress: number | undefined,
): () => void {
  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;

  const formations = buildFormations(dotCount);
  const staggers = buildStaggers(formations);
  const numFormations = formations.length;

  const holdTime = 2.0;
  const transitionTime = 1.7;
  const phaseLength = holdTime + transitionTime;
  const totalDuration = numFormations * phaseLength;

  const staggerSpread = 0.55;
  const dotTransFrac = 1 - staggerSpread;

  const baseRadii = Array.from({ length: dotCount }, () => 2.8 + Math.random() * 1.2);
  const pulsePhases = Array.from({ length: dotCount }, () => Math.random() * Math.PI * 2);

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startTime = performance.now();
  let rafId = 0;

  const resize = () => {
    const { w, h } = getSize();
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  };
  resize();
  window.addEventListener("resize", resize);

  const animate = (now: number) => {
    const elapsed = (now - startTime) / 1000;
    const { w, h } = getSize();

    if (w === 0 || h === 0) {
      rafId = requestAnimationFrame(animate);
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const dim = Math.min(w, h);
    const shapeScale = isInline ? dim * 0.7 : dim * 0.52;
    const offsetX = (w - shapeScale) / 2;
    const offsetY = isInline ? (h - shapeScale) / 2 : (h - shapeScale) / 2 - dim * 0.03;
    const dotSizeScale = isInline ? Math.max(dim / 350, 0.6) : Math.max(dim / 550, 0.8);

    if (prefersReduced) {
      const circle = formations[numFormations - 1];
      ctx.fillStyle = color;
      for (let i = 0; i < dotCount; i++) {
        const [nx, ny] = circle.points[i];
        ctx.beginPath();
        ctx.arc(offsetX + nx * shapeScale, offsetY + ny * shapeScale, baseRadii[i] * dotSizeScale, 0, Math.PI * 2);
        ctx.fill();
      }
      rafId = requestAnimationFrame(animate);
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
    const rawTransProgress = isTransitioning ? (phaseTime - holdTime) / transitionTime : 0;

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
        if (rawTransProgress >= dotEnd) dp = 1;
        else if (rawTransProgress > dotStart) dp = easeInOutCubic((rawTransProgress - dotStart) / dotTransFrac);
        else dp = 0;

        x = cx + (nx - cx) * dp;
        y = cy + (ny - cy) * dp;
        scale = cScale + (nScale - cScale) * dp;
      } else {
        x = cx;
        y = cy;
        scale = cScale;
      }

      if (scale < 0.02) continue;

      const pulse = 0.75 + Math.sin(elapsed * 2.2 + pulsePhases[i]) * 0.25;
      const px = offsetX + x * shapeScale;
      const py = offsetY + y * shapeScale;
      const r = baseRadii[i] * dotSizeScale * scale * pulse;

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    rafId = requestAnimationFrame(animate);
  };

  rafId = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
  };
}

// ─── Inline Component ───
// Always stays mounted. Starts/stops animation based on isLoading prop.

function InlineCinematicLoader({
  isLoading,
  message,
  color = "#f59e0b",
  backgroundColor,
  dotCount = 80,
  progress,
}: CinematicLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const bg = (!backgroundColor || backgroundColor === "#000000") ? "#ffffff" : backgroundColor;

  useEffect(() => {
    if (!isLoading) {
      // Stop animation and clear canvas
      cleanupRef.current?.();
      cleanupRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      return;
    }

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const getSize = () => {
      const rect = container.getBoundingClientRect();
      return { w: rect.width, h: rect.height };
    };

    cleanupRef.current = startAnimation(canvas, getSize, dotCount, color, bg, true, progress);

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [isLoading, dotCount, color, bg, progress]);

  return (
    <div
      ref={containerRef}
      className="relative z-10 w-full flex flex-col items-center"
      style={{ display: isLoading ? "flex" : "none" }}
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

// ─── Overlay Component (full-screen with fade in/out) ───

function OverlayCinematicLoader({
  isLoading,
  message,
  color = "#f59e0b",
  backgroundColor = "#000000",
  dotCount = 500,
  progress,
  onRevealComplete,
}: CinematicLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opacity, setOpacity] = useState(0);
  const [visible, setVisible] = useState(false);
  const wasLoadingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

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

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getSize = () => ({ w: window.innerWidth, h: window.innerHeight });
    cleanupRef.current = startAnimation(canvas, getSize, dotCount, color, backgroundColor, false, progress);

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [visible, dotCount, color, backgroundColor, progress]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[100]"
      style={{
        opacity,
        backgroundColor,
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

// ─── Main Export ───

export default function CinematicLoader(props: CinematicLoaderProps) {
  if (props.inline) {
    return <InlineCinematicLoader {...props} />;
  }
  return <OverlayCinematicLoader {...props} />;
}
