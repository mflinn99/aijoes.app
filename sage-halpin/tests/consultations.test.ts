import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { parseOpinion } from "../server/routes/consultations.js";
import { setEmailSenderForTests, type OutgoingEmail } from "../server/email.js";
import { BOOKING_URL, EMAIL_FOOTER_TEXT } from "../shared/contact.js";

// Consultations: a board question put to the people (by questionnaire) and to
// the shadow board of AI agents, seen as people only, agents only or both.
// Runs against the in-memory store and the mock AI provider.

const PEOPLE = [
  { id: "person-ceo1", name: "Alex Morgan", role: "Chief Executive", email: "alex@example.com" },
  { id: "person-cfo1", name: "Sam Patel", role: "Fractional CFO", email: "sam@example.com" },
];

const BOARD_CONTEXT = {
  organisationProfile: "A 120-person instruments maker.",
  people: [
    { name: "Alex Morgan", role: "Chief Executive", expertise: "Operations", cv: "20 years in manufacturing." },
    { name: "Sam Patel", role: "Fractional CFO", expertise: "Transactions", cv: "" },
  ],
  agentBriefs: { grimm: "Watch our bank covenants." },
};

async function createConsultation(app = createApp(), overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/consultations")
    .send({
      organisation: "Harrow & Vale",
      leadName: "Alex Morgan",
      question: "Should we open a second factory?",
      context: "Demand is up 30%.",
      dueDate: "2026-12-01",
      questions: ["What is the main risk?"],
      people: PEOPLE,
      ...overrides,
    })
    .expect(201);
  return { app, id: res.body.id as string, admin: res.body.adminToken as string };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function invite(app: ReturnType<typeof createApp>, id: string, admin: string) {
  const res = await request(app).post(`/api/consultations/${id}/invitations`).set(bearer(admin)).send({}).expect(200);
  return Object.fromEntries(res.body.invitations.map((i: { personId: string; token: string }) => [i.personId, i.token])) as Record<string, string>;
}

afterEach(() => setEmailSenderForTests(null));

describe("questionnaire drafting", () => {
  it("drafts tailored questions, with the standard position and confidence questions", async () => {
    const res = await request(createApp())
      .post("/api/consultations/questionnaire")
      .send({ question: "Should we open a second factory?", roles: ["Chief Executive"] })
      .expect(200);
    expect(res.body.source).toBe("ai");
    expect(res.body.items.length).toBeGreaterThanOrEqual(3);
    expect(res.body.standard.map((q: { id: string }) => q.id)).toEqual(["position", "confidence"]);
  });

  it("requires a question", async () => {
    await request(createApp()).post("/api/consultations/questionnaire").send({}).expect(400);
  });
});

describe("creating a consultation", () => {
  it("returns an id and an admin token, and builds the questionnaire", async () => {
    const { app, id, admin } = await createConsultation();
    const res = await request(app).get(`/api/consultations/${id}`).set(bearer(admin)).expect(200);
    expect(res.body.questionnaire.map((q: { id: string }) => q.id)).toEqual(["position", "confidence", "q1"]);
    expect(res.body.invitees).toHaveLength(2);
    expect(res.body.invitees[0]).not.toHaveProperty("tokenHash");
    expect(res.body.agents).toContain("aquila");
    expect(res.body.status).toBe("open");
  });

  it("always seats the chair agent", async () => {
    const { app, id, admin } = await createConsultation(createApp(), { agents: ["grimm"] });
    const res = await request(app).get(`/api/consultations/${id}`).set(bearer(admin)).expect(200);
    expect(res.body.agents).toEqual(["grimm", "aquila"]);
  });

  it("validates people, emails and limits", async () => {
    const app = createApp();
    const base = { organisation: "O", leadName: "L", question: "Q?" };
    await request(app).post("/api/consultations").send({ ...base, people: [] }).expect(400);
    await request(app)
      .post("/api/consultations")
      .send({ ...base, people: [{ id: "person-1x", name: "A", role: "R", email: "not-an-email" }] })
      .expect(400);
    await request(app)
      .post("/api/consultations")
      .send({ ...base, people: PEOPLE, questions: Array(11).fill("Why?") })
      .expect(400);
    await request(app).post("/api/consultations").send({ ...base, people: PEOPLE, agents: ["nobody"] }).expect(400);
    await request(app).post("/api/consultations").send({ ...base, question: "x".repeat(4001), people: PEOPLE }).expect(400);
  });

  it("hides a consultation from anyone without its admin token", async () => {
    const { app, id } = await createConsultation();
    await request(app).get(`/api/consultations/${id}`).expect(404);
    await request(app).get(`/api/consultations/${id}`).set(bearer("wrong-token")).expect(404);
    await request(app).get(`/api/consultations/not-a-real-id`).set(bearer("x")).expect(404);
  });
});

describe("invitations", () => {
  it("issues a questionnaire link per person (manual email by default)", async () => {
    const { app, id, admin } = await createConsultation();
    const res = await request(app).post(`/api/consultations/${id}/invitations`).set(bearer(admin)).send({}).expect(200);
    expect(res.body.provider).toBe("manual");
    expect(res.body.invitations).toHaveLength(2);
    expect(res.body.invitations[0]).toMatchObject({ emailStatus: "manual", token: expect.any(String) });
  });

  it("emails each person when an email service is configured", async () => {
    const sent: OutgoingEmail[] = [];
    setEmailSenderForTests(async (email) => void sent.push(email));
    process.env.EMAIL_PROVIDER = "acs";
    process.env.PUBLIC_BASE_URL = "https://app.example.com/";
    try {
      const { app, id, admin } = await createConsultation();
      const res = await request(app).post(`/api/consultations/${id}/invitations`).set(bearer(admin)).send({}).expect(200);
      expect(res.body.invitations.every((i: { emailStatus: string }) => i.emailStatus === "sent")).toBe(true);
      expect(sent.map((e) => e.to.address)).toEqual(["alex@example.com", "sam@example.com"]);
      expect(sent[0].text).toContain("https://app.example.com/respond/");
      expect(sent[0].subject).toContain("Should we open a second factory?");
    } finally {
      delete process.env.EMAIL_PROVIDER;
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  it("escapes people's names in the email's HTML", async () => {
    const sent: OutgoingEmail[] = [];
    setEmailSenderForTests(async (email) => void sent.push(email));
    process.env.EMAIL_PROVIDER = "acs";
    process.env.PUBLIC_BASE_URL = "https://app.example.com";
    try {
      const { app, id, admin } = await createConsultation(createApp(), {
        people: [{ id: "person-xss1", name: "<script>x</script>", role: "Adviser", email: "x@example.com" }],
      });
      await request(app).post(`/api/consultations/${id}/invitations`).set(bearer(admin)).send({}).expect(200);
      expect(sent[0].html).not.toContain("<script>");
      expect(sent[0].html).toContain("&lt;script&gt;");
    } finally {
      delete process.env.EMAIL_PROVIDER;
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  it("ends every invitation with the Schedule online footer", async () => {
    const sent: OutgoingEmail[] = [];
    setEmailSenderForTests(async (email) => void sent.push(email));
    process.env.EMAIL_PROVIDER = "acs";
    process.env.PUBLIC_BASE_URL = "https://app.example.com";
    try {
      const { app, id, admin } = await createConsultation();
      await request(app).post(`/api/consultations/${id}/invitations`).set(bearer(admin)).send({}).expect(200);
      for (const email of sent) {
        expect(email.html).toContain(`<a href="${BOOKING_URL}" target="_blank" rel="noopener"`);
        expect(email.html).toContain(">Schedule online</a>");
        expect(email.html).toContain('href="mailto:customer@sentinel8.ai"');
        expect(email.html).toContain('href="tel:+442081291416"');
        expect(email.text.trimEnd().endsWith(EMAIL_FOOTER_TEXT)).toBe(true);
        expect(email.text).toContain(`Schedule online: ${BOOKING_URL}`);
      }
    } finally {
      delete process.env.EMAIL_PROVIDER;
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  it("replaces a person's earlier link when re-sent", async () => {
    const { app, id, admin } = await createConsultation();
    const first = await invite(app, id, admin);
    const second = await request(app)
      .post(`/api/consultations/${id}/invitations`)
      .set(bearer(admin))
      .send({ personIds: ["person-cfo1"] })
      .expect(200);
    expect(second.body.invitations).toHaveLength(1);
    await request(app).get(`/api/respond/${first["person-cfo1"]}`).expect(404);
    await request(app).get(`/api/respond/${second.body.invitations[0].token}`).expect(200);
    await request(app).get(`/api/respond/${first["person-ceo1"]}`).expect(200);
  });
});

describe("answering the questionnaire", () => {
  it("shows the person their question and saves their answers", async () => {
    const { app, id, admin } = await createConsultation();
    const tokens = await invite(app, id, admin);

    const open = await request(app).get(`/api/respond/${tokens["person-cfo1"]}`).expect(200);
    expect(open.body).toMatchObject({ organisation: "Harrow & Vale", respondent: { name: "Sam Patel", role: "Fractional CFO" }, response: null });
    expect(open.body).not.toHaveProperty("invitees");
    expect(open.headers["referrer-policy"]).toBe("no-referrer");

    await request(app)
      .post(`/api/respond/${tokens["person-cfo1"]}`)
      .send({ answers: [{ questionId: "position", value: "oppose" }, { questionId: "confidence", value: "4" }, { questionId: "q1", value: "Cash." }] })
      .expect(200);

    const lead = await request(app).get(`/api/consultations/${id}`).set(bearer(admin)).expect(200);
    expect(lead.body.responses["person-cfo1"].answers).toContainEqual({ questionId: "position", value: "oppose" });
    expect(lead.body.invitees.find((i: { personId: string }) => i.personId === "person-cfo1").respondedAt).toEqual(expect.any(String));
  });

  it("requires the position and confidence answers, and checks their values", async () => {
    const { app, id, admin } = await createConsultation();
    const { "person-ceo1": token } = await invite(app, id, admin);
    await request(app).post(`/api/respond/${token}`).send({ answers: [] }).expect(400);
    await request(app)
      .post(`/api/respond/${token}`)
      .send({ answers: [{ questionId: "position", value: "maybe" }, { questionId: "confidence", value: "3" }] })
      .expect(400);
    await request(app)
      .post(`/api/respond/${token}`)
      .send({ answers: [{ questionId: "position", value: "support" }, { questionId: "confidence", value: "9" }] })
      .expect(400);
  });

  it("rejects unknown links and answers after the consultation closes", async () => {
    const { app, id, admin } = await createConsultation();
    const { "person-ceo1": token } = await invite(app, id, admin);
    await request(app).get(`/api/respond/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`).expect(404);
    await request(app).post(`/api/consultations/${id}/close`).set(bearer(admin)).expect(200);
    await request(app)
      .post(`/api/respond/${token}`)
      .send({ answers: [{ questionId: "position", value: "support" }, { questionId: "confidence", value: "3" }] })
      .expect(409);
  });
});

describe("the three views", () => {
  it("convenes the shadow board, agents only, with positions", async () => {
    const { app, id, admin } = await createConsultation();
    const res = await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send(BOARD_CONTEXT).expect(200);
    expect(res.body.opinions.map((o: { agentId: string }) => o.agentId)).toEqual(["orion", "grimm", "solara", "zephyr", "mira", "aquila"]);
    for (const o of res.body.opinions) {
      expect(o.seat).toMatch(/ agent$/);
      expect(o.persona).toEqual(expect.any(String));
      expect(o.position).toEqual(expect.any(String));
      expect(o.content).not.toMatch(/POSITION:/);
    }
  });

  it("summarises the people, and combines people and agents", async () => {
    const { app, id, admin } = await createConsultation();
    const { "person-ceo1": token } = await invite(app, id, admin);

    await request(app).post(`/api/consultations/${id}/synthesis`).set(bearer(admin)).send({ view: "people" }).expect(409);
    await request(app)
      .post(`/api/respond/${token}`)
      .send({ answers: [{ questionId: "position", value: "support" }, { questionId: "confidence", value: "5" }] })
      .expect(200);

    const people = await request(app).post(`/api/consultations/${id}/synthesis`).set(bearer(admin)).send({ view: "people" }).expect(200);
    expect(people.body).toMatchObject({ content: expect.stringContaining("people"), responses: 1 });

    await request(app).post(`/api/consultations/${id}/synthesis`).set(bearer(admin)).send({ view: "mixed" }).expect(409);
    await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send(BOARD_CONTEXT).expect(200);
    const mixed = await request(app).post(`/api/consultations/${id}/synthesis`).set(bearer(admin)).send({ view: "mixed", ...BOARD_CONTEXT }).expect(200);
    expect(mixed.body.content).toContain("people and agents");

    const lead = await request(app).get(`/api/consultations/${id}`).set(bearer(admin)).expect(200);
    expect(lead.body.shadow.opinions).toHaveLength(6);
    expect(lead.body.syntheses.people).not.toBeNull();
    expect(lead.body.syntheses.mixed).not.toBeNull();
  });

  it("rejects an invalid board context", async () => {
    const { app, id, admin } = await createConsultation();
    await request(app)
      .post(`/api/consultations/${id}/shadow-board`)
      .set(bearer(admin))
      .send({ agentBriefs: { nobody: "x" } })
      .expect(400);
    await request(app)
      .post(`/api/consultations/${id}/shadow-board`)
      .set(bearer(admin))
      .send({ people: [{ name: "A", role: "B", cv: "x".repeat(6001) }] })
      .expect(400);
  });

  it("reads the position and confidence lines from an agent's reply", () => {
    expect(parseOpinion("Analysis.\nPOSITION: support_with_conditions\nCONFIDENCE: 4")).toEqual({
      content: "Analysis.",
      position: "support_with_conditions",
      confidence: 4,
    });
    expect(parseOpinion("No closing lines.")).toEqual({ content: "No closing lines.", position: null, confidence: null });
  });
});

describe("deleting a consultation", () => {
  it("removes it and invalidates every link", async () => {
    const { app, id, admin } = await createConsultation();
    const tokens = await invite(app, id, admin);
    await request(app).delete(`/api/consultations/${id}`).set(bearer(admin)).expect(204);
    await request(app).get(`/api/consultations/${id}`).set(bearer(admin)).expect(404);
    await request(app).get(`/api/respond/${tokens["person-ceo1"]}`).expect(404);
  });
});

describe("limits", () => {
  it("rate-limits the AI steps per client", async () => {
    process.env.RATE_LIMIT_CONSULT_AI_PER_10_MIN = "1";
    try {
      const { app, id, admin } = await createConsultation();
      await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send({}).expect(200);
      await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send({}).expect(429);
    } finally {
      delete process.env.RATE_LIMIT_CONSULT_AI_PER_10_MIN;
    }
  });
});

describe("retention", () => {
  it("sweeps consultations past their retention date, with their answers and links", async () => {
    const { sweepExpired } = await import("../server/routes/consultations.js");
    const { getStore } = await import("../server/store.js");
    const { app, id, admin } = await createConsultation();
    const tokens = await invite(app, id, admin);
    expect(await sweepExpired(getStore(), Date.now())).toBe(0);
    await request(app).get(`/api/consultations/${id}`).set(bearer(admin)).expect(200);

    const inAYear = Date.now() + 366 * 864e5;
    expect(await sweepExpired(getStore(), inAYear)).toBeGreaterThanOrEqual(1);
    await request(app).get(`/api/consultations/${id}`).set(bearer(admin)).expect(404);
    expect(await getStore().get("tokens", "x")).toBeNull();
    await request(app).get(`/api/respond/${tokens["person-ceo1"]}`).expect(404);
  });
});

describe("logging", () => {
  it("keeps questionnaire tokens out of request logs", async () => {
    const { redactUrl } = await import("../server/app.js");
    expect(redactUrl("/api/respond/abcDEF123_-xyz")).toBe("/api/respond/[redacted]");
    expect(redactUrl("/respond/abcDEF123?x=1")).toBe("/respond/[redacted]?x=1");
    expect(redactUrl("/api/consultations/abc")).toBe("/api/consultations/abc");
  });
});
