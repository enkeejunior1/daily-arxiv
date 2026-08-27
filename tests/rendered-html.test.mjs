import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalizeKeywordGroup,
  keywordAliases,
  keywordGroupKey,
  keywordGroupMatches,
} from "../app/lib/keyword-groups.mjs";
import {
  normalizePositiveKeywordWeights,
  positiveKeywordWeight,
} from "../app/lib/keyword-weights.mjs";
import {
  aggregateFeatured,
  extractArxivIds,
  normalizeBearerToken,
  parseCsv,
} from "../scripts/x-sync.mjs";

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
  assert.match(html, /manifest\.webmanifest/i);
  assert.match(html, /http:\/\/localhost(?::3000)?\/og\.png/i);
  assert.match(html, /관심 논문 피드/);
  assert.match(html, /DeepXiv 확인 중/);
  assert.match(html, /X 확인 중/);
  assert.match(html, /Repo 확인 중/);
  assert.match(html, /Cloud 확인 중/);
  assert.match(html, /Double-click/);
  assert.match(html, /전체 arXiv 후보 논문 수/);
  assert.match(html, />1(?:<!-- -->)?d<\/button>/);
  assert.match(html, />Guide<\/button>/);
  assert.doesNotMatch(html, /Figure 1|Institution|X API/);
});

