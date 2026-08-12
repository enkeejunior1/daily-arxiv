const TRENDING_URL = "https://api.rag.ac.cn/trending_arxiv_papers/api/trending";
const CACHE_TTL_SECONDS = 6 * 60 * 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const TRENDING_DAYS = 7;
const TRENDING_LIMIT = 50;

type DeepXivPaper = {
  arxiv_id?: string;
  arxiv_url?: string;
  rank?: number;
  mentioned_by?: { username?: string; name?: string; followers?: number }[];
  stats?: {
    total_likes?: string | number;
    total_mentions?: string | number;
    total_retweets?: string | number;
    total_views?: string | number;
    unique_users?: string | number;
  };
  timeline?: { first_mention?: string; latest_mention?: string };
};

export type DeepXivSignal = {
  rank: number;
  mentions: number;
  likes: number;
  retweets: number;
  views: number;
  mentionedBy: string[];
  latestMention: string;
};

type DeepXivResponse = {
  status?: string;
  data?: {
    days?: number;
    generated_at?: string;
    papers?: DeepXivPaper[];
  };
};

type FeaturedPayload = {
  connected: boolean;
  source: "deepxiv";
  days: number;
  featured: Record<string, DeepXivSignal>;
  generatedAt?: string;
  message?: string;
};

let cached: { at: number; payload: FeaturedPayload } | null = null;

function numberValue(value: string | number | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeArxivId(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "");
}

function buildFeatured(papers: DeepXivPaper[]) {
  return Object.fromEntries(
    papers.flatMap((paper, index) => {
      const id = normalizeArxivId(paper.arxiv_id ?? paper.arxiv_url ?? "");
      if (!id) return [];
      return [
        [
          id,
          {
            rank: numberValue(paper.rank) || index + 1,
            mentions: numberValue(paper.stats?.total_mentions),
            likes: numberValue(paper.stats?.total_likes),
            retweets: numberValue(paper.stats?.total_retweets),
            views: numberValue(paper.stats?.total_views),
            mentionedBy: (paper.mentioned_by ?? [])
              .map((account) => account.username?.trim())
              .filter((username): username is string => Boolean(username)),
            latestMention: paper.timeline?.latest_mention ?? "",
          } satisfies DeepXivSignal,
        ],
      ];
    }),
  );
}

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Response.json(cached.payload, {
      headers: { "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
    });
  }

  const params = new URLSearchParams({
    days: String(TRENDING_DAYS),
    limit: String(TRENDING_LIMIT),
  });

  try {
    const response = await fetch(`${TRENDING_URL}?${params}`, {
      headers: { "User-Agent": "daily-arxiv-local/1.0 (personal research reader)" },
    });
    const data = (await response.json()) as DeepXivResponse;
    if (!response.ok || data.status !== "success") {
      throw new Error(`DeepXiv ${response.status}`);
    }

    const payload: FeaturedPayload = {
      connected: true,
      source: "deepxiv",
      days: data.data?.days ?? TRENDING_DAYS,
      featured: buildFeatured(data.data?.papers ?? []),
      generatedAt: data.data?.generated_at,
    };
    cached = { at: Date.now(), payload };
    return Response.json(payload, {
      headers: { "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
    });
  } catch (error) {
    return Response.json(
      {
        connected: false,
        source: "deepxiv",
        days: TRENDING_DAYS,
        featured: {},
        message: error instanceof Error ? error.message : "DeepXiv request failed.",
      } satisfies FeaturedPayload,
      { status: 502 },
    );
  }
}
