"use client";

import { motion } from "framer-motion";

/**
 * Deliberately NOT a literal map of Kenya — a stylized network graph of 47
 * nodes (one per county) fanned around a central hub, with five major
 * cities pulsing. This keeps the "47 counties, nationwide" claim honest
 * (an actual mis-drawn map silhouette would be worse than no map at all)
 * while still giving the stats section a distinctive, on-brand visual.
 */
const HUBS = [
  { name: "Nairobi", angle: -90, r: 0.42 },
  { name: "Mombasa", angle: -18, r: 0.95 },
  { name: "Kisumu", angle: -155, r: 0.85 },
  { name: "Nakuru", angle: -115, r: 0.6 },
  { name: "Eldoret", angle: -135, r: 0.72 },
];

const TOTAL_NODES = 47;

export function KenyaMapSignature() {
  const center = 200;
  const maxRadius = 170;

  const nodes = Array.from({ length: TOTAL_NODES }).map((_, i) => {
    const angle = (i / TOTAL_NODES) * 360 - 90;
    const radius = maxRadius * (0.55 + 0.45 * Math.abs(Math.sin(i * 2.4)));
    const rad = (angle * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
    };
  });

  return (
    <svg
      viewBox="0 0 400 400"
      className="h-full w-full"
      role="img"
      aria-label="Network illustration representing MaliHub's coverage across 47 Kenyan counties"
    >
      {/* Faint connecting lines from center to each county node */}
      {nodes.map((node, i) => (
        <line
          key={i}
          x1={center}
          y1={center}
          x2={node.x}
          y2={node.y}
          stroke="hsl(var(--border))"
          strokeWidth="1"
          opacity="0.5"
        />
      ))}

      {/* County nodes */}
      {nodes.map((node, i) => (
        <circle key={i} cx={node.x} cy={node.y} r="2.5" fill="hsl(var(--muted-foreground))" opacity="0.5" />
      ))}

      {/* Major hub nodes — pulsing */}
      {HUBS.map((hub) => {
        const rad = (hub.angle * Math.PI) / 180;
        const radius = maxRadius * hub.r;
        const x = center + radius * Math.cos(rad);
        const y = center + radius * Math.sin(rad);
        return (
          <g key={hub.name}>
            <line x1={center} y1={center} x2={x} y2={y} stroke="hsl(var(--primary))" strokeWidth="1.5" opacity="0.6" />
            <motion.circle
              cx={x}
              cy={y}
              r="5"
              fill="hsl(var(--cyan))"
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
            <text
              x={x}
              y={y - 12}
              textAnchor="middle"
              className="fill-foreground/70 font-mono"
              fontSize="10"
            >
              {hub.name}
            </text>
          </g>
        );
      })}

      {/* Central hub */}
      <circle cx={center} cy={center} r="10" fill="hsl(var(--primary))" />
      <circle cx={center} cy={center} r="16" fill="none" stroke="hsl(var(--primary))" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}
