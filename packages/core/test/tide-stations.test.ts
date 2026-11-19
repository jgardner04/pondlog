import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findTideStations, resetTideStationCache } from "../src/noaa.js";

// Real rows near Deception Pass, WA (from NOAA's station list), plus one far away.
const STATIONS = {
  stations: [
    { id: "9447995", name: "Cornet Bay, Whidbey Island, Deception Pass", lat: 48.40169906616211, lng: -122.62300109863281, type: "S", state: "WA", reference_id: "9447130" },
    { id: "9448614", name: "Deception Pass St. Park, Bowman Bay, Fidalgo I.", lat: 48.415000915527344, lng: -122.6520004272461, type: "R", state: "WA", reference_id: "" },
    { id: "9448601", name: "Yokeko Point, Deception Pass", lat: 48.4133, lng: -122.615, type: "S", state: "WA", reference_id: "9447130" },
    { id: "9414290", name: "San Francisco", lat: 37.8063, lng: -122.4659, type: "R", state: "CA" },
    { id: "bad", name: "Malformed row", lat: "48.4", lng: -122.6 },
  ],
};

const DECEPTION_PASS = { lat: 48.406, lng: -122.643 };

describe("findTideStations", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    resetTideStationCache();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(STATIONS), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns stations nearest first with distance and kind", async () => {
    const r = await findTideStations({ coords: DECEPTION_PASS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((s) => s.id)).toEqual(["9448614", "9447995", "9448601"]);
    expect(r.data[0]).toMatchObject({ kind: "reference", state: "WA" });
    expect(r.data[1]?.kind).toBe("subordinate");
    for (let i = 1; i < r.data.length; i++) {
      expect(r.data[i]!.distanceKm).toBeGreaterThanOrEqual(r.data[i - 1]!.distanceKm);
    }
    expect(r.data[0]!.distanceKm).toBeLessThan(2);
  });

  it("applies radius and limit", async () => {
    const one = await findTideStations({ coords: DECEPTION_PASS, limit: 1 });
    expect(one.ok && one.data.length).toBe(1);

    const wide = await findTideStations({ coords: DECEPTION_PASS, radiusKm: 500, limit: 50 });
    expect(wide.ok && wide.data.some((s) => s.id === "9414290")).toBe(false); // SF is ~1,180 km away

    const tight = await findTideStations({ coords: DECEPTION_PASS, radiusKm: 1.5 });
    expect(tight.ok && tight.data.map((s) => s.id)).toEqual(["9448614"]);
  });

  it("skips malformed rows instead of failing", async () => {
    const r = await findTideStations({ coords: { lat: 48.4, lng: -122.6 }, radiusKm: 5, limit: 50 });
    expect(r.ok && r.data.some((s) => s.id === "bad")).toBe(false);
  });

  it("fetches the station list once and reuses it", async () => {
    await Promise.all([
      findTideStations({ coords: DECEPTION_PASS }),
      findTideStations({ coords: DECEPTION_PASS }),
    ]);
    await findTideStations({ coords: { lat: 37.8, lng: -122.47 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed fetch", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    const first = await findTideStations({ coords: DECEPTION_PASS });
    expect(first.ok).toBe(false);
    const second = await findTideStations({ coords: DECEPTION_PASS });
    expect(second.ok).toBe(true);
  });

  it("returns an error for an unexpected list shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ nope: [] }), { status: 200 }));
    const r = await findTideStations({ coords: DECEPTION_PASS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.source).toBe("noaa");
  });

  it("validates inputs before fetching", async () => {
    expect((await findTideStations({ coords: { lat: 99, lng: 0 } })).ok).toBe(false);
    expect((await findTideStations({ coords: DECEPTION_PASS, radiusKm: 0 })).ok).toBe(false);
    expect((await findTideStations({ coords: DECEPTION_PASS, limit: 0 })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
