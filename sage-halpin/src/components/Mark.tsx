/**
 * The Sentinel8 symbol: six contributors, each a different colour, seated
 * around one oval table, with the infinity sign (the 8 on its side) at its centre. The oval takes currentColor, so the mark sits on
 * light or dark grounds; the six seat colours are fixed.
 */
const SEATS = [
  { cx: 20, cy: 7, fill: '#7FB692' },
  // The white seat carries a fine outline so it still reads on an ivory ground.
  { cx: 34, cy: 13, fill: '#F2EEE4', outline: true },
  { cx: 34, cy: 27, fill: '#D9A15F' },
  { cx: 20, cy: 33, fill: '#6FA8D6' },
  { cx: 6, cy: 27, fill: '#E07F6A' },
  { cx: 6, cy: 13, fill: '#A99BDA' },
];

export function Mark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <ellipse cx="20" cy="20" rx="11.5" ry="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M20 20C18 17.2 13.5 17.2 13.5 20C13.5 22.8 18 22.8 20 20C22 17.2 26.5 17.2 26.5 20C26.5 22.8 22 22.8 20 20Z" fill="none" stroke="#B28A56" strokeWidth="1.4" />
      {SEATS.map((seat) => (
        <circle
          key={`${seat.cx}-${seat.cy}`}
          cx={seat.cx}
          cy={seat.cy}
          r="3"
          fill={seat.fill}
          stroke={'outline' in seat ? 'currentColor' : undefined}
          strokeWidth={'outline' in seat ? 0.8 : undefined}
        />
      ))}
    </svg>
  );
}
