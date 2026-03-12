"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseRadius: number;
  color: string;
  alpha: number;
  phase: number;
  speed: number;
  orbitRadius: number;
  orbitAngle: number;
  orbitSpeed: number;
}

const COLORS = [
  "251, 191, 36",   // amber-400
  "245, 158, 11",   // amber-500
  "217, 119, 6",    // amber-600
  "180, 83, 9",     // amber-700
  "253, 230, 138",  // amber-200
  "254, 243, 199",  // amber-100
  "120, 53, 15",    // amber-900
];

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

    const cx = size / 2;
    const cy = size / 2;
    const count = 80;

    const particles: Particle[] = Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const orbitRadius = 20 + Math.random() * 50;
      return {
        x: cx + Math.cos(angle) * orbitRadius,
        y: cy + Math.sin(angle) * orbitRadius,
        vx: 0,
        vy: 0,
        radius: 1 + Math.random() * 2.5,
        baseRadius: 1 + Math.random() * 2.5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        alpha: 0.3 + Math.random() * 0.7,
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.7,
        orbitRadius,
        orbitAngle: angle,
        orbitSpeed: (0.005 + Math.random() * 0.015) * (Math.random() > 0.5 ? 1 : -1),
      };
    });

    let time = 0;

    const animate = () => {
      time += 0.016;
      ctx.clearRect(0, 0, size, size);

      // Breathing center point
      const breathe = Math.sin(time * 0.8) * 0.3 + 1;
      const centerPulse = Math.sin(time * 1.2) * 8;

      // Draw glow behind particles
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
      gradient.addColorStop(0, `rgba(251, 191, 36, ${0.08 * breathe})`);
      gradient.addColorStop(0.5, `rgba(245, 158, 11, ${0.04 * breathe})`);
      gradient.addColorStop(1, "rgba(245, 158, 11, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);

      // Update and draw particles
      for (const p of particles) {
        // Orbital motion
        p.orbitAngle += p.orbitSpeed;

        // Morphing orbit (figure-8 / organic shape)
        const morphX = Math.sin(time * 0.5 + p.phase) * 15;
        const morphY = Math.cos(time * 0.7 + p.phase) * 10;
        const dynamicRadius = p.orbitRadius + Math.sin(time * p.speed + p.phase) * 20 + centerPulse;

        const targetX = cx + Math.cos(p.orbitAngle) * dynamicRadius + morphX;
        const targetY = cy + Math.sin(p.orbitAngle * 2) * dynamicRadius * 0.5 + morphY;

        // Smooth interpolation
        p.x += (targetX - p.x) * 0.04;
        p.y += (targetY - p.y) * 0.04;

        // Pulsing size
        p.radius = p.baseRadius * (1 + Math.sin(time * 2 + p.phase) * 0.4);

        // Pulsing alpha
        const dynamicAlpha = p.alpha * (0.5 + Math.sin(time * 1.5 + p.phase) * 0.5);

        // Draw particle with glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${dynamicAlpha * 0.15})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${dynamicAlpha})`;
        ctx.fill();
      }

      // Draw faint connections between close particles
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 30) {
            const alpha = (1 - dist / 30) * 0.15;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(251, 191, 36, ${alpha})`;
            ctx.stroke();
          }
        }
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
