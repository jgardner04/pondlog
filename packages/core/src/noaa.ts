import { z } from "zod";
import { err, ok, type Result } from "./result.js";
import type { Coordinates, TideEvent } from "./types.js";
import { validateCoordinates } from "./coords.js";
import { RateLimiter } from "./rate-limiter.js";
import { withRetry } from "./retry.js";
import { PONDLOG_USER_AGENT } from "./user-agent.js";

const NOAA_BASE_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const NOAA_STATIONS_URL =
  "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
const STATION_ID_RE = /^[0-9]{6,8}$/;
const ISO_DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** Documented NOAA limit: 5 req/sec sustained, no burst guidance. */
const limiter = new RateLimiter({
  maxTokens: 5,
  refillRate: 5,
  refillIntervalMs: 1000,
});

const NoaaPredictionSchema = z
  .object({
    t: z.string(),
    v: z.string(),
    type: z.enum(["H", "L"]),
  })
  .passthrough();

const NoaaPredictionsResponseSchema = z
  .object({ predictions: z.array(NoaaPredictionSchema) })
  .passthrough();

const NoaaErrorResponseSchema = z
  .object({ error: z.object({ message: z.string() }).passthrough() })
  .passthrough();

export interface GetTidePredictionsParams {
  /** NOAA station id (6–8 digits). Port Angeles = "9444090". */
  stationId: string;
  /** YYYY-MM-DD. Defaults to today. */
  date?: string;
  /** Override default 30s timeout. */
  timeoutMs?: number;
}

/** Fetch high/low tide predictions for one NOAA CO-OPS station. */
export async function getTidePredictions(
  params: GetTidePredictionsParams,
): Promise<Result<TideEvent[]>> {
  if (!STATION_ID_RE.test(params.stationId)) {
    return err({
      source: "noaa",
      message: `invalid stationId "${params.stationId}", expected 6–8 digits (e.g. "9444090")`,
    });
  }
  if (params.date !== undefined && !ISO_DATE_RE.test(params.date)) {
    return err({
      source: "noaa",
      message: `invalid date "${params.date}", expected YYYY-MM-DD`,
    });
  }

  const beginDate = (params.date ?? todayIso()).replace(/-/g, "");
  const url = new URL(NOAA_BASE_URL);
  url.searchParams.set("product", "predictions");
  url.searchParams.set("station", params.stationId);
  url.searchParams.set("datum", "MLLW");
  url.searchParams.set("units", "english");
  url.searchParams.set("time_zone", "lst_ldt");
  url.searchParams.set("format", "json");
  url.searchParams.set("interval", "hilo");
  url.searchParams.set("begin_date", beginDate);
  url.searchParams.set("range", "24");

  await limiter.acquire();

  let response: Response;
  try {
    response = await withRetry(
      async () => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), params.timeoutMs ?? 30_000);
        try {
          const r = await fetch(url, {
            headers: {
              accept: "application/json",
              "user-agent": PONDLOG_USER_AGENT,
            },
            signal: ac.signal,
          });
          if (r.status === 429 || r.status >= 500) {
            throw new Error(`noaa: HTTP ${r.status}`);
          }
          return r;
        } finally {
          clearTimeout(timer);
        }
      },
      { maxAttempts: 3, baseDelayMs: 1000 },
    );
  } catch (cause) {
    return err({
      source: "noaa",
      message: `request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    return err({
      source: "noaa",
      message: `response was not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      statusCode: response.status,
      cause,
    });
  }

  if (!response.ok) {
    const errParsed = NoaaErrorResponseSchema.safeParse(json);
    const message = errParsed.success
      ? errParsed.data.error.message
      : `HTTP ${response.status}`;
    return err({ source: "noaa", message, statusCode: response.status });
  }

  // NOAA returns 200 with `{error: {...}}` body for invalid stations / dates.
  const errParsed = NoaaErrorResponseSchema.safeParse(json);
  if (errParsed.success) {
    return err({ source: "noaa", message: errParsed.data.error.message });
  }

  const parsed = NoaaPredictionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    return err({
      source: "noaa",
      message: `unexpected response shape: ${parsed.error.message}`,
    });
  }

  const events: TideEvent[] = [];
  for (const p of parsed.data.predictions) {
    const heightFt = Number.parseFloat(p.v);
    if (!Number.isFinite(heightFt)) continue;
    events.push({
      time: noaaTimeToIso(p.t),
      heightFt,
      type: p.type === "H" ? "high" : "low",
    });
  }
  return ok(events);
}

/** Convenience: split a flat tide-event list into {high, low} arrays. */
export function splitHighLow(
  events: TideEvent[],
): { high: TideEvent[]; low: TideEvent[] } {
  const high: TideEvent[] = [];
  const low: TideEvent[] = [];
  for (const e of events) {
    if (e.type === "high") high.push(e);
    else if (e.type === "low") low.push(e);
  }
  return { high, low };
}