test("keeps GitHub data separate from local state and PDFs", async () => {
  const [gitignore, rules, choices, companion, component, arxivRoute, deepxivRoute, citationRoute, xRoute, xConfig, xWorkflow] =
    await Promise.all([
      readFile(new URL("../.gitignore", import.meta.url), "utf8"),
      readFile(new URL("../config/rules.json", import.meta.url), "utf8"),
      readFile(new URL("../choices/2026.csv", import.meta.url), "utf8"),
      readFile(new URL("../scripts/local-companion.mjs", import.meta.url), "utf8"),
      readFile(new URL("../app/components/DailyArxivApp.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/arxiv/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/deepxiv-featured/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/citation-signals/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/x-featured/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../config/x-sources.json", import.meta.url), "utf8"),
      readFile(new URL("../.github/workflows/x-arxiv-sync.yml", import.meta.url), "utf8"),
    ]);

  assert.match(gitignore, /^\/\.local\/$/m);
  assert.deepEqual(Object.keys(JSON.parse(rules)).filter((key) => key !== "positiveKeywordWeights").sort(), [
    "authors",
    "citationSeeds",
    "negativeKeywords",
    "positiveKeywords",
  ]);
  assert.match(choices, /^"date","decision","arxiv_id"/);
  assert.match(choices, /"score","note","selected_at"/);
  assert.match(companion, /choicesRoot/);
  assert.match(companion, /papersRoot = path\.join\(localRoot, "papers"\)/);
  assert.match(companion, /aiRoot = path\.join\(localRoot, "ai"\)/);
  assert.match(companion, /Only arXiv PDF URLs can be cached/);
  assert.match(companion, /@openai\/codex-sdk/);
  assert.match(companion, /이 논문을 한국어로 소개해줘\. 특히 method를 구체적으로 소개해줘/);
  assert.match(companion, /sandboxMode: "read-only"/);
  assert.match(companion, /url\.pathname === "\/ai"/);
  assert.match(companion, /promptVersion: aiPromptVersion/);
  assert.match(companion, /daily-arxiv-enkeejunior1\.enkeejunior1\.chatgpt\.site/);
  assert.match(companion, /Access-Control-Allow-Private-Network/);
  assert.match(companion, /function normalizeNotes/);
  assert.match(companion, /function normalizePreferences/);
  assert.match(companion, /normalizePositiveKeywordWeights/);
  assert.match(companion, /"note"/);
  assert.match(companion, /\| Note \|/);
  assert.match(component, /COMPANION_URL/);
  assert.match(component, /feedPeriodDays: FeedPeriodDays/);
  assert.match(component, /candidateLimit: CandidateLimit/);
  assert.match(component, /savedSort: SavedSort/);
  assert.match(component, /savedLimit: SavedLimit/);
  assert.match(component, /저장 날짜/);
  assert.match(component, /arXiv 날짜/);
  assert.match(component, /DeepXiv \+5 · tracked X \+\{TRACKED_X_SCORE\}/);
  assert.match(component, /TRACKED X ARCHIVE · \+\{TRACKED_X_SCORE\}/);
  assert.match(component, /xFeatured: xByPaper\[paper\.id\]/);
  assert.match(component, /alias는 \| 로 연결/);
  assert.match(component, /custom \+1–100/);
  assert.match(component, /weighted-keyword-row/);
  assert.match(component, /CITATION SEEDS/);
  assert.match(component, /custom weight each/);
  assert.match(component, /PDF 확대 및 축소/);
  assert.match(component, /PDF_ZOOM_MAX = 300/);
  assert.match(component, /NOTE_MAX_LENGTH = 200/);
  assert.match(component, /paper-note-panel/);
  assert.match(component, /자동 저장됨/);
  assert.match(component, /paper-ai-panel/);
  assert.match(component, /CODEX PAPER GUIDE/);
  assert.match(component, /PDF를 읽고 method를 분석하는 중/);
  assert.match(component, /저장된 Codex 논문 소개/);
  assert.match(component, /daily-arxiv-helper:\/\/launch/);
  assert.match(component, /waitForCompanion/);
  assert.match(component, /Mac helper를 시작하는 중/);
  assert.match(component, /Daily arXiv 사용법/);
  assert.match(component, /추천 루틴/);
  assert.doesNotMatch(component, /institutions|featuredShares|previewMode/);
  assert.match(arxivRoute, /submittedDate:/);
  assert.match(arxivRoute, /days === 1 \? 7 : days/);
  assert.match(arxivRoute, /latestArxivDay/);
  assert.match(arxivRoute, /ALLOWED_PERIODS = new Set\(\[1, 7, 30\]\)/);
  assert.match(arxivRoute, /ALLOWED_LIMITS = new Set\(\[100, 500, 1000\]\)/);
  assert.match(deepxivRoute, /TRENDING_LIMIT = 50/);
  assert.match(citationRoute, /SEMANTIC_SCHOLAR_BATCH_URL/);
  assert.match(citationRoute, /MAX_PAPERS = 1000/);
  assert.match(citationRoute, /BATCH_SIZE = 100/);
  assert.match(xRoute, /xSources\.archiveUrl/);
  assert.match(xRoute, /STALE_AFTER_MS/);
  assert.deepEqual(JSON.parse(xConfig).accounts, ["fly51fly", "che_shr_cat", "rosinality"]);
  assert.match(xWorkflow, /secrets\.X_BEARER_TOKEN/);
  assert.match(xWorkflow, /--mode=backfill/);
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

test("assigns a custom score to each positive keyword group", () => {
  const groups = ["ttt | test-time training", "world model", "scaling law"];
  const weights = normalizePositiveKeywordWeights(
    { "test-time training | ttt": 4, "world model": 6 },
    groups,
  );

  assert.deepEqual(weights, {
    "ttt | test-time training": 4,
    "world model": 6,
    "scaling law": 2,
  });
  assert.equal(positiveKeywordWeight(weights, "TTT | test time training"), 4);
});

test("normalizes and aggregates tracked X arXiv shares", () => {
  assert.equal(normalizeBearerToken("  ’abc ’ 123’  "), "abc123");
  assert.throws(() => normalizeBearerToken("abc\u00a0def"), /unsupported character/);

  assert.deepEqual(
    extractArxivIds([
      "paper https://arxiv.org/abs/2608.12345v2.",
      "mirror https://ar5iv.labs.arxiv.org/html/1706.03762",
      "arXiv:cs/9901001",
    ]),
    ["2608.12345", "1706.03762", "cs/9901001"],
  );

  const csv = '"shared_at","x_account","x_post_id","arxiv_id","post_text"\n' +
    '"2026-01-01T00:00:00Z","fly51fly","1","2608.12345","a ""quoted"" paper"\n';
  assert.equal(parseCsv(csv)[0].post_text, 'a "quoted" paper');

  const featured = aggregateFeatured([
    {
      shared_at: "2026-01-01T00:00:00Z",
      x_account: "fly51fly",
      x_post_url: "https://x.com/fly51fly/status/1",
      arxiv_id: "2608.12345",
    },
    {
      shared_at: "2026-01-02T00:00:00Z",
      x_account: "rosinality",
      x_post_url: "https://x.com/rosinality/status/2",
      arxiv_id: "2608.12345",
    },
  ], { accounts: ["fly51fly", "rosinality"] }, "2026-01-03T00:00:00Z");
  assert.deepEqual(featured.featured["2608.12345"].sharedBy, ["fly51fly", "rosinality"]);
  assert.equal(featured.featured["2608.12345"].shareCount, 2);
});

test("handles trackpad pinch inside the app PDF reader", async () => {
  const [reader, pdfSource] = await Promise.all([
    readFile(new URL("../app/components/PdfCanvasReader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pdf-source/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(reader, /pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url/);
  assert.match(reader, /GlobalWorkerOptions\.workerSrc = pdfWorkerUrl/);
  assert.match(reader, /callbacksRef/);
  assert.match(reader, /\[retryCount, url\]/);
  assert.match(reader, /다시 시도/);
  assert.match(reader, /event\.ctrlKey/);
  assert.match(reader, /event\.preventDefault\(\)/);
  assert.match(reader, /gesturechange/);
  assert.match(reader, /pointerType !== "touch"/);
  assert.match(reader, /pinchStartDistance/);
  assert.match(reader, /applyZoomAtPoint/);
  assert.match(pdfSource, /Content-Type.*application\/pdf/s);
  assert.match(pdfSource, /Content-Disposition/);
  assert.match(pdfSource, /Invalid arXiv id/);
  assert.match(pdfSource, /RETRYABLE_STATUSES/);
  assert.match(pdfSource, /export\.arxiv\.org/);
  assert.match(pdfSource, /RETRY_DELAYS_MS/);
});

test("supports Android installation and cross-device cloud state", async () => {
  const [manifest, serviceWorker, hosting, schema, syncRoute, component] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DailyArxivApp.tsx", import.meta.url), "utf8"),
  ]);

  const parsedManifest = JSON.parse(manifest);
  assert.equal(parsedManifest.display, "standalone");
  assert.equal(parsedManifest.icons.length, 2);
  assert.match(serviceWorker, /daily-arxiv-shell-v1/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(schema, /daily_arxiv_state/);
  assert.match(syncRoute, /oai-authenticated-user-id|currentUserId/);
  assert.match(syncRoute, /ON CONFLICT\(user_id\)/);
  assert.match(syncRoute, /notes: snapshot\.state\?\.notes/);
  assert.match(syncRoute, /preferences: snapshot\.state\?\.preferences/);
  assert.match(component, /Cloud synced across devices/);
  assert.match(component, /Download PDF/);
  assert.match(component, /paper-reader.*has-paper/);
});

test("provides a one-click Mac background launcher", async () => {
  const [launcher, appExecutable, infoPlist, helperExecutable, helperInfoPlist, packageJson] = await Promise.all([
    readFile(new URL("../scripts/launch-background.mjs", import.meta.url), "utf8"),
    readFile(new URL("../Daily arXiv.app/Contents/MacOS/Daily arXiv", import.meta.url), "utf8"),
    readFile(new URL("../Daily arXiv.app/Contents/Info.plist", import.meta.url), "utf8"),
    readFile(new URL("../Daily arXiv Helper.app/Contents/MacOS/Daily arXiv Helper", import.meta.url), "utf8"),
    readFile(new URL("../Daily arXiv Helper.app/Contents/Info.plist", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(launcher, /detached: true/);
  assert.match(launcher, /dev\.pid/);
  assert.match(launcher, /appIsReady/);
  assert.match(launcher, /--stop/);
  assert.match(appExecutable, /npm run launch/);
  assert.match(appExecutable, /lsregister/);
  assert.match(infoPlist, /com\.enkeejunior1\.daily-arxiv/);
  assert.match(helperExecutable, /npm run launch -- --no-open/);
  assert.match(helperInfoPlist, /daily-arxiv-helper/);
  assert.match(helperInfoPlist, /LSBackgroundOnly/);
  assert.match(packageJson, /"launch": "node scripts\/launch-background\.mjs"/);
});
