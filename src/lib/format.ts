export function gbp(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (opts.compact !== false && abs >= 1_000_000) return `£${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}m`;
  if (opts.compact !== false && abs >= 10_000) return `£${Math.round(n / 1_000).toLocaleString('en-GB')}k`;
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

export function gbpExact(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function categoryClass(category: string): string {
  return category === 'MAKE_MORE' ? 'make-more' : category === 'SPEND_LESS' ? 'spend-less' : 'msp-expand';
}

export function categoryLabel(category: string): string {
  return category === 'MAKE_MORE' ? 'Make more' : category === 'SPEND_LESS' ? 'Spend less' : 'MSP expand';
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
