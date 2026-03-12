"use client";

import { useEffect, useRef } from "react";

// Horse gallop keyframes — 4 poses, points normalized to 0-1 range
// Each pose is a set of (x, y) points tracing the horse silhouette
const HORSE_POSES = [
  // Pose 0: Gallop extended — front legs forward, back legs back
  [
    // Body top line
    [0.35, 0.35], [0.40, 0.32], [0.45, 0.30], [0.50, 0.29], [0.55, 0.30], [0.60, 0.32],
    [0.65, 0.33], [0.70, 0.34],
    // Body bottom line
    [0.38, 0.50], [0.43, 0.52], [0.48, 0.53], [0.53, 0.53], [0.58, 0.52], [0.63, 0.50],
    // Head + neck
    [0.28, 0.38], [0.25, 0.34], [0.22, 0.28], [0.20, 0.24], [0.19, 0.20], [0.21, 0.18],
    [0.24, 0.17], [0.26, 0.19], [0.27, 0.22], [0.23, 0.23],
    // Ears
    [0.21, 0.14], [0.24, 0.13],
    // Mane
    [0.30, 0.30], [0.33, 0.28], [0.28, 0.26], [0.31, 0.24],
    // Front legs — extended forward
    [0.34, 0.52], [0.30, 0.58], [0.26, 0.64], [0.22, 0.70], [0.20, 0.74],
    [0.38, 0.53], [0.36, 0.60], [0.33, 0.66], [0.30, 0.70],
    // Back legs — extended back
    [0.65, 0.50], [0.68, 0.56], [0.72, 0.62], [0.76, 0.68], [0.78, 0.74],
    [0.62, 0.52], [0.66, 0.58], [0.70, 0.64], [0.74, 0.70],
    // Tail
    [0.72, 0.33], [0.76, 0.30], [0.80, 0.28], [0.83, 0.27], [0.85, 0.29],
    // Body fill
    [0.42, 0.38], [0.48, 0.40], [0.54, 0.38], [0.60, 0.40], [0.45, 0.45], [0.55, 0.45],
    [0.50, 0.42], [0.40, 0.44], [0.58, 0.44],
  ],
  // Pose 1: Gallop collected — legs tucking under
  [
    // Body top line
    [0.35, 0.33], [0.40, 0.30], [0.45, 0.28], [0.50, 0.27], [0.55, 0.28], [0.60, 0.30],
    [0.65, 0.32], [0.70, 0.33],
    // Body bottom line
    [0.38, 0.48], [0.43, 0.50], [0.48, 0.51], [0.53, 0.51], [0.58, 0.50], [0.63, 0.48],
    // Head + neck (slightly lower — driving forward)
    [0.28, 0.36], [0.25, 0.32], [0.22, 0.27], [0.20, 0.23], [0.19, 0.20], [0.21, 0.18],
    [0.24, 0.17], [0.26, 0.19], [0.27, 0.21], [0.23, 0.22],
    // Ears
    [0.20, 0.14], [0.23, 0.14],
    // Mane (flowing back)
    [0.30, 0.28], [0.33, 0.26], [0.29, 0.24], [0.32, 0.22],
    // Front legs — tucked under body
    [0.36, 0.50], [0.38, 0.56], [0.40, 0.62], [0.42, 0.68], [0.40, 0.74],
    [0.40, 0.52], [0.42, 0.58], [0.44, 0.64], [0.43, 0.70],
    // Back legs — tucked under body
    [0.60, 0.48], [0.58, 0.54], [0.56, 0.60], [0.54, 0.66], [0.52, 0.74],
    [0.58, 0.50], [0.56, 0.56], [0.54, 0.62], [0.53, 0.70],
    // Tail (higher — momentum)
    [0.72, 0.31], [0.76, 0.27], [0.80, 0.24], [0.83, 0.23], [0.85, 0.25],
    // Body fill
    [0.42, 0.36], [0.48, 0.38], [0.54, 0.36], [0.60, 0.38], [0.45, 0.43], [0.55, 0.43],
    [0.50, 0.40], [0.40, 0.42], [0.58, 0.42],
  ],
  // Pose 2: Gallop — front legs down, back legs pushing off
  [
    // Body top line
    [0.35, 0.34], [0.40, 0.31], [0.45, 0.29], [0.50, 0.28], [0.55, 0.29], [0.60, 0.31],
    [0.65, 0.33], [0.70, 0.35],
    // Body bottom line
    [0.38, 0.49], [0.43, 0.51], [0.48, 0.52], [0.53, 0.52], [0.58, 0.51], [0.63, 0.49],
    // Head + neck
    [0.28, 0.37], [0.25, 0.33], [0.22, 0.28], [0.20, 0.24], [0.19, 0.21], [0.21, 0.18],
    [0.24, 0.17], [0.26, 0.19], [0.27, 0.22], [0.23, 0.23],
    // Ears
    [0.21, 0.14], [0.24, 0.13],
    // Mane
    [0.30, 0.29], [0.33, 0.27], [0.28, 0.25], [0.31, 0.23],
    // Front legs — striking ground
    [0.35, 0.51], [0.34, 0.58], [0.33, 0.64], [0.32, 0.70], [0.32, 0.76],
    [0.39, 0.52], [0.38, 0.59], [0.37, 0.65], [0.36, 0.72],
    // Back legs — pushing off
    [0.63, 0.49], [0.66, 0.54], [0.70, 0.58], [0.74, 0.62], [0.76, 0.66],
    [0.61, 0.51], [0.64, 0.56], [0.68, 0.60], [0.72, 0.64],
    // Tail (flowing)
    [0.72, 0.34], [0.76, 0.31], [0.80, 0.29], [0.84, 0.30], [0.86, 0.32],
    // Body fill
    [0.42, 0.37], [0.48, 0.39], [0.54, 0.37], [0.60, 0.39], [0.45, 0.44], [0.55, 0.44],
    [0.50, 0.41], [0.40, 0.43], [0.58, 0.43],
  ],
  // Pose 3: Gallop — airborne, all legs tucked
  [
    // Body top line (higher — airborne)
    [0.35, 0.31], [0.40, 0.28], [0.45, 0.26], [0.50, 0.25], [0.55, 0.26], [0.60, 0.28],
    [0.65, 0.30], [0.70, 0.31],
    // Body bottom line
    [0.38, 0.46], [0.43, 0.48], [0.48, 0.49], [0.53, 0.49], [0.58, 0.48], [0.63, 0.46],
    // Head + neck (stretched forward)
    [0.28, 0.34], [0.24, 0.30], [0.21, 0.25], [0.18, 0.21], [0.17, 0.18], [0.19, 0.16],
    [0.22, 0.15], [0.24, 0.17], [0.25, 0.20], [0.21, 0.20],
    // Ears
    [0.19, 0.12], [0.22, 0.11],
    // Mane (streaming back)
    [0.29, 0.27], [0.32, 0.24], [0.27, 0.22], [0.30, 0.20],
    // Front legs — folded under
    [0.37, 0.48], [0.39, 0.54], [0.42, 0.58], [0.44, 0.62], [0.43, 0.66],
    [0.40, 0.50], [0.42, 0.55], [0.44, 0.59], [0.45, 0.63],
    // Back legs — folded under
    [0.61, 0.46], [0.59, 0.52], [0.57, 0.56], [0.55, 0.60], [0.54, 0.64],
    [0.59, 0.48], [0.57, 0.53], [0.55, 0.57], [0.54, 0.61],
    // Tail (high, flowing)
    [0.72, 0.30], [0.76, 0.26], [0.80, 0.22], [0.84, 0.20], [0.87, 0.22],
    // Body fill
    [0.42, 0.34], [0.48, 0.36], [0.54, 0.34], [0.60, 0.36], [0.45, 0.41], [0.55, 0.41],
    [0.50, 0.38], [0.40, 0.40], [0.58, 0.40],
  ],
];

