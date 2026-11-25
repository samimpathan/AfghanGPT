/**
 * lib/slideImages.ts — Topic images for the Slides Studio (client).
 *
 * Source: Openverse (api.openverse.org) — CC-licensed photos from
 * Flickr etc., searchable with NO key, NO account, NO payment
 * (anonymous: 20 req/min burst, 200/day — one search per slide).
 * Fallback: Wikimedia Commons search API (also keyless).
 * NEVER Pollinations here: its anonymous tier is ~1 image / 45s
 * and image generation is founder-gated, which would break guest
 * deck creation. These are real photos, not generated images.
 *
 * Every function is fail-soft: on any error / empty result it
 * returns null and the slide simply stays text-only — a deck
 * NEVER fails because an image could not be fetched.
 */

export type SlideImage = {
  /** Display + embed URL: Openverse thumbnail (600px, fast on a
   * slow connection) or a Wikimedia 900px thumb. */
  url: string;
  /** Short attribution, e.g. "Photo: perspec_photo88 · CC BY-SA 2.0". */
  credit: string;
  source: "openverse" | "wikimedia";
};

const cache = new Map<string, SlideImage | null>();
const usedUrls = new Set<string>();

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

function isUsablePhoto(u: string, width: number, height: number): boolean {
  if (!/^https:\/\//.test(u)) return false;
  if (width < 600 || height < 300) return false;
  return /\.(jpe?g|png)(\?|#|$)/i.test(u) || u.includes("/thumb/");
}

type OpenverseResult = {
  url?: string;
  thumbnail?: string;
  title?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  width?: number;
  height?: number;
  filetype?: string;
  mature?: boolean;
};

/** Is this thumbnail URL actually servable? Some Openverse results
 * have a thumbnail the service cannot produce (HTTP 424, persistent
 * — the source image is gone). A HEAD check skips those, so the app
 * never picks a photo that can never load. HEAD is CORS-safelisted
 * and the endpoint answers Access-Control-Allow-Origin: *. */
async function thumbReachable(url: string): Promise<boolean> {
  try {
    const { signal, done } = withTimeout(5000);
    const res = await fetch(url, { method: "HEAD", signal });
    done();
    return res.ok;
  } catch {
    return false;
  }
}

async function searchOpenverseOnce(
  query: string,
  page: number
): Promise<SlideImage | null> {
  const key = `ov:${query.toLowerCase()}#${page}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let found: SlideImage | null = null;
  try {
    const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page=${page}&page_size=5&license_type=commercial&filter_dead=false`;
    const { signal, done } = withTimeout(8000);
    const res = await fetch(u, { signal });
    done();
    if (!res.ok) throw new Error(`openverse ${res.status}`);
    const j = (await res.json()) as { results?: OpenverseResult[] };
    // Check at most 3 candidates for a reachable thumbnail — the
    // first reachable one wins (Openverse's own ranking order).
    let checked = 0;
    for (const r of j.results ?? []) {
      if (checked >= 3) break;
      if (r.mature) continue;
      // The thumbnail is served by api.openverse.org itself (600px
      // JPEG) — reachable from the app's network and small enough
      // for slow connections AND for PPTX embedding.
      const thumb = r.thumbnail ?? "";
      const w = r.width ?? 0;
      const h = r.height ?? 0;
      if (!thumb || usedUrls.has(thumb)) continue;
      if (w < 600 || h < 300) continue;
      const ft = (r.filetype ?? "").toLowerCase();
      if (ft && ft !== "jpg" && ft !== "jpeg" && ft !== "png") continue;
      checked++;
      if (!(await thumbReachable(thumb))) continue;
      found = {
        url: thumb,
        credit: `Photo: ${r.creator ?? "Openverse"} · CC ${`${r.license ?? "BY"} ${r.license_version ?? ""}`.trim()}`,
        source: "openverse",
      };
      break;
    }
  } catch {
    found = null;
  }
  cache.set(key, found);
  if (found) usedUrls.add(found.url);
  return found;
}

type CommonsPage = {
  imageinfo?: {
    thumburl?: string;
    url?: string;
    width?: number;
    height?: number;
    mime?: string;
    extmetadata?: { Artist?: { value?: string } };
  }[];
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim().slice(0, 60) || "Wikimedia Commons";
}

async function searchWikimedia(query: string): Promise<SlideImage | null> {
  const key = `wm:${query.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let found: SlideImage | null = null;
  try {
    const u =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search` +
      `&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=5` +
      `&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata&iiurlwidth=900&origin=*`;
    const { signal, done } = withTimeout(8000);
    const res = await fetch(u, { signal });
    done();
    if (!res.ok) throw new Error(`wikimedia ${res.status}`);
    const j = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
    const pages = Object.values(j.query?.pages ?? {});
    let checked = 0;
    for (const p of pages) {
      if (checked >= 3) break;
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const thumb = info.thumburl ?? "";
      if (!thumb || usedUrls.has(thumb)) continue;
      const mime = info.mime ?? "";
      if (mime !== "image/jpeg" && mime !== "image/png") continue;
      if ((info.width ?? 0) < 600 || (info.height ?? 0) < 300) continue;
      if (!isUsablePhoto(thumb, info.width ?? 0, info.height ?? 0)) continue;
      checked++;
      if (!(await thumbReachable(thumb))) continue;
      found = {
        url: thumb,
        credit: `Photo: ${stripHtml(info.extmetadata?.Artist?.value ?? "")} · Wikimedia Commons`,
        source: "wikimedia",
      };
      break;
    }
  } catch {
    found = null;
  }
  cache.set(key, found);
  if (found) usedUrls.add(found.url);
  return found;
}

/** Shorter variants of a query, longest first. Openverse matches
 * ALL words, so a 6-word query often returns nothing — dropping to
 * 3 then 2 words finds a photo instead of leaving the slide bare. */
function queryVariants(q: string): string[] {
  const words = q.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  if (words.length >= 2) out.push(words.join(" "));
  if (words.length > 3) out.push(words.slice(0, 3).join(" "));
  if (words.length > 2) out.push(words.slice(0, 2).join(" "));
  return Array.from(new Set(out));
}

async function searchOpenverse(
  query: string,
  page: number
): Promise<SlideImage | null> {
  for (const variant of queryVariants(query)) {
    const found = await searchOpenverseOnce(variant, page);
    if (found) return found;
  }
  return null;
}

/** One image for one slide query: Openverse first, Wikimedia
 * fallback. Never throws; null = keep the slide text-only. */
export async function fetchSlideImage(query: string, page = 1): Promise<SlideImage | null> {
  const q = query.trim();
  if (!q) return null;
  return (await searchOpenverse(q, page)) ?? (await searchWikimedia(q));
}

/**
 * Fetch images for a deck's slide queries (in order). Duplicate
 * queries get a later results page so two slides never share one
 * image; already-used URLs are skipped inside the searches. Runs
 * with a concurrency of 3 so a slow connection still finishes in
 * a few seconds. Returns one entry per query (null = text-only).
 */
export async function fetchSlideImages(queries: string[]): Promise<(SlideImage | null)[]> {
  const out: (SlideImage | null)[] = new Array(queries.length).fill(null);
  const seen = new Map<string, number>();
  const jobs = queries.map((q, i) => {
    const n = (seen.get(q.trim().toLowerCase()) ?? 0) + 1;
    seen.set(q.trim().toLowerCase(), n);
    return { q, i, page: n };
  });
  const CONCURRENCY = 3;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (!job) return;
      out[job.i] = job.q.trim() ? await fetchSlideImage(job.q, job.page) : null;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()));
  return out;
}
