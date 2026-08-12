const FEED_URL =
  "https://rss.arxiv.org/atom/cs.LG+stat.ML+cs.CL+cs.CV+cs.AI+cs.NE";

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

function parseFeed(xml: string) {
  const entries = xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];

  return entries.slice(0, 500).map((entry) => {
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
      arxivUrl: arxivUrl || `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    };
  });
}

export async function GET() {
  try {
    const response = await fetch(FEED_URL, {
      headers: {
        "User-Agent": "daily-arxiv-local/0.1 (personal research reader)",
      },
    });

    if (!response.ok) {
      return Response.json(
        { papers: [], source: "unavailable", message: `arXiv ${response.status}` },
        { status: 502 },
      );
    }

    const papers = parseFeed(await response.text());
    return Response.json({ papers, source: "arxiv" });
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
