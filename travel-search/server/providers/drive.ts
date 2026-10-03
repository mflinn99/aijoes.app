import { crossing, landmass, roadKm } from "../ground.js";
import { convert } from "../money.js";
import { placeByCode } from "../places.js";
import type { Leg, Provider, TransportOffer, TransportQuery } from "./types.js";

// Driving: there is no fare to look up, so this is a calculation, not a quote.
// Road distance, fuel, typical continental tolls, the Channel Tunnel or Irish
// Sea crossing, and parking at the destination, for as many cars as the party
// needs (five seats each). It assumes the traveller's own car; rental is not
// included. Every offer is marked indicative.
//   DRIVE_FUEL_GBP_PER_KM (default 0.13), DRIVE_MAX_KM one way (default 1500)

const SEATS_PER_CAR = 5;
const KMH = 85;
const TOLL_GBP_PER_KM_EU = 0.05;
const PARKING_GBP_PER_NIGHT = 15;

export function createDrive(env = process.env): Provider {
  const fuel = Number(env.DRIVE_FUEL_GBP_PER_KM) > 0 ? Number(env.DRIVE_FUEL_GBP_PER_KM) : 0.13;
  const maxKm = Number(env.DRIVE_MAX_KM) > 0 ? Number(env.DRIVE_MAX_KM) : 1500;
  return {
    name: "drive",
    live: true,
    modes: ["car"],
    async searchTransport(q) {
      return estimateDrive(q, { fuel, maxKm });
    },
  };
}

export function estimateDrive(q: TransportQuery, opts: { fuel: number; maxKm: number }): TransportOffer[] {
  if (!q.modes.includes("car") || !q.destinationCode || q.originSpecific) return [];
  const from = placeByCode(q.originCode);
  const to = placeByCode(q.destinationCode);
  if (!from || !to || from.code === to.code) return [];
  const cross = crossing(from.code, to.code);
  if (cross === undefined) return []; // no road there (an island, another continent)
  const km = roadKm(from, to);
  if (km > opts.maxKm) return [];

  const seated = q.travellers.adults + q.travellers.children;
  const cars = Math.ceil(seated / SEATS_PER_CAR);
  const nights = Math.round((Date.parse(q.return) - Date.parse(q.depart)) / 86_400_000);
  const continentalKm = landmass(to.code) === "EU" ? (landmass(from.code) === "EU" ? km : Math.max(0, km - 150)) : 0;
  const perCarGBP = 2 * km * opts.fuel + 2 * continentalKm * TOLL_GBP_PER_KM_EU + (cross?.carGBP ?? 0) + nights * PARKING_GBP_PER_NIGHT;
  const totalGBP = perCarGBP * cars;
  const total = convert(totalGBP, "GBP", q.currency);
  if (total === null) return [];

  // Driving time with a 15-minute break every two hours, plus any crossing.
  const driveMin = (km / KMH) * 60;
  const minutes = Math.round(driveMin + Math.floor(driveMin / 120) * 15 + (cross ? cross.hours * 60 : 0));
  const stops = Math.floor(driveMin / 120);
  const leg = (a: string, b: string, date: string): Leg => {
    const departAt = `${date}T08:00`;
    const arrive = new Date(`${date}T08:00:00Z`);
    arrive.setUTCMinutes(arrive.getUTCMinutes() + minutes);
    return {
      mode: "car",
      modes: cross ? (cross.railThrough ? ["car", "train", "car"] : ["car", "ferry", "car"]) : ["car"],
      from: a,
      to: b,
      departAt,
      arriveAt: arrive.toISOString().slice(0, 16),
      durationMinutes: minutes,
      stops,
      carriers: [cross ? `Own car via ${cross.name}` : "Own car"],
      km,
    };
  };
  return [
    {
      provider: "drive",
      id: `drive:${from.code}-${to.code}-${q.depart}-${q.return}-${cars}`,
      mode: "car",
      originHub: from.code,
      destinationHub: to.code,
      originCity: from.code,
      returnCity: from.code,
      destinationCode: to.code,
      destinationName: to.name,
      destinationCountry: to.country,
      outbound: leg(from.code, to.code, q.depart),
      inbound: leg(to.code, from.code, q.return),
      totalPrice: total,
      currency: q.currency,
      pricedPassengers: q.travellers.adults + q.travellers.children + q.travellers.infants,
      indicative: true,
      vehicles: cars,
    },
  ];
}