function todayIso(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** NOAA returns "YYYY-MM-DD HH:mm" in station local time. We pass it through
 *  as "YYYY-MM-DDTHH:mm:00" without a timezone suffix, the caller knows the
 *  station's TZ, and inventing a UTC offset would lie. */
function noaaTimeToIso(t: string): string {
  const trimmed = t.trim();
  return trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
}

// ---------------------------------------------------------------------------
// Tide station search
// ---------------------------------------------------------------------------

/** One tide-prediction station near a point. */
export interface TideStation {
  /** NOAA CO-OPS station id; pass it to `getTidePredictions`. */
  id: string;
  name: string;
  /** Two-letter state, when NOAA lists one. */
  state?: string;
  coordinates: Coordinates;
  /** Great-circle distance from the search point, km, one decimal. */
  distanceKm: number;
  /**
   * `reference`: harmonic station with its own constituents (NOAA type R).
   * `subordinate`: predictions derived from a reference station by time and
   * height offsets (NOAA type S). Both return hi/lo predictions.
   */
  kind: "reference" | "subordinate";
}

export interface FindTideStationsParams {
  coords: Coordinates;
  /** Search radius in km. Default 50, max 500. */
  radiusKm?: number;
  /** Maximum stations returned, nearest first. Default 5, max 50. */
  limit?: number;
  /** Override default 30s timeout for the station-list fetch. */
  timeoutMs?: number;
}

const NoaaStationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    lat: z.number(),
    lng: z.number(),
    type: z.string().optional(),
    state: z.string().nullish(),
  })
  .passthrough();

// Rows are validated one at a time below, so one malformed station is
// skipped instead of failing the whole list.
const NoaaStationListSchema = z
  .object({ stations: z.array(z.unknown()) })
  .passthrough();

type NoaaStation = z.infer<typeof NoaaStationSchema>;

/** The station list changes rarely; refetch at most daily per process. */
const STATION_CACHE_MS = 24 * 60 * 60 * 1000;
let stationCache: { at: number; stations: NoaaStation[] } | undefined;
let stationLoad: Promise<Result<NoaaStation[]>> | undefined;

/** Clears the in-memory station list. For tests. */
export function resetTideStationCache(): void {
  stationCache = undefined;
  stationLoad = undefined;
}

/**
 * Find NOAA tide-prediction stations near a point, nearest first. Reads
 * NOAA's station metadata list (about 3,500 stations, cached in memory for a
 * day) and ranks by great-circle distance, so it needs no API key.
 */
export async function findTideStations(
  params: FindTideStationsParams,
): Promise<Result<TideStation[]>> {
  if (!validateCoordinates(params.coords)) {
    return err({ source: "noaa", message: "invalid coordinates" });
  }
  const radiusKm = params.radiusKm ?? 50;
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 500) {
    return err({ source: "noaa", message: `radiusKm must be between 0 and 500, got ${radiusKm}` });
  }
  const limit = params.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return err({ source: "noaa", message: `limit must be an integer between 1 and 50, got ${limit}` });
  }

  const list = await loadStations(params.timeoutMs);
  if (!list.ok) return list;

  const found: TideStation[] = [];
  for (const s of list.data) {
    const coordinates = { lat: s.lat, lng: s.lng };
    if (!validateCoordinates(coordinates)) continue;
    const distanceKm = haversineKm(params.coords, coordinates);
    if (distanceKm > radiusKm) continue;
    found.push({
      id: s.id,
      name: s.name,
      ...(s.state ? { state: s.state } : {}),
      coordinates,
      distanceKm: Math.round(distanceKm * 10) / 10,
      kind: s.type === "S" ? "subordinate" : "reference",
    });
  }
  found.sort((a, b) => a.distanceKm - b.distanceKm);
  return ok(found.slice(0, limit));
}

async function loadStations(timeoutMs: number | undefined): Promise<Result<NoaaStation[]>> {
  if (stationCache && Date.now() - stationCache.at < STATION_CACHE_MS) {
    return ok(stationCache.stations);
  }
  // Concurrent first calls share one fetch.
  stationLoad ??= fetchStations(timeoutMs).finally(() => {
    stationLoad = undefined;
  });
  const result = await stationLoad;
  if (result.ok) stationCache = { at: Date.now(), stations: result.data };
  return result;
}

async function fetchStations(timeoutMs: number | undefined): Promise<Result<NoaaStation[]>> {
  await limiter.acquire();

  let response: Response;
  try {
    response = await withRetry(
      async () => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs ?? 30_000);
        try {
          const r = await fetch(NOAA_STATIONS_URL, {
            headers: {
              accept: "application/json",
              "user-agent": PONDLOG_USER_AGENT,
            },
            signal: ac.signal,
          });
          if (r.status === 429 || r.status >= 500) {
            throw new Error(`noaa: HTTP ${r.status}`);
          }
          return r;
        } finally {
          clearTimeout(timer);
        }
      },
      { maxAttempts: 3, baseDelayMs: 1000 },
    );
  } catch (cause) {
    return err({
      source: "noaa",
      message: `station list request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }

  if (!response.ok) {
    return err({ source: "noaa", message: `station list HTTP ${response.status}`, statusCode: response.status });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    return err({
      source: "noaa",
      message: `station list was not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }

  const parsed = NoaaStationListSchema.safeParse(json);
  if (!parsed.success) {
    return err({
      source: "noaa",
      message: `unexpected station list shape: ${parsed.error.message}`,
    });
  }
  const stations: NoaaStation[] = [];
  for (const row of parsed.data.stations) {
    const station = NoaaStationSchema.safeParse(row);
    if (station.success) stations.push(station.data);
  }
  if (stations.length === 0) {
    return err({ source: "noaa", message: "station list contained no valid stations" });
  }
  return ok(stations);
}

function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
