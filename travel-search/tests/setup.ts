import { vi } from "vitest";

// FAKE_TODAY=2027-03-01 npm test runs the suite as if it were that day, to
// check nothing depends on the season the tests happen to run in.
if (process.env.FAKE_TODAY) {
  vi.useFakeTimers({ now: new Date(`${process.env.FAKE_TODAY}T09:00:00Z`), toFake: ["Date"] });
}
