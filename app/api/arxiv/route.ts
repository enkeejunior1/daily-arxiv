const RSS_FEED_URL =
  "https://rss.arxiv.org/atom/cs.LG+stat.ML+cs.CL+cs.CV+cs.AI+cs.NE";
const API_URL = "https://export.arxiv.org/api/query";
const CATEGORIES = ["cs.LG", "stat.ML", "cs.CL", "cs.CV", "cs.AI", "cs.NE"];
const ALLOWED_PERIODS = new Set([1, 7, 30]);
const ALLOWED_LIMITS = new Set([100, 500, 1000]);

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string) {
  const match = block.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"),
  );
  return match ? decodeXml(match[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : "";
}

function linkHref(block: string, rel: string) {
  const links = block.match(/<link\b[^>]*\/?>(?:<\/link>)?/gi) ?? [];
  for (const link of links) {
    const relation = link.match(/\brel=["']([^"']+)["']/i)?.[1];
    const href = link.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (relation === rel && href) return decodeXml(href);
  }
  return "";
}

function cleanAbstract(value: string) {
  return value
    .replace(/^arXiv:\S+\s+Announce Type:\s*\S+\s+Abstract:\s*/i, "")
    .trim();
}

function parseFeed(xml: string, limit: number) {
  const entries = xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];

  return entries.slice(0, limit).map((entry) => {
    const rawId = tag(entry, "id");
    const arxivUrl = linkHref(entry, "alternate");
    const arxivId =
      arxivUrl.match(/arxiv\.org\/abs\/([^?#]+)/i)?.[1]?.replace(/v\d+$/, "") ??
      rawId.match(/arXiv\.org:([^\s]+?)(?:v\d+)?$/i)?.[1] ??
      rawId;
    const atomAuthors = Array.from(
      entry.matchAll(/<author(?:\s[^>]*)?>[\s\S]*?<name(?:\s[^>]*)?>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi),
      (match) => decodeXml(match[1]),
    );
    const creator = tag(entry, "dc:creator");
    const authors = atomAuthors.length
      ? atomAuthors
      : creator.split(/,\s*/).map((author) => author.trim()).filter(Boolean);
    const categories = Array.from(
      entry.matchAll(/<category[^>]*term=["']([^"']+)["'][^>]*\/?>(?:<\/category>)?/gi),
      (match) => decodeXml(match[1]),
    ).filter((category) => category.includes("."));

    return {
      id: arxivId,
      title: tag(entry, "title"),
      abstract: cleanAbstract(tag(entry, "summary") || tag(entry, "description")),
      authors,
      categories: [...new Set(categories)],
      publishedAt: tag(entry, "published") || tag(entry, "updated"),
      arxivUrl: (arxivUrl || `https://arxiv.org/abs/${arxivId}`).replace(/^http:/, "https:"),
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    };
  }).filter((paper) => paper.id && paper.title);
}

function apiDate(date: Date) {
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 12);
}

function arxivApiUrl(days: number, limit: number) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const categories = CATEGORIES.map((category) => `cat:${category}`).join(" OR ");
  const searchQuery = `(${categories}) AND submittedDate:[${apiDate(start)} TO ${apiDate(end)}]`;
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: "0",
    max_results: String(limit),
    sortBy: "submittedDate",
    sortOrder: "descending",
  });
  return `${API_URL}?${params}`;
}

async function fetchFeed(url: string) {
  return fetch(url, {
    headers: {
      "User-Agent": "daily-arxiv/0.2 (personal research reader)",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get("days"));
  const requestedLimit = Number(url.searchParams.get("limit"));
  const days = ALLOWED_PERIODS.has(requestedDays) ? requestedDays : 1;
  const limit = ALLOWED_LIMITS.has(requestedLimit) ? requestedLimit : 500;

  try {
    let response = await fetchFeed(arxivApiUrl(days, limit));
    let source = "arxiv-api";

    if (!response.ok) {
      response = await fetchFeed(RSS_FEED_URL);
      source = "arxiv-rss-fallback";
    }

    if (!response.ok) {
      return Response.json(
        { papers: [], source: "unavailable", message: `arXiv ${response.status}` },
        { status: 502 },
      );
    }

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const papers = parseFeed(await response.text(), limit)
      .filter((paper) => {
        const publishedAt = Date.parse(paper.publishedAt);
        return Number.isNaN(publishedAt) || publishedAt >= cutoff;
      })
      .slice(0, limit);
    return Response.json(
      { papers, source, days, limit },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } },
    );
  } catch (error) {
    return Response.json(
      {
        papers: [],
        source: "unavailable",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
