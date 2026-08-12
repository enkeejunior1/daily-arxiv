import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalizeKeywordGroup,
  keywordAliases,
  keywordGroupKey,
  keywordGroupMatches,
} from "../app/lib/keyword-groups.mjs";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Daily arXiv product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Daily arXiv<\/title>/i);
  assert.match(html, /og:image/i);
  assert.match(html, /http:\/\/localhost(?::3000)?\/og\.png/i);
  assert.match(html, /관심 논문 피드/);
  assert.match(html, /DeepXiv 확인 중/);
  assert.match(html, /Repo 확인 중/);
  assert.match(html, /Double-click/);
  assert.doesNotMatch(html, /Figure 1|Institution|X API/);
});

test("keeps GitHub data separate from local state and PDFs", async () => {
  const [gitignore, rules, choices, companion, component, arxivRoute, deepxivRoute, citationRoute] =
    await Promise.all([
      readFile(new URL("../.gitignore", import.meta.url), "utf8"),
      readFile(new URL("../config/rules.json", import.meta.url), "utf8"),
      readFile(new URL("../choices/2026.csv", import.meta.url), "utf8"),
      readFile(new URL("../scripts/local-companion.mjs", import.meta.url), "utf8"),
      readFile(new URL("../app/components/DailyArxivApp.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/arxiv/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/deepxiv-featured/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/citation-signals/route.ts", import.meta.url), "utf8"),
    ]);

  assert.match(gitignore, /^\/\.local\/$/m);
  assert.deepEqual(Object.keys(JSON.parse(rules)).sort(), [
    "authors",
    "citationSeeds",
    "negativeKeywords",
    "positiveKeywords",
  ]);
  assert.match(choices, /^"date","decision","arxiv_id"/);
  assert.match(companion, /choicesRoot/);
  assert.match(companion, /papersRoot = path\.join\(localRoot, "papers"\)/);
  assert.match(companion, /Only arXiv PDF URLs can be cached/);
  assert.match(component, /COMPANION_URL/);
  assert.match(component, /DAILY_TARGET = 250/);
  assert.match(component, /하루 최대 250개/);
  assert.match(component, /DeepXiv Top 50/);
  assert.match(component, /alias는 \| 로 연결/);
  assert.match(component, /CITATION SEEDS/);
  assert.match(component, /custom weight each/);
  assert.match(component, /PDF 확대 및 축소/);
  assert.match(component, /PDF_ZOOM_MAX = 300/);
  assert.doesNotMatch(component, /institutions|featuredShares|previewMode/);
  assert.match(arxivRoute, /entries\.slice\(0, 500\)/);
  assert.match(deepxivRoute, /TRENDING_LIMIT = 50/);
  assert.match(citationRoute, /SEMANTIC_SCHOLAR_BATCH_URL/);
  assert.match(citationRoute, /MAX_PAPERS = 500/);
  assert.match(citationRoute, /BATCH_SIZE = 100/);
});

test("treats keyword aliases as one scoring group", () => {
  const group = " ttt | test-time training | test time training | TTT ";

  assert.deepEqual(keywordAliases(group), [
    "ttt",
    "test-time training",
    "test time training",
  ]);
  assert.equal(
    canonicalizeKeywordGroup(group),
    "ttt | test-time training | test time training",
  );
  assert.equal(keywordGroupMatches("TTT improves test-time training.", group), true);
  assert.equal(keywordGroupMatches("Ordinary supervised pretraining.", group), false);
  assert.equal(keywordGroupKey("test-time training"), keywordGroupKey("test time training"));
});

test("handles trackpad pinch inside the app PDF reader", async () => {
  const [reader, pdfSource] = await Promise.all([
    readFile(new URL("../app/components/PdfCanvasReader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pdf-source/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(reader, /pdfjs-dist\/webpack\.mjs/);
  assert.match(reader, /event\.ctrlKey/);
  assert.match(reader, /event\.preventDefault\(\)/);
  assert.match(reader, /gesturechange/);
  assert.match(reader, /applyZoomAtPoint/);
  assert.match(pdfSource, /Content-Type.*application\/pdf/s);
  assert.match(pdfSource, /Invalid arXiv id/);
});
