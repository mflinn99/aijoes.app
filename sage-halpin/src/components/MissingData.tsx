import { Link } from "wouter";
import { loadOrganisation } from "@/lib/organisation";
import { missingFor, type Use } from "@/lib/missing";

// Highlights what was skipped in setting up, where it is used: the board
// works without it, but says what it is missing and links to fill it in.

export function MissingData({ use, personIds, className = "mb-6" }: { use: Use; personIds?: string[]; className?: string }) {
  const items = missingFor(use, loadOrganisation(), personIds);
  if (!items.length) return null;
  return (
    <aside className={`${className} rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950`} data-testid="missing-data" aria-label="Missing information">
      <p className="text-sm font-semibold">Missing information. Sentinel will carry on without it, but the board's advice is better with it:</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {items.map((m) => (
          <li key={m.key} className="flex flex-wrap items-baseline gap-x-2" data-testid={`missing-${m.key}`}>
            <span className="font-semibold">{m.label}.</span>
            <span>{m.why}</span>
            <Link href={m.href} className="font-semibold underline underline-offset-4">
              {m.action}
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
