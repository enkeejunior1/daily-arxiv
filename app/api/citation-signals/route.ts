const SEMANTIC_SCHOLAR_BATCH_URL =
  "https://api.semanticscholar.org/graph/v1/paper/batch?fields=externalIds,references.externalIds";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PAPERS = 500;
const MAX_SEEDS = 50;
const BATCH_SIZE = 100;
const API_KEY =
  typeof process !== "undefined" ? process.env.SEMANTIC_SCHOLAR_API_KEY?.trim() : undefined;

type ExternalIds = {
  ArXiv?: string;
  arXiv?: string;
  ARXIV?: string;
};

type SemanticScholarPaper = {
  externalIds?: ExternalIds;
  references?: ({ externalIds?: ExternalIds } | null)[];
} | null;

type CachedReferences = {
  at: number;
  found: boolean;
  references: string[];
};

const referenceCache = new Map<string, CachedReferences>();

function normalizeArxivId(value: unknown) {
  if (typeof value !== "string") return "";
  const id = value
    .trim()
    .replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "");
  return /^(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})$/i.test(id) ? id : "";
}

function externalArxivId(externalIds: ExternalIds | undefined) {
  return normalizeArxivId(externalIds?.ArXiv ?? externalIds?.arXiv ?? externalIds?.ARXIV);
}

function uniqueArxivIds(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeArxivId).filter(Boolean))].slice(0, limit);
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchReferenceBatch(ids: string[]) {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(SEMANTIC_SCHOLAR_BATCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "daily-arxiv-local/1.0 (personal research reader)",
        ...(API_KEY ? { "x-api-key": API_KEY } : {}),
      },
      body: JSON.stringify({ ids: ids.map((id) => `ARXIV:${id}`) }),
    });
    if (response.ok) break;
    if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter)
        ? Math.min(5_000, Math.max(500, retryAfter * 1_000))
        : 800 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    break;
  }
  if (!response?.ok) {
    const status = response?.status ?? 502;
    const hint = status === 429 && !API_KEY ? " Add a free Semantic Scholar API key." : "";
    throw new Error(`Semantic Scholar ${status}.${hint}`);
  }

  const papers = (await response.json()) as SemanticScholarPaper[];
  ids.forEach((requestedId, index) => {
    const paper = papers[index] ?? null;
    const paperId = externalArxivId(paper?.externalIds) || requestedId;
    const references = paper
      ? [...new Set((paper.references ?? []).map((reference) => externalArxivId(reference?.externalIds)).filter(Boolean))]
      : [];
    referenceCache.set(paperId, {
      at: Date.now(),
      found: Boolean(paper),
      references,
    });
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { paperIds?: unknown; seedIds?: unknown };
    const paperIds = uniqueArxivIds(body.paperIds, MAX_PAPERS);
    const seedIds = uniqueArxivIds(body.seedIds, MAX_SEEDS);
    if (!paperIds.length || !seedIds.length) {
      return Response.json({
        connected: true,
        source: "semantic-scholar",
        matches: {},
        checked: paperIds.length,
        resolved: 0,
        authenticated: Boolean(API_KEY),
      });
    }

    const now = Date.now();
    const missing = paperIds.filter((id) => {
      const cached = referenceCache.get(id);
      return !cached || now - cached.at >= CACHE_TTL_MS;
    });
    const batches = chunks(missing, BATCH_SIZE);
    for (let index = 0; index < batches.length; index += 1) {
      if (API_KEY && index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1_050));
      }
      await fetchReferenceBatch(batches[index]);
    }

    const seedSet = new Set(seedIds);
    const matches: Record<string, string[]> = {};
    let resolved = 0;
    for (const paperId of paperIds) {
      const cached = referenceCache.get(paperId);
      if (!cached) continue;
      if (cached.found) resolved += 1;
      const hits = cached.references.filter((reference) => seedSet.has(reference));
      if (hits.length) matches[paperId] = hits;
    }

    return Response.json({
      connected: true,
      source: "semantic-scholar",
      matches,
      checked: paperIds.length,
      resolved,
      authenticated: Boolean(API_KEY),
    });
  } catch (error) {
    return Response.json(
      {
        connected: false,
        source: "semantic-scholar",
        matches: {},
        checked: 0,
        resolved: 0,
        authenticated: Boolean(API_KEY),
        message: error instanceof Error ? error.message : "Citation lookup failed.",
      },
      { status: 502 },
    );
  }
}
