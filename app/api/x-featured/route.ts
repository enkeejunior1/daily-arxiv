import initialArchive from "../../../data/x-featured.json";
import xSources from "../../../config/x-sources.json";

const CACHE_TTL_SECONDS = 15 * 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1_000;
const STALE_AFTER_MS = 36 * 60 * 60 * 1_000;

type XSignal = {
  sharedBy: string[];
  firstSharedAt: string;
  latestSharedAt: string;
  postUrls: string[];
  shareCount: number;
};

type XArchive = {
  generatedAt: string | null;
  accounts: string[];
  rowCount: number;
  featured: Record<string, XSignal>;
};

type XFeaturedPayload = {
  connected: boolean;
  stale: boolean;
  source: "x-archive";
  score: number;
  accounts: string[];
  featured: Record<string, XSignal>;
  generatedAt: string | null;
  rowCount: number;
  message?: string;
};

let cached: { at: number; payload: XFeaturedPayload } | null = null;

function validArchive(value: unknown): XArchive | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<XArchive>;
  if (!candidate.featured || typeof candidate.featured !== "object") return null;
  const featured = Object.fromEntries(
    Object.entries(candidate.featured).flatMap(([arxivId, rawSignal]) => {
      if (!rawSignal || typeof rawSignal !== "object") return [];
      const signal = rawSignal as Partial<XSignal>;
      const sharedBy = Array.isArray(signal.sharedBy)
        ? signal.sharedBy.filter((account): account is string => typeof account === "string")
        : [];
      const postUrls = Array.isArray(signal.postUrls)
        ? signal.postUrls.filter((url): url is string => typeof url === "string" && url.startsWith("https://x.com/"))
        : [];
      if (!sharedBy.length) return [];
      return [[
        arxivId,
        {
          sharedBy,
          firstSharedAt: typeof signal.firstSharedAt === "string" ? signal.firstSharedAt : "",
          latestSharedAt: typeof signal.latestSharedAt === "string" ? signal.latestSharedAt : "",
          postUrls,
          shareCount: Number.isFinite(signal.shareCount) ? Math.max(1, Number(signal.shareCount)) : 1,
        } satisfies XSignal,
      ]];
    }),
  );
  return {
    generatedAt: typeof candidate.generatedAt === "string" ? candidate.generatedAt : null,
    accounts: Array.isArray(candidate.accounts)
      ? candidate.accounts.filter((account): account is string => typeof account === "string")
      : xSources.accounts,
    rowCount: Number.isFinite(candidate.rowCount) ? Number(candidate.rowCount) : 0,
    featured,
  };
}

function payloadFromArchive(archive: XArchive, message?: string): XFeaturedPayload {
  const generatedTime = archive.generatedAt ? Date.parse(archive.generatedAt) : Number.NaN;
  return {
    connected: Boolean(archive.generatedAt),
    stale: Number.isNaN(generatedTime) || Date.now() - generatedTime > STALE_AFTER_MS,
    source: "x-archive",
    score: xSources.featuredScore,
    accounts: archive.accounts,
    featured: archive.featured,
    generatedAt: archive.generatedAt,
    rowCount: archive.rowCount,
    message,
  };
}

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Response.json(cached.payload, {
      headers: { "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
    });
  }

  let archive = validArchive(initialArchive) ?? {
    generatedAt: null,
    accounts: xSources.accounts,
    rowCount: 0,
    featured: {},
  };
  let message: string | undefined;
  try {
    const response = await fetch(xSources.archiveUrl, {
      headers: { "User-Agent": "daily-arxiv/1.0 (tracked X archive reader)" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GitHub archive ${response.status}`);
    const remote = validArchive(await response.json());
    if (!remote) throw new Error("GitHub X archive is invalid.");
    archive = remote;
  } catch (error) {
    message = error instanceof Error ? error.message : "X archive unavailable.";
  }

  const payload = payloadFromArchive(archive, message);
  cached = { at: Date.now(), payload };
  return Response.json(payload, {
    headers: { "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
  });
}
