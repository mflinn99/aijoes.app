import { distanceKm, PLACES, type Place } from "./places.js";

// The ground (and sea) network, as far as the platform needs to know it: which
// places share a landmass, where the main stations are, which ferry routes run,
// and how the Channel and the Irish Sea are crossed. Live rail, coach and ferry
// prices come from providers; this decides what is plausible, names the hubs
// that count as "the starting point", and drives the car estimate.

export type Landmass = "GB" | "IE" | "EU" | "NA" | "island" | "other";

const LANDMASS: Record<string, Landmass> = {
  LON: "GB", MAN: "GB", BHX: "GB", BRS: "GB", EDI: "GB", GLA: "GB", NCL: "GB",
  DUB: "IE", BFS: "IE",
  PAR: "EU", AMS: "EU", FRA: "EU", BCN: "EU", MAD: "EU", AGP: "EU", SVQ: "EU", LIS: "EU", FAO: "EU",
  ROM: "EU", MIL: "EU", VCE: "EU", NAP: "EU", ATH: "EU", DBV: "EU", SPU: "EU", PRG: "EU", BUD: "EU",
  KRK: "EU", BER: "EU", MUC: "EU", VIE: "EU", CPH: "EU", GVA: "EU", INN: "EU", IST: "EU", DLM: "EU",
  NYC: "NA", LAX: "NA", CHI: "NA", YTO: "NA", MIA: "NA", ORL: "NA",
  PMI: "island", IBZ: "island", TFS: "island", LPA: "island", FNC: "island", CAG: "island", JTR: "island",
  CFU: "island", HER: "island", MLA: "island", REK: "island", BGI: "island", MLE: "island", ZNZ: "island", DPS: "island",
};

export function landmass(code: string): Landmass {
  return LANDMASS[code] ?? "other";
}

/** Main rail stations; the first is used for international departures. */
const STATIONS: Record<string, string[]> = {
  LON: ["London St Pancras International", "London King's Cross", "London Euston", "London Paddington"],
  MAN: ["Manchester Piccadilly"],
  BHX: ["Birmingham New Street"],
  BRS: ["Bristol Temple Meads"],
  EDI: ["Edinburgh Waverley"],
  GLA: ["Glasgow Central"],
  NCL: ["Newcastle Central"],
  DUB: ["Dublin Connolly"],
  BFS: ["Belfast Grand Central"],
  PAR: ["Paris Gare du Nord", "Paris Gare de Lyon"],
  AMS: ["Amsterdam Centraal"],
  BER: ["Berlin Hauptbahnhof"],
  MUC: ["München Hauptbahnhof"],
  VIE: ["Wien Hauptbahnhof"],
  BCN: ["Barcelona Sants"],
  MAD: ["Madrid Atocha"],
  ROM: ["Roma Termini"],
  MIL: ["Milano Centrale"],
  VCE: ["Venezia Santa Lucia"],
  PRG: ["Praha hlavní nádraží"],
  CPH: ["København H"],
  GVA: ["Genève Cornavin"],
  INN: ["Innsbruck Hauptbahnhof"],
};

const COACH_STATIONS: Record<string, string> = {
  LON: "London Victoria Coach Station",
  PAR: "Paris Bercy Seine",
  AMS: "Amsterdam Sloterdijk",
};

export function railStations(p: Place): string[] {
  if (STATIONS[p.code]) return STATIONS[p.code]!;
  const lm = landmass(p.code);
  return lm === "GB" || lm === "IE" || lm === "EU" ? [`${p.name} Central`] : [];
}

export function coachStation(p: Place): string | undefined {
  const lm = landmass(p.code);
  if (lm !== "GB" && lm !== "IE" && lm !== "EU") return undefined;
  return COACH_STATIONS[p.code] ?? `${p.name} Coach Station`;
}

export interface FerryRoute {
  from: string;
  to: string;
  fromPort: string;
  toPort: string;
  hours: number;
  /** Return fare per foot passenger, GBP. */
  fareGBP: number;
  operator: string;
}

