import { useEffect, useState } from "react";
import { Link } from "wouter";
import { WorkspaceShell, Section } from "@/components/WorkspaceShell";
import { DocumentList, libraryOwner } from "@/components/Documents";
import { loadOrganisation } from "@/lib/organisation";
import type { FileOwner } from "@/lib/files";

// The company admin's document library: every file attached from any page,
// what Sentinel did with each, and whether the board uses it when advising.

export default function DocumentsPage() {
  const org = loadOrganisation();
  const [owner, setOwner] = useState<FileOwner | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!org.name.trim()) return;
    libraryOwner()
      .then(setOwner)
      .catch((e) => setError(e instanceof Error ? e.message : "The documents could not be opened."));
  }, [org.name]);

  return (
    <WorkspaceShell title="Documents">
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Attach any file, at any stage, and tell Sentinel what to do with it. Sentinel reads it, answers your instruction and keeps a digest that the
        board's agents use when they advise, unless you switch that off. Files for one board question belong on that question, where they can be shared
        with the people asked.
      </p>
      {!org.name.trim() ? (
        <p className="text-sm">
          First add your contact details in{" "}
          <Link href="/organisation" className="font-semibold underline underline-offset-4">
            Your board
          </Link>
          . Everything else in setting up can be skipped.
        </p>
      ) : (
        <Section title="Company documents">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {owner ? (
            <DocumentList owner={owner} stage="library" emptyText="No documents yet. Board packs, strategy papers, accounts, policies and contracts all help the board advise." />
          ) : (
            !error && <p className="text-sm text-muted-foreground">Opening…</p>
          )}
        </Section>
      )}
    </WorkspaceShell>
  );
}
