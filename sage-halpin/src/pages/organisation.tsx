import { useEffect, useState, type ChangeEvent } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WorkspaceShell, Section } from "@/components/WorkspaceShell";
import {
  loadOrganisation,
  saveOrganisation,
  clearOrganisation,
  newPersonId,
  EMPTY_ORGANISATION,
  type Organisation,
} from "@/lib/organisation";
import { syncProfile, workspaceApi } from "@/lib/workspace";
import { GettingStarted } from "@/components/GettingStarted";
import { AccountSecurity } from "@/components/AccountSecurity";
import { libraryOwner } from "@/components/Documents";
import { hasContactDetails } from "@/lib/missing";
import { filesApi } from "@/lib/files";
import { useAccount } from "@/components/AccountProvider";
import { AGENT_PERSONAS, CHAIR_AGENT, LIMITS, isEmail, type BoardPerson } from "../../shared/board";

// Onboarding: the lead enters the organisation, the real people who take part
// in its decisions, and how the shadow board of AI agents is seated.

const BLANK_PERSON: Omit<BoardPerson, "id"> = { name: "", role: "", email: "", phone: "", expertise: "", cv: "", permanent: false };

function Field({ id, label, hint, error, missing, children }: { id: string; label: string; hint?: string; error?: string; missing?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.12em]">
        {label}
        {missing && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900" data-testid={`missing-badge-${id}`}>
            Missing
          </span>
        )}
      </Label>
      {children}
      {error && (
        <p className="text-xs font-semibold text-destructive" data-testid={`error-${id}`}>
          {error}
        </p>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PersonForm({ initial, onSave, onCancel }: { initial: BoardPerson; onSave: (p: BoardPerson) => void; onCancel: () => void }) {
  const [p, setP] = useState(initial);
  const [error, setError] = useState("");
  const [fileNote, setFileNote] = useState("");
  const set = (key: keyof BoardPerson) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP({ ...p, [key]: e.target.value });

  async function loadCv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.(txt|md|text)$/i.test(file.name) && !file.type.startsWith("text/")) {
      // PDF, Word or anything else: Sentinel reads it and writes the career summary.
      setFileNote(`Sentinel is reading ${file.name}…`);
      try {
        const owner = await libraryOwner();
        if (!owner) return setFileNote("Add your contact details above first, then load the CV.");
        const read = await filesApi.upload(owner, file, {
          stage: "organisation",
          instruction: `This is the CV of ${p.name.trim() || "a board member"}${p.role.trim() ? `, ${p.role.trim()}` : ""}. Write their career summary for the board in plain text, under ${LIMITS.cv} characters: roles, sectors, expertise and achievements.`,
        });
        const summary = read.answers.at(-1)?.response?.trim();
        // The CV is used through the person's record, not as a separate board document.
        await filesApi.update(owner, read.id, { useInBoard: false }).catch(() => undefined);
        if (read.status !== "done" || !summary) return setFileNote(read.note ?? "Sentinel couldn't read that CV. Paste its text below instead.");
        setP((prev) => ({ ...prev, cv: summary.slice(0, LIMITS.cv) }));
        setFileNote(`Sentinel read ${file.name} and wrote the summary below. Check and edit it. The file is kept in Documents.`);
      } catch (err) {
        setFileNote(err instanceof Error ? err.message : "The CV could not be read. Paste its text below instead.");
      }
      return;
    }
    const content = (await file.text()).trim();
    setP((prev) => ({ ...prev, cv: content.slice(0, LIMITS.cv) }));
    setFileNote(content.length > LIMITS.cv ? `Loaded the first ${LIMITS.cv.toLocaleString()} characters of ${file.name}.` : `Loaded ${file.name}.`);
  }

  function save() {
    if (!p.name.trim() || !p.role.trim()) return setError("Add a name and a role.");
    if (!isEmail(p.email.trim())) return setError("Add a valid email address: it is where their questionnaires go.");
    onSave({ ...p, name: p.name.trim(), role: p.role.trim(), email: p.email.trim() });
  }

  return (
    <div className="space-y-4 rounded-md border border-border bg-background p-4" data-testid="person-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="p-name" label="Name">
          <Input id="p-name" value={p.name} maxLength={LIMITS.name} onChange={set("name")} autoComplete="off" />
        </Field>
        <Field id="p-role" label="Role" hint="For example Chief Executive, Fractional CFO, Non-executive director">
          <Input id="p-role" value={p.role} maxLength={LIMITS.role} onChange={set("role")} autoComplete="off" />
        </Field>
        <Field id="p-email" label="Email">
          <Input id="p-email" type="email" value={p.email} maxLength={LIMITS.email} onChange={set("email")} autoComplete="off" />
        </Field>
        <Field id="p-phone" label="Phone (optional)">
          <Input id="p-phone" type="tel" value={p.phone ?? ""} maxLength={40} onChange={set("phone")} autoComplete="off" />
        </Field>
        <Field id="p-joined" label="Joined the board" hint="Shown in the checkpoint's history.">
          <Input id="p-joined" type="date" value={p.joinedAt ?? ""} max={new Date().toISOString().slice(0, 10)} onChange={set("joinedAt")} />
        </Field>
      </div>
      <div className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
        <Switch id="p-permanent" checked={p.permanent === true} onCheckedChange={(on) => setP({ ...p, permanent: on })} data-testid="switch-permanent" />
        <Label htmlFor="p-permanent" className="text-sm font-normal">
          <span className="font-semibold">Permanent member.</span> Takes part in every decision that involves people: always asked, and you are
          warned before deciding without their answer. Leave off for people you invite as a question needs them, such as a fractional adviser.
        </Label>
      </div>
      <Field id="p-expertise" label="Expertise" hint="What they bring to the board's decisions.">
        <Input id="p-expertise" value={p.expertise ?? ""} maxLength={LIMITS.expertise} onChange={set("expertise")} />
      </Field>
      <Field id="p-cv" label="CV" hint={`Paste their CV or career summary (up to ${LIMITS.cv.toLocaleString()} characters), or load the CV file (PDF, Word or any other format): Sentinel reads it and writes the summary.`}>
        <Textarea id="p-cv" rows={6} value={p.cv ?? ""} maxLength={LIMITS.cv} onChange={set("cv")} />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <label className="cursor-pointer text-xs font-semibold text-primary underline underline-offset-4">
            Load a CV file
            <input type="file" className="sr-only" onChange={loadCv} data-testid="input-cv-file" />
          </label>
          {fileNote && <span className="text-xs text-muted-foreground">{fileNote}</span>}
        </div>
      </Field>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={save} data-testid="button-save-person">
          Save person
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function OrganisationPage() {
  const [org, setOrg] = useState<Organisation>(loadOrganisation);
  const [editing, setEditing] = useState<BoardPerson | null>(null);
  const [saved, setSaved] = useState(false);
  const [leaving, setLeaving] = useState<{ id: string; date: string } | null>(null);
  const { account } = useAccount();

  function update(next: Organisation) {
    setOrg(saveOrganisation(next));
    setSaved(true);
  }
  const setField = (key: "name" | "sector" | "profile" | "leadName" | "leadEmail") => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    update({ ...org, [key]: e.target.value });

  function savePerson(person: BoardPerson) {
    const exists = org.people.some((p) => p.id === person.id);
    update({ ...org, people: exists ? org.people.map((p) => (p.id === person.id ? person : p)) : [...org.people, person] });
    setEditing(null);
  }

  /** Moves a person to the former members, recording the date they left (today or earlier). */
  function recordLeaving(id: string, leftAt: string) {
    const person = org.people.find((p) => p.id === id);
    if (!person) return;
    update({
      ...org,
      people: org.people.filter((p) => p.id !== id),
      formerPeople: [
        ...(org.formerPeople ?? []),
        { id: person.id, name: person.name, role: person.role, permanent: person.permanent === true, joinedAt: person.joinedAt ?? "", leftAt },
      ],
    });
    setLeaving(null);
  }

  // Keep the server's workspace (agent learning, horizon scanning) in step with the profile.
  useEffect(() => {
    if (!org.name.trim()) return;
    const timer = window.setTimeout(() => {
      syncProfile(loadOrganisation())
        .then(() => setOrg(loadOrganisation()))
        .catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [org.name, org.sector, org.profile]);

  const seatedCount = org.agents.filter((a) => a.seated).length;
  const ready = hasContactDetails(org);

  // Links from "missing information" notes land on the field to fill in.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: "center" });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus();
  }, []);

  return (
    <WorkspaceShell
      title="Your board"
      actions={
        ready ? (
          <Button asChild data-testid="button-ask-question">
            <Link href="/questions/new">Ask the board a question</Link>
          </Button>
        ) : undefined
      }
    >
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Assemble the board once: your organisation, the people who take part in its decisions, and the six AI agents that form its shadow
        board. {account ? "Everything here is saved to your account." : "Everything here is saved in this browser; create an account to keep it across devices."}{" "}
        {saved && <span aria-live="polite">Saved.</span>}
      </p>

      <GettingStarted />

      <Section
        title="1. Contact details (required)"
        id="contact"
        intro="The only part of setting up you can't skip: who the organisation is and how to reach you. Questionnaires are sent in your name."
      >
        <div className="grid gap-4 sm:grid-cols-3" data-testid="contact-details">
          <Field id="org-name" label="Organisation name" error={!org.name.trim() ? "Required" : ""}>
            <Input id="org-name" value={org.name} maxLength={LIMITS.organisation} onChange={setField("name")} required aria-invalid={!org.name.trim()} data-testid="input-org-name" />
          </Field>
          <Field id="lead-name" label="Your name" error={!org.leadName.trim() ? "Required" : ""}>
            <Input id="lead-name" value={org.leadName} maxLength={LIMITS.name} onChange={setField("leadName")} required aria-invalid={!org.leadName.trim()} data-testid="input-lead-name" />
          </Field>
          <Field id="lead-email" label="Your email" error={!org.leadEmail.trim() ? "Required" : !isEmail(org.leadEmail.trim()) ? "Enter a valid email address" : ""}>
            <Input
              id="lead-email"
              type="email"
              value={org.leadEmail}
              maxLength={LIMITS.email}
              onChange={setField("leadEmail")}
              required
              aria-invalid={!isEmail(org.leadEmail.trim())}
              data-testid="input-lead-email"
            />
          </Field>
        </div>
      </Section>

      <Section
        title="2. About the organisation (optional)"
        id="about"
        intro="Can be skipped. The agents read this before every question, so they advise without it if it's missing, and say so."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="org-sector" label="Sector" missing={!org.sector.trim()}>
            <Input id="org-sector" value={org.sector} maxLength={120} onChange={setField("sector")} className={!org.sector.trim() ? "border-amber-400" : ""} />
          </Field>
        </div>
        <div className="mt-4">
          <Field id="org-profile" label="About the organisation" hint="Size, markets, stage, priorities." missing={!org.profile.trim()}>
            <Textarea id="org-profile" rows={3} value={org.profile} maxLength={LIMITS.profile} onChange={setField("profile")} className={!org.profile.trim() ? "border-amber-400" : ""} />
          </Field>
        </div>
      </Section>

      <Section
        id="people"
        title={`3. The people, optional (${org.people.filter((p) => p.permanent).length} permanent, ${org.people.filter((p) => !p.permanent).length} as needed)`}
        intro="The real people included in decision making. Permanent members take part in every decision that involves people; others, such as fractional advisers, are invited when a question needs them. Each is asked for their input by email and questionnaire."
      >
        {org.people.length > 0 && (
          <ul className="mb-4 divide-y divide-border rounded-md border border-border" data-testid="people-list">
            {[...org.people].sort((a, b) => Number(b.permanent === true) - Number(a.permanent === true)).map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span aria-hidden className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full bg-[#7FB692]" />
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {p.name}{" "}
                      <span
                        className={`ml-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${p.permanent ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
                        data-testid={`member-${p.permanent ? "permanent" : "as-needed"}`}
                      >
                        {p.permanent ? "Permanent" : "As needed"}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {p.role} · {p.email}
                      {p.phone ? ` · ${p.phone}` : ""}
                    </p>
                    {p.expertise && <p className="mt-1 text-sm">{p.expertise}</p>}
                    {p.cv && <p className="mt-1 text-xs text-muted-foreground">CV: {p.cv.length.toLocaleString()} characters</p>}
                    {(!p.cv || !p.expertise || !p.joinedAt) && (
                      <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900" data-testid={`missing-person-${p.id}`}>
                        Missing: {[!p.cv && "CV", !p.expertise && "expertise", !p.joinedAt && "date joined"].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setLeaving({ id: p.id, date: new Date().toISOString().slice(0, 10) })}
                    aria-label={`${p.name} leaves the board`}
                    data-testid={`button-leaves-${p.id}`}
                  >
                    Leaves
                  </Button>
                </div>
                {leaving?.id === p.id && (
                  <form
                    className="flex w-full flex-wrap items-end gap-3 rounded-md border border-border bg-background p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (leaving.date) recordLeaving(p.id, leaving.date);
                    }}
                    data-testid="leaving-form"
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor={`left-${p.id}`} className="text-xs font-semibold uppercase tracking-[0.12em]">
                        Left the board on
                      </Label>
                      <Input
                        id={`left-${p.id}`}
                        type="date"
                        required
                        value={leaving.date}
                        min={p.joinedAt || undefined}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setLeaving({ id: p.id, date: e.target.value })}
                      />
                    </div>
                    <p className="max-w-sm flex-1 text-xs text-muted-foreground">
                      {p.name} moves to former members and stays in the checkpoint's history. Their CV is removed.
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" type="submit" data-testid="button-record-leaving">
                        Record as left
                      </Button>
                      <Button size="sm" variant="outline" type="button" onClick={() => setLeaving(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {editing ? (
          <PersonForm key={editing.id} initial={editing} onSave={savePerson} onCancel={() => setEditing(null)} />
        ) : (
          <Button
            variant="outline"
            onClick={() => setEditing({ id: newPersonId(), ...BLANK_PERSON, joinedAt: new Date().toISOString().slice(0, 10) })}
            disabled={org.people.length >= LIMITS.people}
            data-testid="button-add-person"
          >
            Add a person
          </Button>
        )}
        {(org.formerPeople ?? []).length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-muted-foreground">Former members ({org.formerPeople!.length}), kept in the checkpoint's history</summary>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {org.formerPeople!.map((p) => (
                <li key={p.id}>
                  {p.name} · {p.role} · {p.permanent ? "permanent" : "as needed"} · {p.joinedAt ? `joined ${p.joinedAt}, ` : ""}left {p.leftAt}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section
        title={`4. The shadow board (${seatedCount} of 6 agents)`}
        intro="Each AI agent sits in a seat with a persona, and gives its own opinion on every question independently of the people. Its view can be seen on its own, as the shadow board, or alongside the people's. Agents advise; your people decide."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {org.agents.map((seat) => {
            const a = AGENT_PERSONAS[seat.id];
            const chair = seat.id === CHAIR_AGENT;
            return (
              <article
                key={seat.id}
                className={`rounded-md border p-4 transition-opacity ${seat.seated ? "border-border" : "border-dashed border-border opacity-60"}`}
                style={{ borderLeft: `4px solid ${a.colour}` }}
                data-testid={`agent-${seat.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: a.colour }}>
                      {a.symbol} {a.persona}
                    </p>
                    <p className="text-sm font-semibold">{a.seat}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`seat-${seat.id}`} className="text-xs text-muted-foreground">
                      {chair ? "Chairs" : seat.seated ? "Seated" : "Not seated"}
                    </Label>
                    <Switch
                      id={`seat-${seat.id}`}
                      checked={seat.seated}
                      disabled={chair}
                      onCheckedChange={(on) => update({ ...org, agents: org.agents.map((x) => (x.id === seat.id ? { ...x, seated: on } : x)) })}
                    />
                  </div>
                </div>
                <p className="mt-2 text-sm">{a.archetype}</p>
                <dl className="mt-2 space-y-1 text-sm">
                  <div>
                    <dt className="inline font-semibold">Asks first: </dt>
                    <dd className="inline">“{a.asksFirst}”</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold">Watches for: </dt>
                    <dd className="inline">{a.watchesFor.join(", ")}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold">Temperament: </dt>
                    <dd className="inline">{a.temperament}</dd>
                  </div>
                  <div className="text-muted-foreground">
                    <dt className="inline font-semibold">Blind spot it guards against: </dt>
                    <dd className="inline">{a.blindSpot}</dd>
                  </div>
                </dl>
                <div className="mt-3">
                  <Field id={`brief-${seat.id}`} label="Focus for your organisation (optional)">
                    <Textarea
                      id={`brief-${seat.id}`}
                      rows={2}
                      maxLength={LIMITS.brief}
                      value={seat.brief}
                      placeholder={chair ? "For example: weigh the fractional advisers' views on finance heavily." : "For example: watch our bank covenants."}
                      onChange={(e) => update({ ...org, agents: org.agents.map((x) => (x.id === seat.id ? { ...x, brief: e.target.value } : x)) })}
                    />
                  </Field>
                </div>
              </article>
            );
          })}
        </div>
        <p className="mt-4 text-sm">
          Develop each agent in{" "}
          <Link href="/agents" className="font-semibold underline underline-offset-4">
            Agent development
          </Link>
          , and set what the platform watches outside in{" "}
          <Link href="/horizon" className="font-semibold underline underline-offset-4">
            The horizon
          </Link>
          .
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          AI agents are not statutory directors and do not vote. The Chair always sits, so every question ends with a recommended resolution for
          your people to adopt or reject.
        </p>
      </Section>

      <AccountSecurity />

      <Section title="Your data">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {account
            ? "People's details and CVs are kept in this browser and saved to your account, encrypted, so you can sign in on another device. "
            : "People's details and CVs stay in this browser. "}
          When you put a question to the board, the names, roles and emails of the people you
          involve are stored with that question so they can answer it, and their CVs are sent to the AI model for that question only. Your
          organisation's profile, what your agents have learned, your decisions and horizon scans are kept on the server for your workspace.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            if (window.confirm("Clear your organisation, people and agent settings from this browser, and delete what your agents have learned and the horizon scans from the server?")) {
              const link = org.workspace;
              if (link) workspaceApi.remove(link).catch(() => undefined);
              clearOrganisation();
              setOrg(EMPTY_ORGANISATION);
            }
          }}
        >
          Clear board from this browser
        </Button>
      </Section>
    </WorkspaceShell>
  );
}
