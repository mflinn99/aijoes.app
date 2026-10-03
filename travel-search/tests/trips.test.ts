import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { setClock } from "../server/clock.js";
import { MemoryStore, setStore } from "../server/store.js";
import { brief } from "./helpers.js";

beforeEach(() => setStore(new MemoryStore()));
afterEach(() => setClock(null));

const app = () => createApp();

async function savedTrip(opts: { pick?: boolean; key?: string } = {}) {
  const s = await request(app()).post("/api/searches").send(brief()).expect(201);
  const body: Record<string, unknown> = { name: "Sun in autumn" };
  if (opts.pick) body.optionIds = [s.body.options[0].id];
  const r = request(app()).post(`/api/searches/${s.body.id}/save`).send(body);
  if (opts.key) r.set("X-Traveller-Key", opts.key);
  const saved = await r.expect(201);
  return { search: s.body, saved: saved.body };
}

/** Pretend it is the day after the trip ends. */
function afterTrip(trip: { itinerary: { return: string } }) {
  const day = new Date(`${trip.itinerary.return}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  setClock(() => day);
}

describe("save, and my trips", () => {
  it("issues a traveller key on first save, and lists every trip saved with it", async () => {
    const first = await savedTrip();
    const key = first.saved.traveller.key as string;
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const second = await savedTrip({ key });
    expect(second.saved.traveller).toBeUndefined();

    const mine = await request(app()).get("/api/travellers/me/trips").set("X-Traveller-Key", key).expect(200);
    expect(mine.body.map((t: { id: string }) => t.id).sort()).toEqual([first.saved.id, second.saved.id].sort());
    expect(mine.body[0]).toMatchObject({ name: "Sun in autumn", status: "planning", href: expect.stringMatching(/^\/api\/saved\//) });

    await request(app()).get("/api/travellers/me/trips").expect(422);
    await request(app()).get("/api/travellers/me/trips").set("X-Traveller-Key", "x".repeat(32)).expect(404);
  });

  it("choosing an option turns it into a day-by-day itinerary", async () => {
    const { saved } = await savedTrip();
    expect(saved.itinerary).toBeNull();
    expect(saved.status).toBe("planning");
    const chosen = saved.options[1];
    const res = await request(app()).patch(`/api/saved/${saved.id}`).send({ chosenOptionId: chosen.id, myNotes: "Book by Friday", name: "Our trip" }).expect(200);
    expect(res.body).toMatchObject({ name: "Our trip", myNotes: "Book by Friday", chosenOptionId: chosen.id, status: "upcoming" });
    const it = res.body.itinerary;
    expect(it.optionId).toBe(chosen.id);
    expect(it.days).toHaveLength(chosen.dates.nights + 1);
    expect(it.days[0].items[0].text).toMatch(/^Leave: /);
    expect(it.days[0].items.some((i: { text: string }) => i.text.startsWith("Check in"))).toBe(true);
    expect(it.days.at(-1).items.some((i: { text: string }) => i.text.startsWith("Return: "))).toBe(true);
    await request(app()).patch(`/api/saved/${saved.id}`).send({ chosenOptionId: "nope" }).expect(422);
  });

  it("saving a single option makes it the itinerary straight away", async () => {
    const { saved } = await savedTrip({ pick: true });
    expect(saved.chosenOptionId).toBe(saved.options[0].id);
    expect(saved.itinerary.optionId).toBe(saved.options[0].id);
  });

  it("deletes a trip, its share links and its place in my trips", async () => {
    const { saved } = await savedTrip();
    const share = await request(app()).post(`/api/saved/${saved.id}/share`).send({}).expect(201);
    await request(app()).delete(`/api/saved/${saved.id}`).expect(204);
    await request(app()).get(`/api/saved/${saved.id}`).expect(404);
    await request(app()).get(share.body.href).expect(404);
    const mine = await request(app()).get("/api/travellers/me/trips").set("X-Traveller-Key", saved.traveller.key).expect(200);
    expect(mine.body).toEqual([]);
  });
});

describe("share", () => {
  it("gives a read-only link that shows the trip but not the owner's notes, search or links", async () => {
    const { saved } = await savedTrip({ pick: true });
    await request(app()).patch(`/api/saved/${saved.id}`).send({ myNotes: "secret: door code 1234" }).expect(200);
    const share = await request(app()).post(`/api/saved/${saved.id}/share`).send({ label: "Mum" }).expect(201);
    expect(share.body.href).toMatch(/^\/api\/shared\/[A-Za-z0-9_-]{32}$/);
    expect(share.body.share).toMatchObject({ label: "Mum", allowReviews: false });

    const view = await request(app()).get(share.body.href).expect(200);
    expect(view.body.name).toBe("Sun in autumn");
    expect(view.body.itinerary.optionId).toBe(saved.options[0].id);
    const raw = JSON.stringify(view.body);
    expect(raw).not.toContain("door code");
    expect(raw).not.toContain(saved.id);
    expect(raw).not.toContain(saved.from.search);
    expect(view.body.actions.review).toBeUndefined();
    expect(view.body.actions.print.href).toBe(`${share.body.href}/print`);

    const printed = await request(app()).get(`${share.body.href}/print`).expect(200);
    expect(printed.text).toContain("Itinerary");
    expect(printed.text).not.toContain("door code");
  });

  it("the owner sees share links (never the tokens) and can revoke them", async () => {
    const { saved } = await savedTrip();
    const share = await request(app()).post(`/api/saved/${saved.id}/share`).send({}).expect(201);
    const owner = await request(app()).get(`/api/saved/${saved.id}`).expect(200);
    expect(owner.body.shares).toHaveLength(1);
    expect(JSON.stringify(owner.body.shares)).not.toContain(share.body.href.split("/").pop());
    await request(app()).delete(`/api/saved/${saved.id}/shares/${share.body.share.id}`).expect(200);
    await request(app()).get(share.body.href).expect(404);
  });

  it("links can expire", async () => {
    const { saved } = await savedTrip();
    const share = await request(app()).post(`/api/saved/${saved.id}/share`).send({ expiresInDays: 7 }).expect(201);
    await request(app()).get(share.body.href).expect(200);
    setClock(() => new Date(Date.now() + 8 * 86_400_000));
    const gone = await request(app()).get(share.body.href).expect(410);
    expect(gone.body.error).toMatch(/expired/);
  });

  it("an unknown or malformed link is simply not found", async () => {
    await request(app()).get("/api/shared/nope").expect(404);
    await request(app()).get(`/api/shared/${"a".repeat(32)}`).expect(404);
  });
});

describe("review, after the trip", () => {
  it("opens once the trip has started, not before", async () => {
    const { saved } = await savedTrip({ pick: true });
    expect(saved.reviewsOpen).toEqual({ open: false, from: saved.itinerary.depart });
    const early = await request(app()).post(`/api/saved/${saved.id}/reviews`).send({ rating: 5 }).expect(409);
    expect(early.body.error).toMatch(/once it starts on/);
  });

  it("records the traveller's review with aspects, and shows it on the trip, the share and the print", async () => {
    const { saved } = await savedTrip({ pick: true });
    afterTrip(saved);
    const res = await request(app())
      .post(`/api/saved/${saved.id}/reviews`)
      .send({ rating: 4, comment: "Lovely hotel, long journey", aspects: { transport: 3, stay: 5, destination: 4, value: 4 }, wouldGoAgain: true })
      .expect(201);
    expect(res.body.review).toMatchObject({ rating: 4, via: "owner", optionId: saved.options[0].id });
    expect(res.body.trip).toMatchObject({ status: "completed", reviewSummary: { count: 1, averageRating: 4, wouldGoAgain: 1 } });

    const share = await request(app()).post(`/api/saved/${saved.id}/share`).send({}).expect(201);
    const view = await request(app()).get(share.body.href).expect(200);
    expect(view.body.reviews[0]).toMatchObject({ by: "The traveller", rating: 4, comment: "Lovely hotel, long journey" });

    const text = await request(app()).get(`/api/saved/${saved.id}/print?format=text`).expect(200);
    expect(text.text).toContain("Reviews:");
    expect(text.text).toContain("★★★★☆ You (transport 3/5, stay 5/5, destination 4/5, value 4/5), would go again: “Lovely hotel, long journey”");
  });

  it("companions can review through a link that allows it, with their name; view-only links can't", async () => {
    const { saved } = await savedTrip({ pick: true });
    afterTrip(saved);
    const viewOnly = await request(app()).post(`/api/saved/${saved.id}/share`).send({}).expect(201);
    await request(app()).post(`${viewOnly.body.href}/reviews`).send({ by: "Sam", rating: 5 }).expect(422);

    const reviewable = await request(app()).post(`/api/saved/${saved.id}/share`).send({ allowReviews: true, label: "Sam" }).expect(201);
    await request(app()).post(`${reviewable.body.href}/reviews`).send({ rating: 5 }).expect(422);
    const ok = await request(app()).post(`${reviewable.body.href}/reviews`).send({ by: "Sam", rating: 5, comment: "Best week" }).expect(201);
    expect(ok.body.review).toMatchObject({ by: "Sam", rating: 5 });
    const owner = await request(app()).get(`/api/saved/${saved.id}`).expect(200);
    expect(owner.body.reviews.map((r: { by?: string; via: string }) => [r.by, r.via])).toEqual([["Sam", "share"]]);
  });

  it("needs to know which option you went with", async () => {
    const { saved } = await savedTrip();
    const depart = saved.options.map((o: { dates: { return: string } }) => o.dates.return).sort().at(-1);
    setClock(() => new Date(`${depart}T23:00:00Z`));
    const res = await request(app()).post(`/api/saved/${saved.id}/reviews`).send({ rating: 3 }).expect(422);
    expect(res.body.error).toMatch(/Choose which option/);
    await request(app()).post(`/api/saved/${saved.id}/reviews`).send({ rating: 3, optionId: saved.options[2].id }).expect(201);
  });

  it("validates the review", async () => {
    const { saved } = await savedTrip({ pick: true });
    afterTrip(saved);
    await request(app()).post(`/api/saved/${saved.id}/reviews`).send({ rating: 6 }).expect(400);
    await request(app()).post(`/api/saved/${saved.id}/reviews`).send({ rating: 4, aspects: { stay: 0 } }).expect(400);
  });

  it("feeds back into the traveller's next search: a place they disliked drops back, with a note", async () => {
    const { saved } = await savedTrip({ pick: true });
    const place = saved.options[0].destination;
    afterTrip(saved);
    await request(app()).post(`/api/saved/${saved.id}/reviews`).send({ rating: 1, comment: "Never again" }).expect(201);
    setClock(null);

    // The same brief, anonymously, still puts it first...
    const anon = await request(app()).post("/api/searches").send(brief()).expect(201);
    expect(anon.body.options[0].destination.code).toBe(place.code);
    // ...but not for the traveller who disliked it.
    const mine = await request(app()).post("/api/searches").set("X-Traveller-Key", saved.traveller.key).send(brief()).expect(201);
    const again = mine.body.options.find((o: { destination: { code: string } }) => o.destination.code === place.code);
    expect(mine.body.options[0].destination.code).not.toBe(place.code);
    if (again) expect(again.match.watchOuts.join(" ")).toMatch(new RegExp(`you rated ${place.name} 1/5 after your last trip`));
  });

  it("naming the place again wins over an old review", async () => {
    const { saved } = await savedTrip({ pick: true });
    const place = saved.options[0].destination;
    afterTrip(saved);
    await request(app()).post(`/api/saved/${saved.id}/reviews`).send({ rating: 1 }).expect(201);
    setClock(null);
    const res = await request(app()).post("/api/searches").set("X-Traveller-Key", saved.traveller.key).send(brief({ keywords: [place.name] })).expect(201);
    expect(res.body.options[0].destination.code).toBe(place.code);
    expect(res.body.options[0].match.watchOuts.join(" ")).toMatch(/you rated .+ 1\/5 after your last trip/);
  });
});
