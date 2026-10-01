import { useState, type ChangeEvent } from "react";
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
import { AGENT_PERSONAS, CHAIR_AGENT, LIMITS, isEmail, type BoardPerson } from "../../shared/board";

// Onboarding: the lead enters the organisation, the real people who take part
// in its decisions, and how the shadow board of AI agents is seated.

const BLANK_PERSON: Omit<BoardPerson, "id"> = { name: "", role: "", email: "", phone: "", expertise: "", cv: "" };

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.12em]">
        {label}
      </Label>
      {children}
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
      setFileNote("Only plain-text files can be read here. For a PDF or Word CV, copy its text and paste it below.");
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
      </div>
      <Field id="p-expertise" label="Expertise" hint="What they bring to the board's decisions.">
        <Input id="p-expertise" value={p.expertise ?? ""} maxLength={LIMITS.expertise} onChange={set("expertise")} />
      </Field>
      <Field id="p-cv" label="CV" hint={`Paste their CV or career summary (up to ${LIMITS.cv.toLocaleString()} characters), or load a text file.`}>
        <Textarea id="p-cv" rows={6} value={p.cv ?? ""} maxLength={LIMITS.cv} onChange={set("cv")} />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <label className="cursor-pointer text-xs font-semibold text-primary underline underline-offset-4">
            Load a CV file
            <input type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" onChange={loadCv} />
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

  function removePerson(id: string) {
    const person = org.people.find((p) => p.id === id);
    if (person && window.confirm(`Remove ${person.name} and their CV from this browser?`)) {
      update({ ...org, people: org.people.filter((p) => p.id !== id) });
    }
  }

  const seatedCount = org.agents.filter((a) => a.seated).length;
  const ready = org.name.trim() && org.leadName.trim() && org.people.length > 0;

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
        board. Everything here is saved in this browser.{" "}
        {saved && <span aria-live="polite">Saved.</span>}
      </p>

      <Section title="1. Your organisation">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="org-name" label="Organisation name">
            <Input id="org-name" value={org.name} maxLength={LIMITS.organisation} onChange={setField("name")} data-testid="input-org-name" />
          </Field>
          <Field id="org-sector" label="Sector">
            <Input id="org-sector" value={org.sector} maxLength={120} onChange={setField("sector")} />
          </Field>
          <Field id="lead-name" label="Your name (the lead)" hint="Questionnaires are sent in your name.">
            <Input id="lead-name" value={org.leadName} maxLength={LIMITS.name} onChange={setField("leadName")} data-testid="input-lead-name" />
          </Field>
          <Field id="lead-email" label="Your email">
            <Input id="lead-email" type="email" value={org.leadEmail} maxLength={LIMITS.email} onChange={setField("leadEmail")} />
          </Field>
        </div>
        <div className="mt-4">
          <Field id="org-profile" label="About the organisation" hint="Size, markets, stage, priorities. The agents read this before every question.">
            <Textarea id="org-profile" rows={3} value={org.profile} maxLength={LIMITS.profile} onChange={setField("profile")} />
          </Field>
        </div>
      </Section>

      <Section
        title={`2. The people (${org.people.length})`}
        intro="The real people included in decision making: executives, non-executives and fractional advisers. Each is asked for their input by email and questionnaire when a question involves them."
      >
        {org.people.length > 0 && (
          <ul className="mb-4 divide-y divide-border rounded-md border border-border" data-testid="people-list">
            {org.people.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span aria-hidden className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full bg-[#7FB692]" />
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {p.role} · {p.email}
                      {p.phone ? ` · ${p.phone}` : ""}
                    </p>
                    {p.expertise && <p className="mt-1 text-sm">{p.expertise}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{p.cv ? `CV: ${p.cv.length.toLocaleString()} characters` : "No CV yet"}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removePerson(p.id)} aria-label={`Remove ${p.name}`}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {editing ? (
          <PersonForm key={editing.id} initial={editing} onSave={savePerson} onCancel={() => setEditing(null)} />
        ) : (
          <Button
            variant="outline"
            onClick={() => setEditing({ id: newPersonId(), ...BLANK_PERSON })}
            disabled={org.people.length >= LIMITS.people}
            data-testid="button-add-person"
          >
            Add a person
          </Button>
        )}
      </Section>

      <Section
        title={`3. The shadow board (${seatedCount} of 6 agents)`}
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
        <p className="mt-4 text-xs text-muted-foreground">
          AI agents are not statutory directors and do not vote. The Chair always sits, so every question ends with a recommended resolution for
          your people to adopt or reject.
        </p>
      </Section>

      <Section title="Your data">
        <p className="max-w-3xl text-sm text-muted-foreground">
          People's details and CVs stay in this browser. When you put a question to the board, the names, roles and emails of the people you
          involve are stored with that question so they can answer it, and their CVs are sent to the AI model for that question only.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            if (window.confirm("Clear your organisation, people and agent settings from this browser?")) {
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