const DOT_COLOR = "#f59e0b"; // amber-500 — single uniform color

interface Particle {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  radius: number;
  baseRadius: number;
  phase: number;
  poseIndex: number;
}

export default function ParticleLoader({
  message,
  size = 200,
}: {
  message?: string;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const numPoints = HORSE_POSES[0].length;

    // Create dots — one per point in each pose
    const particles: Particle[] = Array.from({ length: numPoints }, (_, i) => {
      const [px, py] = HORSE_POSES[0][i];
      const x = px * size;
      const y = py * size;
      return {
        x,
        y,
        targetX: x,
        targetY: y,
        radius: 1.5 + Math.random() * 2,
        baseRadius: 1.5 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
        poseIndex: i,
      };
    });

    let time = 0;
    const gallopSpeed = 3.5; // frames per second for gallop cycle

    const animate = () => {
      time += 0.016;
      ctx.clearRect(0, 0, size, size);

      // Determine current pose with smooth interpolation
      const cyclePos = (time * gallopSpeed) % HORSE_POSES.length;
      const poseA = Math.floor(cyclePos) % HORSE_POSES.length;
      const poseB = (poseA + 1) % HORSE_POSES.length;
      const blend = cyclePos - Math.floor(cyclePos);
      // Smooth blend with ease-in-out
      const smoothBlend = blend * blend * (3 - 2 * blend);

      // Subtle vertical bob for gallop feel
      const bob = Math.sin(cyclePos * Math.PI * 2) * 3;

      // Update and draw horse dots
      ctx.fillStyle = DOT_COLOR;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const [ax, ay] = HORSE_POSES[poseA][i];
        const [bx, by] = HORSE_POSES[poseB][i];

        // Interpolate target between poses
        p.targetX = (ax + (bx - ax) * smoothBlend) * size;
        p.targetY = (ay + (by - ay) * smoothBlend) * size + bob;

        // Smooth spring-like movement toward target
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        p.x += dx * 0.12;
        p.y += dy * 0.12;

        // Add micro-jitter for organic feel
        p.x += Math.sin(time * 3 + p.phase) * 0.6;
        p.y += Math.cos(time * 2.5 + p.phase) * 0.6;

        // Pulsing size
        p.radius = p.baseRadius * (0.8 + Math.sin(time * 2 + p.phase) * 0.25);

        // Draw solid dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [size]);

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        className="opacity-90"
      />
      {message && (
        <p className="text-sm text-stone-500 animate-pulse text-center max-w-xs">
          {message}
        </p>
      )}
    </div>
  );
}
