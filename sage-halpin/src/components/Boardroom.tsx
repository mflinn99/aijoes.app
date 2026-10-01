import { useState } from "react";
import { PersonaNode, type Persona } from "./PersonaNode";

// Six seats circle an oval boardroom table. Colors are tuned for legibility
// on the light corporate surface and correspond to the six table wedges.
const PERSONAS: Persona[] = [
  {
    id: "orion",
    name: "GOVERNANCE & COMPLIANCE",
    color: "#475569", // Slate 600
    glowColor: "#94a3b8",
    description: "Validates facts. Demands evidence. Ensures regulatory alignment and structural integrity.",
    symbol: "○",
    position: { x: 50, y: 11 },
  },
  {
    id: "grimm",
    name: "RISK & RESILIENCE",
    color: "#1e293b", // Slate 800
    glowColor: "#475569",
    description: "Maps failure. Guards survival. Thinks downside first and builds organisational resilience.",
    symbol: "◆",
    position: { x: 85, y: 29 },
  },
  {
    id: "solara",
    name: "COMMERCIAL VALUE",
    color: "#B45309", // Amber 700
    glowColor: "#f59e0b",
    description: "Maximises return. Assesses market viability. Connects ethical practice to commercial outcomes.",
    symbol: "◎",
    position: { x: 85, y: 71 },
  },
  {
    id: "aquila",
    name: "PERFORMANCE & STRATEGY",
    color: "#1d4ed8", // Blue 700
    glowColor: "#3b82f6",
    description: "Synthesises conflict. Forces decisions. Owns holistic execution and whole-company outcomes.",
    symbol: "◈",
    position: { x: 50, y: 89 },
  },
  {
    id: "zephyr",
    name: "INNOVATION & SUSTAINABILITY",
    color: "#5B8A6A", // Emerald 600
    glowColor: "#8FB89A",
    description: "Expands options. Reframes problems. Focuses on long-term impact and responsible growth.",
    symbol: "◇",
    position: { x: 15, y: 71 },
  },
  {
    id: "mira",
    name: "CULTURE & ETHICS",
    color: "#991B1B", // Deep Red
    glowColor: "#ef4444",
    description: "Reads people. Senses undercurrents. Champions ethical management and organisational health.",
    symbol: "◉",
    position: { x: 15, y: 29 },
  },
];

export function Boardroom() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div
      className="boardroom-visual relative w-full"
      style={{ aspectRatio: "600 / 390", maxWidth: 680 }}
      data-testid="boardroom"
    >
        {/* SVG oval table, divided into six decision wedges */}
      <svg
          viewBox="0 0 600 390"
        className="absolute inset-0 w-full h-full"
        style={{ overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="tableGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--card))" />
            <stop offset="100%" stopColor="hsl(var(--muted))" />
          </linearGradient>
          <radialGradient id="tableCore" cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="hsl(var(--card))" />
            <stop offset="100%" stopColor="hsl(var(--muted))" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <ellipse cx="300" cy="195" rx="245" ry="135" fill="none" stroke="hsl(var(--primary))" strokeWidth="20" opacity="0.08" className="table-ambient" filter="url(#glow)" />
        {PERSONAS.map((persona, i) => {
          const start = -90 + i * 60;
          const end = start + 60;
          const point = (angle: number) => {
            const radians = (angle * Math.PI) / 180;
            return [300 + 245 * Math.cos(radians), 195 + 135 * Math.sin(radians)];
          };
          const [x1, y1] = point(start);
          const [x2, y2] = point(end);
          return (
            <path
              key={persona.id}
              d={`M 300 195 L ${x1} ${y1} A 245 135 0 0 1 ${x2} ${y2} Z`}
              fill={persona.color}
              fillOpacity={i % 2 === 0 ? 0.1 : 0.065}
              stroke="hsl(var(--border))"
              strokeWidth="1.5"
            />
          );
        })}
        <ellipse cx="300" cy="195" rx="245" ry="135" fill="none" stroke="hsl(var(--border))" strokeWidth="2" />
        <ellipse cx="300" cy="195" rx="83" ry="47" fill="url(#tableCore)" stroke="hsl(var(--border))" strokeWidth="1.5" />
        <text x="294" y="191" textAnchor="middle" fill="hsl(var(--foreground))" fontSize="11" fontWeight="700" letterSpacing="3">SENTINEL</text>
        {/* The 8 on its side: the infinity sign */}
        <text x="342" y="187" textAnchor="middle" dominantBaseline="central" transform="rotate(90 342 187)" fill="hsl(var(--foreground))" fontSize="11" fontWeight="700">8</text>
        <text x="300" y="210" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="7" letterSpacing="1.5">THE EVOLVING BOARD</text>
      </svg>

      {/* Persona Nodes */}
      <div className="boardroom-nodes absolute inset-0">
        {PERSONAS.map((persona) => (
          <PersonaNode
            key={persona.id}
            persona={persona}
            isHovered={hoveredId === persona.id}
            anyHovered={hoveredId !== null}
            onHover={setHoveredId}
          />
        ))}
      </div>
    </div>
  );
}
