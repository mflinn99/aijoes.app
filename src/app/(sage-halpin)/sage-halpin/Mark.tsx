/**
 * The Sage Halpin symbol: a constellation of nodes around one continuous
 * central line. Circles are people, diamonds are agents; the line is the
 * organisation's memory. Drawn in currentColor so it works as a single-colour
 * static shape at any size.
 */
export function Mark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <line x1="3" y1="17" x2="29" y2="17" strokeWidth="2" strokeLinecap="round" />
      <line x1="9" y1="9" x2="11" y2="17" strokeWidth="0.9" opacity="0.6" />
      <line x1="21" y1="25" x2="20" y2="17" strokeWidth="0.9" opacity="0.6" />
      <circle cx="9" cy="8" r="2.4" strokeWidth="1.4" />
      <circle cx="21.5" cy="26" r="2.4" strokeWidth="1.4" />
      <rect x="17.2" y="5.2" width="3.6" height="3.6" transform="rotate(45 19 7)" fill="currentColor" stroke="none" />
      <rect x="6.2" y="23.2" width="3.2" height="3.2" transform="rotate(45 7.8 24.8)" fill="currentColor" stroke="none" />
      <circle cx="27" cy="10" r="1.3" fill="currentColor" stroke="none" opacity="0.55" />
    </svg>
  );
}
