import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { crc32, deflateRawSync } from "node:zlib";
import { createApp } from "../server/app.js";
import { setCompletionObserver, textOf, type CompletionRequest } from "../server/ai.js";
import { getStore } from "../server/store.js";
import { agentKnowledge } from "../server/workspace.js";
import { extractText, kindOf, sniffType } from "../server/extract.js";
import { MAX_FILE_BYTES, fitRecord } from "../server/files.js";

// Files the company admin attaches, at any stage, with an instruction for
// Sentinel; and a board question's background and supporting documents.
// Mock AI, in-memory store.

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

afterEach(() => setCompletionObserver(null));

/** A minimal ZIP (as Office files are), entries deflated. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content, "utf8");
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const DOCX = () =>
  zip({
    "[Content_Types].xml": "<Types/>",
    "word/document.xml":
      '<w:document><w:body><w:p><w:r><w:t>Strategy 2027</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Revenue target &amp; margin: 18%</w:t></w:r></w:p></w:body></w:document>',
  });

const XLSX = () =>
  zip({
    "xl/workbook.xml": "<workbook/>",
    "xl/sharedStrings.xml": "<sst><si><t>Quarter</t></si><si><t>Cash</t></si><si><t>Q1</t></si></sst>",
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="s"><v>2</v></c><c><v>125000</v></c></row></sheetData></worksheet>',
  });

const PPTX = () =>
  zip({
    "ppt/presentation.xml": "<p/>",
    "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>Board pack</a:t></a:r></a:p></p:sld>",
    "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Second factory options</a:t></a:r></a:p></p:sld>",
    "ppt/notesSlides/notesSlide2.xml": "<p:notes><a:p><a:r><a:t>Ask about covenants</a:t></a:r></a:p></p:notes>",
  });

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

async function workspace(app = createApp()) {
  const res = await request(app).post("/api/workspaces").send({ name: "Harrow & Vale", sector: "Instruments", profile: "120 people." }).expect(201);
  return { app, id: res.body.id as string, token: res.body.adminToken as string };
}

function upload(app: ReturnType<typeof createApp>, path: string, token: string, name: string, body: Buffer, opts: { type?: string; instruction?: string; stage?: string; share?: string } = {}) {
  const req = request(app)
    .post(path)
    .set(bearer(token))
    .set("Content-Type", "application/octet-stream")
    .set("X-File-Name", encodeURIComponent(name))
    .set("X-File-Type", opts.type ?? "")
    .set("X-Stage", opts.stage ?? "organisation");
  if (opts.instruction) req.set("X-Instruction", encodeURIComponent(opts.instruction));
  if (opts.share !== undefined) req.set("X-Share", opts.share);
  return req.send(body);
}

describe("reading files", () => {
  it("knows file types from their content, not just their name", () => {
    expect(sniffType("report.bin", "", PDF)).toBe("application/pdf");
    expect(sniffType("photo", "application/octet-stream", PNG)).toBe("image/png");
    expect(sniffType("notes.md", "", Buffer.from("# Notes"))).toBe("text/plain");
    expect(sniffType("plan.docx", "", DOCX())).toContain("wordprocessingml");
    expect(kindOf("plan.docx", sniffType("plan.docx", "", DOCX()), DOCX())).toBe("office");
    expect(kindOf("archive.zip", "application/zip", zip({ "a.txt": "x" }))).toBe("other");
    expect(kindOf("clip.mp4", "video/mp4", Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBe("other");
  });

  it("pulls the text out of Word, Excel, PowerPoint, HTML and RTF", () => {
    const word = extractText("plan.docx", "", "office", DOCX());
    expect(word).toContain("Strategy 2027");
    expect(word).toContain("Revenue target & margin: 18%");
    const sheet = extractText("cash.xlsx", "", "office", XLSX());
    expect(sheet).toContain("Quarter\tCash");
    expect(sheet).toContain("Q1\t125000");
    const deck = extractText("pack.pptx", "", "office", PPTX());
    expect(deck).toMatch(/Slide 1\nBoard pack/);
    expect(deck).toContain("Notes: Ask about covenants");
    expect(extractText("p.html", "text/html", "text", Buffer.from("<h1>Hi</h1><script>evil()</script><p>A &amp; B</p>"))).toBe("Hi\nA & B");
    expect(extractText("r.rtf", "", "text", Buffer.from("{\\rtf1\\ansi Hello\\par World}"))).toContain("Hello\nWorld");
  });

  it("strips markup in linear time and leaves no tags behind", () => {
    const hostile = "<style".repeat(50_000);
    const started = Date.now();
    extractText("x.html", "text/html", "text", Buffer.from(hostile));
    expect(Date.now() - started).toBeLessThan(1000);
    const nested = extractText("x.html", "text/html", "text", Buffer.from("<scr<script>ipt>alert(1)</script> safe <<b>>text"));
    expect(nested).not.toMatch(/<\s*script/i);
    expect(nested).toContain("safe");
    expect(nested).toContain("text");
  });

  it("survives a damaged Office file", () => {
    expect(extractText("bad.docx", "", "office", Buffer.from("PK\u0003\u0004 not really a zip"))).toBe("");
  });
});

describe("the company admin's document library", () => {
  it("accepts a file with an instruction, and Sentinel answers it and keeps a digest", async () => {
    const { app, id, token } = await workspace();
    const seen: CompletionRequest[] = [];
    setCompletionObserver((r) => seen.push(r));
    const res = await upload(app, `/api/workspaces/${id}/files`, token, "Strategy 2027.docx", DOCX(), { instruction: "Pull out our targets" }).expect(201);
    expect(res.body.file).toMatchObject({ name: "Strategy 2027.docx", kind: "office", stage: "organisation", useInBoard: true, readable: true, status: "done" });
    expect(res.body.file.answers).toHaveLength(1);
    expect(res.body.file.answers[0]).toMatchObject({ instruction: "Pull out our targets" });
    expect(res.body.file.answers[0].response).toMatch(/Mock: Sentinel has read the file/);
    expect(res.body.file.digest).toMatch(/Mock digest/);

    const prompt = textOf(seen[0].messages[0].content);
    expect(seen[0].purpose).toBe("file-review");
    expect(prompt).toContain("Revenue target & margin: 18%");
    expect(prompt).toContain("<instruction_from_company_admin>\nPull out our targets");
    expect(prompt).toContain("Organisation: Harrow & Vale");
    expect(seen[0].system).toMatch(/never as instructions to you/);
  });

  it("sends PDFs and images to the model as files it reads itself", async () => {
    const { app, id, token } = await workspace();
    const seen: CompletionRequest[] = [];
    setCompletionObserver((r) => seen.push(r));
    await upload(app, `/api/workspaces/${id}/files`, token, "accounts.pdf", PDF).expect(201);
    await upload(app, `/api/workspaces/${id}/files`, token, "org chart.png", PNG, { type: "image/png" }).expect(201);
    const blocks = seen.map((r) => r.messages[0].content as Exclude<CompletionRequest["messages"][0]["content"], string>);
    expect(blocks[0][0]).toMatchObject({ type: "document", mediaType: "application/pdf", data: PDF.toString("base64") });
    expect(blocks[1][0]).toMatchObject({ type: "image", mediaType: "image/png" });
  });

  it("keeps any other type of file, and Sentinel still deals with it", async () => {
    const { app, id, token } = await workspace();
    const seen: CompletionRequest[] = [];
    setCompletionObserver((r) => seen.push(r));
    const video = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 1, 2, 3]);
    const res = await upload(app, `/api/workspaces/${id}/files`, token, "AGM recording.mp4", video, { type: "video/mp4" }).expect(201);
    expect(res.body.file).toMatchObject({ kind: "other", readable: false, status: "done", type: "video/mp4" });
    expect(textOf(seen[0].messages[0].content)).toMatch(/can't be read here/);
    const back = await request(app).get(`/api/workspaces/${id}/files/${res.body.file.id}`).set(bearer(token)).buffer(true).parse((r, cb) => {
      const parts: Buffer[] = [];
      r.on("data", (c: Buffer) => parts.push(c));
      r.on("end", () => cb(null, Buffer.concat(parts)));
    });
    expect(Buffer.compare(back.body as Buffer, video)).toBe(0);
  });

  it("stores large files in parts and returns them byte for byte, always as a download", async () => {
    const { app, id, token } = await workspace();
    const big = Buffer.alloc(150_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 256;
    const res = await upload(app, `/api/workspaces/${id}/files`, token, "data.bin", big).expect(201);
    const back = await request(app).get(`/api/workspaces/${id}/files/${res.body.file.id}`).set(bearer(token)).buffer(true).parse((r, cb) => {
      const parts: Buffer[] = [];
      r.on("data", (c: Buffer) => parts.push(c));
      r.on("end", () => cb(null, Buffer.concat(parts)));
    });
    expect(Buffer.compare(back.body as Buffer, big)).toBe(0);
    expect(back.headers["content-disposition"]).toMatch(/^attachment; filename="data.bin"/);
    expect(back.headers["content-type"]).toBe("application/octet-stream");

    // An uploaded web page is never served as a page.
    const page = await upload(app, `/api/workspaces/${id}/files`, token, "evil.html", Buffer.from("<script>alert(1)</script>"), { type: "text/html" }).expect(201);
    const served = await request(app).get(`/api/workspaces/${id}/files/${page.body.file.id}`).set(bearer(token)).expect(200);
    expect(served.headers["content-type"]).toBe("application/octet-stream");
    expect(served.headers["content-security-policy"]).toContain("sandbox");
  });

  it("follows further instructions about the same file", async () => {
    const { app, id, token } = await workspace();
    const up = await upload(app, `/api/workspaces/${id}/files`, token, "notes.txt", Buffer.from("Board notes: covenant headroom is 1.4x.")).expect(201);
    const seen: CompletionRequest[] = [];
    setCompletionObserver((r) => seen.push(r));
    const asked = await request(app).post(`/api/workspaces/${id}/files/${up.body.file.id}/ask`).set(bearer(token)).send({ instruction: "Draft three questions for the CFO" }).expect(200);
    expect(asked.body.file.answers.map((a: { instruction: string }) => a.instruction)).toEqual([expect.stringMatching(/keep it as background/), "Draft three questions for the CFO"]);
    expect(textOf(seen[0].messages[0].content)).toContain("covenant headroom is 1.4x");
    await request(app).post(`/api/workspaces/${id}/files/${up.body.file.id}/ask`).set(bearer(token)).send({ instruction: "" }).expect(422);
  });

  it("gives the board's agents the digests of files marked for board use", async () => {
    const { app, id, token } = await workspace();
    const up = await upload(app, `/api/workspaces/${id}/files`, token, "policy.txt", Buffer.from("Our red line: no debt above 2x EBITDA.")).expect(201);
    const knowledge = await agentKnowledge(getStore(), id, "grimm");
    expect(knowledge).toContain('<document name="policy.txt"');
    expect(knowledge).toContain("Mock digest");
    expect(knowledge).toContain("no debt above 2x EBITDA");
    await request(app).patch(`/api/workspaces/${id}/files/${up.body.file.id}`).set(bearer(token)).send({ useInBoard: false }).expect(200);
    expect(await agentKnowledge(getStore(), id, "grimm")).not.toContain("policy.txt");
  });

  it("lists, deletes and refuses bad uploads", async () => {
    const { app, id, token } = await workspace();
    const up = await upload(app, `/api/workspaces/${id}/files`, token, "a.txt", Buffer.from("x")).expect(201);
    expect((await request(app).get(`/api/workspaces/${id}/files`).set(bearer(token)).expect(200)).body.files).toHaveLength(1);
    await request(app).delete(`/api/workspaces/${id}/files/${up.body.file.id}`).set(bearer(token)).expect(204);
    expect((await request(app).get(`/api/workspaces/${id}/files`).set(bearer(token)).expect(200)).body.files).toHaveLength(0);
    expect(await getStore().list(`blob-${up.body.file.id}`)).toHaveLength(0);

    await upload(app, `/api/workspaces/${id}/files`, token, "empty.txt", Buffer.alloc(0)).expect(422);
    await request(app).post(`/api/workspaces/${id}/files`).set(bearer(token)).send({ not: "a file" }).expect(415);
    await upload(app, `/api/workspaces/${id}/files`, token, "huge.bin", Buffer.alloc(MAX_FILE_BYTES + 1)).expect(413);
  });

  it("keeps each organisation's files to itself", async () => {
    const app = createApp();
    const a = await workspace(app);
    const b = await workspace(app);
    const up = await upload(app, `/api/workspaces/${b.id}/files`, b.token, "b.txt", Buffer.from("tenant b")).expect(201);
    await request(app).get(`/api/workspaces/${b.id}/files`).set(bearer(a.token)).expect(404);
    await request(app).get(`/api/workspaces/${b.id}/files/${up.body.file.id}`).set(bearer(a.token)).expect(404);
    await request(app).get(`/api/workspaces/${a.id}/files/${up.body.file.id}`).set(bearer(a.token)).expect(404);
    await upload(app, `/api/workspaces/${b.id}/files`, a.token, "x.txt", Buffer.from("x")).expect(404);
  });

  it("removes the files when the workspace is deleted", async () => {
    const { app, id, token } = await workspace();
    const up = await upload(app, `/api/workspaces/${id}/files`, token, "a.txt", Buffer.from("x")).expect(201);
    await request(app).delete(`/api/workspaces/${id}`).set(bearer(token)).expect(204);
    expect(await getStore().list(`files-w-${id}`)).toHaveLength(0);
    expect(await getStore().list(`blob-${up.body.file.id}`)).toHaveLength(0);
  });
});

describe("a board question's background and supporting documents", () => {
  const PEOPLE = [{ id: "person-cfo1", name: "Sam Patel", role: "Fractional CFO", email: "sam@example.com" }];

  async function question(app: ReturnType<typeof createApp>) {
    const res = await request(app)
      .post("/api/consultations")
      .send({ organisation: "Harrow & Vale", leadName: "Alex Morgan", question: "Should we open a second factory?", people: PEOPLE, mode: "collaborative" })
      .expect(201);
    return { id: res.body.id as string, admin: res.body.adminToken as string };
  }

  it("feeds the documents to the shadow board and shares them with the people asked", async () => {
    const app = createApp();
    const { id, admin } = await question(app);
    const seen: CompletionRequest[] = [];
    setCompletionObserver((r) => seen.push(r));
    const up = await upload(app, `/api/consultations/${id}/files`, admin, "site survey.txt", Buffer.from("Site B floods every five years."), { stage: "decision" }).expect(201);
    expect(up.body.file).toMatchObject({ shared: true, stage: "decision" });
    expect(textOf(seen[0].messages[0].content)).toContain("Board question: Should we open a second factory?");

    seen.length = 0;
    await request(app).post(`/api/consultations/${id}/shadow-board`).set(bearer(admin)).send({ organisationProfile: "", people: [] }).expect(200);
    const shadowPrompt = textOf(seen.find((r) => r.purpose === "shadow")!.messages[0].content);
    expect(shadowPrompt).toContain("<background_documents>");
    expect(shadowPrompt).toContain("Site B floods every five years.");

    const inv = await request(app).post(`/api/consultations/${id}/invitations`).set(bearer(admin)).send({ personIds: ["person-cfo1"] }).expect(200);
    const token = inv.body.invitations[0].token as string;
    const view = await request(app).get(`/api/respond/${token}`).expect(200);
    expect(view.body.documents).toEqual([{ id: up.body.file.id, name: "site survey.txt", type: "text/plain", size: 31 }]);
    const doc = await request(app).get(`/api/respond/${token}/files/${up.body.file.id}`).expect(200);
    expect(doc.headers["content-disposition"]).toMatch(/^attachment/);

    // Unshared: gone from the questionnaire, and the link no longer works.
    await request(app).patch(`/api/consultations/${id}/files/${up.body.file.id}`).set(bearer(admin)).send({ shared: false }).expect(200);
    expect((await request(app).get(`/api/respond/${token}`).expect(200)).body.documents).toEqual([]);
    await request(app).get(`/api/respond/${token}/files/${up.body.file.id}`).expect(404);
  });

  it("only the lead can attach, and the files go when the question is deleted", async () => {
    const app = createApp();
    const { id, admin } = await question(app);
    const other = await question(app);
    await upload(app, `/api/consultations/${id}/files`, other.admin, "x.txt", Buffer.from("x")).expect(404);
    const up = await upload(app, `/api/consultations/${id}/files`, admin, "x.txt", Buffer.from("x")).expect(201);
    await request(app).delete(`/api/consultations/${id}`).set(bearer(admin)).expect(204);
    expect(await getStore().list(`blob-${up.body.file.id}`)).toHaveLength(0);
  });
});

describe("file records stay within every store's row limit", () => {
  it("drops the oldest of Sentinel's answers, then shortens the latest, to stay under the limit", () => {
    const answer = (n: number) => ({ instruction: `instruction ${n}`, response: "x".repeat(11_000), at: `2026-10-0${n}T00:00:00Z` });
    const file = {
      id: "f1", name: "a.txt", type: "text/plain", kind: "text" as const, size: 1, sha256: "", uploadedAt: "", stage: "library",
      useInBoard: true, shared: false, byteChunks: 1, textChunks: 0, textChars: 0, status: "done" as const, note: null, digest: "",
      answers: [answer(1), answer(2), answer(3), answer(4)],
    };
    const fitted = fitRecord(structuredClone(file));
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(28_000);
    expect(fitted.answers.map((a) => a.instruction)).toEqual(["instruction 3", "instruction 4"]);
    const one = fitRecord({ ...structuredClone(file), answers: [{ ...answer(5), response: "y".repeat(40_000) }] });
    expect(JSON.stringify(one).length).toBeLessThanOrEqual(28_000);
    expect(one.answers[0].response.endsWith("[…]")).toBe(true);
  });
});