const FERRIES: FerryRoute[] = [
  { from: "BCN", to: "PMI", fromPort: "Port de Barcelona", toPort: "Port de Palma", hours: 7.5, fareGBP: 95, operator: "Baleària" },
  { from: "BCN", to: "IBZ", fromPort: "Port de Barcelona", toPort: "Port d'Eivissa", hours: 8.5, fareGBP: 105, operator: "Trasmed" },
  { from: "ATH", to: "JTR", fromPort: "Piraeus", toPort: "Athinios", hours: 5.5, fareGBP: 140, operator: "Seajets" },
  { from: "ATH", to: "HER", fromPort: "Piraeus", toPort: "Heraklion", hours: 9, fareGBP: 90, operator: "Minoan Lines" },
  { from: "ROM", to: "CAG", fromPort: "Civitavecchia", toPort: "Porto di Cagliari", hours: 14, fareGBP: 120, operator: "Tirrenia" },
  { from: "NAP", to: "CAG", fromPort: "Porto di Napoli", toPort: "Porto di Cagliari", hours: 13.5, fareGBP: 115, operator: "Tirrenia" },
  { from: "DBV", to: "SPU", fromPort: "Gruž, Dubrovnik", toPort: "Split ferry port", hours: 4.5, fareGBP: 70, operator: "Jadrolinija" },
  { from: "SPU", to: "DBV", fromPort: "Split ferry port", toPort: "Gruž, Dubrovnik", hours: 4.5, fareGBP: 70, operator: "Jadrolinija" },
  { from: "AGP", to: "RAK", fromPort: "Algeciras", toPort: "Tanger Med", hours: 1.5, fareGBP: 80, operator: "FRS" },
];

export function ferryRoute(from: string, to: string): FerryRoute | undefined {
  return FERRIES.find((f) => f.from === from && f.to === to) ?? (() => {
    const r = FERRIES.find((f) => f.from === to && f.to === from);
    return r ? { ...r, from, to, fromPort: r.toPort, toPort: r.fromPort } : undefined;
  })();
}

export interface Crossing {
  name: string;
  /** Return cost per car, GBP. */
  carGBP: number;
  /** Return fare per foot passenger, GBP (rail & sail, coach supplement). */
  footGBP: number;
  /** Extra time each way, hours. */
  hours: number;
  /** Rail can go straight through (the Channel Tunnel). */
  railThrough: boolean;
}

/** How you get between two landmasses by road or rail, if you can. */
export function crossing(a: string, b: string): Crossing | null | undefined {
  const la = landmass(a);
  const lb = landmass(b);
  if (la === lb && (la === "GB" || la === "IE" || la === "EU" || la === "NA")) return null; // same land, no crossing
  const pair = [la, lb].sort().join("-");
  if (pair === "EU-GB") return { name: "Channel Tunnel", carGBP: 190, footGBP: 0, hours: 1.5, railThrough: true };
  if (pair === "GB-IE") return { name: "Holyhead–Dublin ferry", carGBP: 240, footGBP: 70, hours: 3.5, railThrough: false };
  return undefined; // not reachable over land
}

/** Road distance, roughly: great-circle plus the wiggle of real roads. */
export function roadKm(a: Place, b: Place): number {
  return Math.round(distanceKm(a, b) * 1.3);
}

/** Every hub that counts as leaving from this place. */
export function hubsOf(p: Place): string[] {
  return [...p.airports, ...railStations(p), ...(coachStation(p) ? [coachStation(p)!] : []), ...FERRIES.filter((f) => f.from === p.code).map((f) => f.fromPort), ...FERRIES.filter((f) => f.to === p.code).map((f) => f.toPort), p.code];
}

// Rough lifecycle emissions per passenger-km, kg CO2e (UK government
// conversion factors, rounded). Car is per vehicle-km, shared by its occupants.
export const CO2_PER_KM = { flight: 0.15, train: 0.035, coach: 0.027, ferry: 0.02, car: 0.17 } as const;

let owners: Map<string, string> | null = null;

/** Which place a hub (airport, station, port) belongs to, if we know it. */
export function hubOwner(hub: string): string | undefined {
  if (!owners) {
    owners = new Map();
    for (const p of PLACES) for (const h of hubsOf(p)) if (!owners.has(h)) owners.set(h, p.code);
  }
  return owners.get(hub);
}
