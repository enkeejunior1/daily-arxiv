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
  assert.match(html, /manifest\.webmanifest/i);
  assert.match(html, /http:\/\/localhost(?::3000)?\/og\.png/i);
  assert.match(html, /관심 논문 피드/);
  assert.match(html, /DeepXiv 확인 중/);
  assert.match(html, /Repo 확인 중/);
  assert.match(html, /Cloud 확인 중/);
  assert.match(html, /Double-click/);
  assert.match(html, />Guide<\/button>/);
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
  assert.match(companion, /function normalizeNotes/);
  assert.match(companion, /"note"/);
  assert.match(companion, /\| Note \|/);
  assert.match(component, /COMPANION_URL/);
  assert.match(component, /DAILY_TARGET = 250/);
  assert.match(component, /하루 최대 250개/);
  assert.match(component, /DeepXiv Top 50/);
  assert.match(component, /alias는 \| 로 연결/);
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
  assert.match(component, /Daily arXiv 사용법/);
  assert.match(component, /추천 루틴/);
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
  assert.match(component, /Cloud synced across devices/);
  assert.match(component, /Download PDF/);
  assert.match(component, /paper-reader.*has-paper/);
});

test("provides a one-click Mac background launcher", async () => {
  const [launcher, appExecutable, infoPlist, packageJson] = await Promise.all([
    readFile(new URL("../scripts/launch-background.mjs", import.meta.url), "utf8"),
    readFile(new URL("../Daily arXiv.app/Contents/MacOS/Daily arXiv", import.meta.url), "utf8"),
    readFile(new URL("../Daily arXiv.app/Contents/Info.plist", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(launcher, /detached: true/);
  assert.match(launcher, /dev\.pid/);
  assert.match(launcher, /appIsReady/);
  assert.match(launcher, /--stop/);
  assert.match(appExecutable, /npm run launch/);
  assert.match(infoPlist, /com\.enkeejunior1\.daily-arxiv/);
  assert.match(packageJson, /"launch": "node scripts\/launch-background\.mjs"/);
});
