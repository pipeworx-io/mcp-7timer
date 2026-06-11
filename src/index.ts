interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * 7Timer! MCP.
 *
 * Keyless astronomy + weather forecasts from 7timer.info. The ASTRO product
 * gives the metrics stargazers and astrophotographers use to plan observing
 * sessions — cloud cover, atmospheric "seeing", and sky "transparency" — at
 * 3-hour resolution out to 72 hours. CIVIL provides general weather. No API
 * key. Complements the space/astronomy packs.
 */


const BASE = 'https://www.7timer.info';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

// --- Scale decoders (7Timer! integer scales → human labels) ------------------

// cloudcover (1-9): lower = clearer sky.
const CLOUD_COVER: Record<number, string> = {
  1: '0-6%',
  2: '6-19%',
  3: '19-31%',
  4: '31-44%',
  5: '44-56%',
  6: '56-69%',
  7: '69-81%',
  8: '81-94%',
  9: '94-100%',
};

// seeing (1-8): arcsec; lower = steadier air = better.
const SEEING: Record<number, string> = {
  1: '<0.5"',
  2: '0.5-0.75"',
  3: '0.75-1"',
  4: '1-1.25"',
  5: '1.25-1.5"',
  6: '1.5-2"',
  7: '2-2.5"',
  8: '>2.5"',
};

// transparency (1-8): mag/airmass; lower = more transparent / darker sky.
const TRANSPARENCY: Record<number, string> = {
  1: '<0.3',
  2: '0.3-0.4',
  3: '0.4-0.5',
  4: '0.5-0.6',
  5: '0.6-0.7',
  6: '0.7-0.85',
  7: '0.85-1',
  8: '>1',
};

// --- Types -------------------------------------------------------------------

interface Wind10m {
  direction?: string;
  speed?: number;
}

interface AstroPoint {
  timepoint?: number;
  cloudcover?: number;
  seeing?: number;
  transparency?: number;
  lifted_index?: number;
  rh2m?: number;
  wind10m?: Wind10m;
  temp2m?: number;
  prec_type?: string;
}

interface CivilPoint {
  timepoint?: number;
  cloudcover?: number;
  temp2m?: number;
  rh2m?: number | string;
  wind10m?: Wind10m;
  weather?: string;
  prec_type?: string;
}

interface T7Response<P> {
  product?: string;
  init?: string;
  dataseries?: P[];
}

// --- Helpers -----------------------------------------------------------------

/** Parse 7Timer! init "YYYYMMDDHH" (UTC) into a Date. */
function parseInit(init: string): Date | null {
  if (typeof init !== 'string' || !/^\d{10}$/.test(init)) return null;
  const year = Number(init.slice(0, 4));
  const month = Number(init.slice(4, 6));
  const day = Number(init.slice(6, 8));
  const hour = Number(init.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day, hour));
}

/** ISO timestamp for a forecast point: init + timepoint hours. */
function forecastTimeIso(initDate: Date | null, timepoint: number): string | null {
  if (!initDate || typeof timepoint !== 'number') return null;
  return new Date(initDate.getTime() + timepoint * 3600_000).toISOString();
}

function clampHours(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 24;
  return Math.min(72, n);
}

async function t7Get<P>(path: string, params: Record<string, string | number>): Promise<T7Response<P>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const url = `${BASE}${path}?${qs.toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) {
    throw new Error(`7timer: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  // 7Timer! sends JSON with a non-JSON content-type and odd whitespace; parse text.
  const text = await res.text();
  return JSON.parse(text) as T7Response<P>;
}

function observingQuality(cloud: number, seeing: number, transparency: number): string {
  if (cloud <= 2 && seeing <= 3 && transparency <= 3) return 'excellent';
  if (cloud >= 7) return 'poor';
  if (cloud <= 4 && transparency <= 5) return 'good';
  return 'fair';
}

function mapAstro(p: AstroPoint, initDate: Date | null): Record<string, unknown> {
  const cloud = p.cloudcover ?? 0;
  const seeing = p.seeing ?? 0;
  const transparency = p.transparency ?? 0;
  const tp = p.timepoint ?? 0;
  return {
    forecast_time: forecastTimeIso(initDate, tp),
    hours_from_now: tp,
    cloud_cover: { value: cloud, label: CLOUD_COVER[cloud] ?? null },
    seeing: { value: seeing, label: SEEING[seeing] ?? null },
    transparency: { value: transparency, label: TRANSPARENCY[transparency] ?? null },
    temp_c: p.temp2m,
    wind: { speed: p.wind10m?.speed, direction: p.wind10m?.direction },
    prec_type: p.prec_type,
    observing_quality: observingQuality(cloud, seeing, transparency),
  };
}

