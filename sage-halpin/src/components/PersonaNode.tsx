import { motion, AnimatePresence } from "framer-motion";

export type Persona = {
  id: string;
  name: string;
  color: string;
  glowColor: string;
  description: string;
  symbol: string;
  position: { x: number; y: number };
};

type PersonaNodeProps = {
  persona: Persona;
  isHovered: boolean;
  anyHovered: boolean;
  onHover: (id: string | null) => void;
};

export function PersonaNode({ persona, isHovered, anyHovered, onHover }: PersonaNodeProps) {
  const opacity = anyHovered ? (isHovered ? 1 : 0.45) : 1;

  return (
    <motion.div
      data-testid={`persona-node-${persona.id}`}
      className="boardroom-persona-node absolute flex flex-col items-center cursor-pointer select-none"
      role="button"
      tabIndex={0}
      aria-label={persona.name}
      aria-expanded={isHovered}
      style={{
        left: `${persona.position.x}%`,
        top: `${persona.position.y}%`,
        x: "-50%",
        y: "-50%",
        zIndex: isHovered ? 50 : 10,
      }}
      animate={{ opacity, scale: isHovered ? 1.05 : 1 }}
      transition={{ duration: 0.3 }}
      onMouseEnter={() => onHover(persona.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onHover(isHovered ? null : persona.id)}
      onFocus={() => onHover(persona.id)}
      onBlur={() => onHover(null)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onHover(isHovered ? null : persona.id);
        }
        if (event.key === "Escape") onHover(null);
      }}
    >
      {/* Node Marker */}
      <div className="relative flex items-center justify-center">
        {/* Glow ring */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 44,
            height: 44,
            background: persona.glowColor,
            opacity: 0.15,
            filter: "blur(4px)",
          }}
          animate={isHovered ? { scale: 1.4, opacity: 0.3 } : { scale: 1, opacity: 0.15 }}
          transition={{ duration: 0.4 }}
        />
        
        {/* Physical token */}
        <div
          className="relative rounded-full border shadow-sm flex items-center justify-center bg-card transition-colors"
          style={{
            width: 32,
            height: 32,
            borderColor: isHovered ? persona.color : "hsl(var(--border))",
            color: isHovered ? persona.color : "hsl(var(--muted-foreground))",
            boxShadow: isHovered ? `0 0 12px ${persona.glowColor}40` : "0 2px 4px rgba(0,0,0,0.05)",
          }}
        >
          <span className="text-[14px] font-serif leading-none">{persona.symbol}</span>
        </div>
      </div>

      {/* Label (always visible) */}
      <div
        className="persona-node-label mt-2 text-center"
        style={{ width: 140 }}
      >
        <span
          className="block font-semibold uppercase tracking-widest text-[9px] transition-colors"
          style={{ color: isHovered ? persona.color : "hsl(var(--foreground))" }}
        >
          {persona.name}
        </span>
      </div>

      {/* Tooltip Card */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="persona-node-detail absolute top-14 bg-card border border-border rounded-md shadow-lg p-4 pointer-events-none"
            style={{ width: 220 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: persona.color }}
              />
              <span
                className="text-[10px] font-bold tracking-widest uppercase"
                style={{ color: persona.color }}
              >
                {persona.name}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed m-0">
              {persona.description}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
