// One loading mark for a page whose data is on its way. Pages show this until
// everything they need has arrived, then render it all at once, so nothing
// jumps as sections fill in.

const SEATS: [number, number, string][] = [
  [20, 7, "#7FB692"],
  [34, 13, "#F2EEE4"],
  [34, 27, "#D9A15F"],
  [20, 33, "#6FA8D6"],
  [6, 27, "#E07F6A"],
  [6, 13, "#A99BDA"],
];

export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[50vh] flex-col items-center justify-center gap-4" data-testid="page-loader">
      <svg viewBox="0 0 40 40" width={64} height={64} aria-hidden="true" className="page-loader-mark">
        <ellipse cx="20" cy="20" rx="11.5" ry="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M20 20C18 17.2 13.5 17.2 13.5 20C13.5 22.8 18 22.8 20 20C22 17.2 26.5 17.2 26.5 20C26.5 22.8 22 22.8 20 20Z" fill="none" stroke="#B28A56" strokeWidth="1.4" />
        {SEATS.map(([cx, cy, fill], i) => (
          <circle key={i} cx={cx} cy={cy} r="3" fill={fill} stroke={i === 1 ? "currentColor" : undefined} strokeWidth={i === 1 ? 0.8 : undefined} style={{ animationDelay: `${i * 0.25}s` }} />
        ))}
      </svg>
      <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
    </div>
  );
}