function mapCivil(p: CivilPoint, initDate: Date | null): Record<string, unknown> {
  const cloud = p.cloudcover ?? 0;
  const tp = p.timepoint ?? 0;
  return {
    forecast_time: forecastTimeIso(initDate, tp),
    hours_from_now: tp,
    temp_c: p.temp2m,
    humidity_pct: p.rh2m, // civil returns "61%"; astro returns a scale code — pass through
    weather: p.weather,
    cloud_cover: { value: cloud, label: CLOUD_COVER[cloud] ?? null },
    wind: { speed: p.wind10m?.speed, direction: p.wind10m?.direction },
    precip_type: p.prec_type,
  };
}

// --- Tools -------------------------------------------------------------------

const tools: McpToolExport['tools'] = [
  {
    name: 'stargazing_forecast',
    description:
      "Astronomy observing forecast from 7Timer! ASTRO — the metrics stargazers and astrophotographers use to decide if tonight is good for observing: cloud cover, atmospheric seeing (steadiness), and sky transparency, at 3-hour resolution out to 72 hours. Each point gets a human-readable label and an observing_quality verdict, plus a best_window summary of the clearest/steadiest hours. Keyless.",
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'Latitude in decimal degrees, e.g. 38.9.' },
        longitude: { type: 'number', description: 'Longitude in decimal degrees, e.g. -77.0.' },
        hours: {
          type: 'number',
          description: 'How far ahead to forecast, in hours (default 24, max 72). Returned at 3-hour steps.',
        },
      },
      required: ['latitude', 'longitude'],
    },
  },
  {
    name: 'weather_forecast',
    description:
      'General weather forecast from 7Timer! CIVIL — temperature, humidity, a weather condition code (e.g. clearday, pcloudynight, lightrainday, tsday), cloud cover, wind, and precipitation type, at 3-hour resolution out to 72 hours. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'Latitude in decimal degrees, e.g. 38.9.' },
        longitude: { type: 'number', description: 'Longitude in decimal degrees, e.g. -77.0.' },
        hours: {
          type: 'number',
          description: 'How far ahead to forecast, in hours (default 24, max 72). Returned at 3-hour steps.',
        },
      },
      required: ['latitude', 'longitude'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'stargazing_forecast':
        return stargazingForecast(args);
      case 'weather_forecast':
        return weatherForecast(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function coords(args: Record<string, unknown>): { lat: number; lon: number } | { error: string } {
  const lat = typeof args.latitude === 'number' ? args.latitude : Number(args.latitude);
  const lon = typeof args.longitude === 'number' ? args.longitude : Number(args.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { error: 'provide numeric latitude and longitude' };
  }
  return { lat, lon };
}

async function stargazingForecast(args: Record<string, unknown>): Promise<unknown> {
  const c = coords(args);
  if ('error' in c) return c;
  const hours = clampHours(args.hours);

  const data = await t7Get<AstroPoint>('/bin/astro.php', {
    lon: c.lon,
    lat: c.lat,
    ac: 0,
    unit: 'metric',
    output: 'json',
    tzshift: 0,
  });

  const initDate = parseInit(data.init ?? '');
  const series = Array.isArray(data.dataseries) ? data.dataseries : [];
  const points = series.filter((p) => (p.timepoint ?? Infinity) <= hours);
  const forecast = points.map((p) => mapAstro(p, initDate));

  // best_window: timepoint(s) with the lowest combined cloud + seeing + transparency.
  let bestWindow: Array<Record<string, unknown>> = [];
  if (points.length > 0) {
    const score = (p: AstroPoint) => (p.cloudcover ?? 9) + (p.seeing ?? 8) + (p.transparency ?? 8);
    const min = Math.min(...points.map(score));
    bestWindow = points.filter((p) => score(p) === min).map((p) => mapAstro(p, initDate));
  }

  return {
    latitude: c.lat,
    longitude: c.lon,
    init: initDate ? initDate.toISOString() : data.init,
    count: forecast.length,
    forecast,
    best_window: bestWindow,
  };
}

async function weatherForecast(args: Record<string, unknown>): Promise<unknown> {
  const c = coords(args);
  if ('error' in c) return c;
  const hours = clampHours(args.hours);

  const data = await t7Get<CivilPoint>('/bin/civil.php', {
    lon: c.lon,
    lat: c.lat,
    ac: 0,
    unit: 'metric',
    output: 'json',
    tzshift: 0,
  });

  const initDate = parseInit(data.init ?? '');
  const series = Array.isArray(data.dataseries) ? data.dataseries : [];
  const forecast = series
    .filter((p) => (p.timepoint ?? Infinity) <= hours)
    .map((p) => mapCivil(p, initDate));

  return {
    latitude: c.lat,
    longitude: c.lon,
    init: initDate ? initDate.toISOString() : data.init,
    count: forecast.length,
    forecast,
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
