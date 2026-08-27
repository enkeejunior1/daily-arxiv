import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePositiveKeywordWeights } from "../app/lib/keyword-weights.mjs";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const localRoot = path.join(projectRoot, ".local");
const papersRoot = path.join(localRoot, "papers");
const aiRoot = path.join(localRoot, "ai");
const statePath = path.join(localRoot, "state.json");
const rulesPath = path.join(projectRoot, "config", "rules.json");
const choicesRoot = path.join(projectRoot, "choices");
const readmePath = path.join(projectRoot, "README.md");
const port = Number.parseInt(process.env.DAILY_ARXIV_COMPANION_PORT ?? "4317", 10);
const allowedRemoteOrigins = new Set([
  "https://daily-arxiv-enkeejunior1.enkeejunior1.chatgpt.site",
]);
const maxBodyBytes = 5 * 1024 * 1024;
const maxPdfBytes = 100 * 1024 * 1024;
const maxPaperTextCharacters = 140_000;
const userTimeZone = process.env.DAILY_ARXIV_TIME_ZONE ?? "America/Los_Angeles";
const aiPromptVersion = 1;

const defaultRules = {
  authors: ["Yann LeCun", "Chelsea Finn"],
  positiveKeywords: [
    "reasoning",
    "vision-language",
    "multimodal",
    "language model",
    "reinforcement learning",
    "world model",
  ],
  negativeKeywords: ["medical imaging", "wireless network"],
  citationSeeds: [],
};

const csvColumns = [
  "date",
  "decision",
  "arxiv_id",
  "arxiv_link",
  "title",
  "first_author",
  "last_author",
  "score",
  "note",
  "selected_at",
];

let writeQueue = Promise.resolve();
const aiJobs = new Map();
let codexClientPromise;

function enqueueWrite(task) {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => undefined);
  return next;
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: userTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = value.year;
  const month = value.month;
  const day = value.day;
  return `${year}-${month}-${day}`;
}

function allowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return "*";
  if (allowedRemoteOrigins.has(origin)) return origin;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
  } catch {
    return null;
  }
  return null;
}

function setCors(request, response) {
  const origin = allowedOrigin(request);
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  if (request.headers["access-control-request-private-network"] === "true") {
    response.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(request, response, status, value) {
  setCors(request, response);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeIfChanged(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  try {
    if ((await readFile(file, "utf8")) === content) return false;
  } catch {
    // The file will be created below.
  }
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, file);
  return true;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed.slice(0, 180));
    if (result.length >= 200) break;
  }
  return result;
}

function normalizeRules(value) {
  const positiveKeywords = uniqueStrings(value?.positiveKeywords);
  return {
    authors: uniqueStrings(value?.authors),
    positiveKeywords,
    positiveKeywordWeights: normalizePositiveKeywordWeights(
      value?.positiveKeywordWeights,
      positiveKeywords,
    ),
    negativeKeywords: uniqueStrings(value?.negativeKeywords),
    citationSeeds: normalizeCitationSeeds(value?.citationSeeds),
  };
}

function isArxivId(value) {
  return typeof value === "string" && /^(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})$/i.test(value);
}

function normalizeArxivId(value) {
  if (typeof value !== "string") return "";
  const id = value
    .trim()
    .replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "");
  return isArxivId(id) ? id : "";
}

function normalizeCitationSeeds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((seed) => {
    const arxivId = normalizeArxivId(seed?.arxivId);
    const weight = Number(seed?.weight);
    if (!arxivId || seen.has(arxivId) || !Number.isFinite(weight)) return [];
    seen.add(arxivId);
    return [{ arxivId, weight: Math.max(1, Math.min(100, weight)) }];
  }).slice(0, 50);
}

function normalizeReviews(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5000).filter((review) => {
    return (
      review &&
      (review.decision === "heart" || review.decision === "superheart") &&
      typeof review.reviewedAt === "string" &&
      review.paper &&
      isArxivId(review.paper.id) &&
      typeof review.paper.title === "string" &&
      Array.isArray(review.paper.authors)
    );
  });
}

function normalizeNotes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([paperId, note]) => {
      if (!isArxivId(paperId) || !note || typeof note !== "object") return [];
      const text = typeof note.text === "string" ? note.text.trim().slice(0, 200) : "";
      if (!text) return [];
      return [[paperId, {
        text,
        updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : new Date(0).toISOString(),
      }]];
    }),
  );
}

function normalizeDownloads(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([id, download]) => {
      return (
        isArxivId(id) &&
        download &&
        typeof download === "object" &&
        typeof download.relativePath === "string" &&
        download.relativePath.startsWith(".local/papers/") &&
        !download.relativePath.includes("..")
      );
    }),
  );
}

function normalizePreferences(value) {
  const feedPeriodDays = [1, 7, 30].includes(Number(value?.feedPeriodDays))
    ? Number(value.feedPeriodDays)
    : 1;
  const candidateLimit = [100, 500, 1000].includes(Number(value?.candidateLimit))
    ? Number(value.candidateLimit)
    : 500;
  const savedSort = value?.savedSort === "arxiv-date" ? "arxiv-date" : "saved-date";
  const savedLimit =
    value?.savedLimit === "all" || [10, 25, 50, 100].includes(Number(value?.savedLimit))
      ? value.savedLimit === "all" ? "all" : Number(value.savedLimit)
      : 25;
  const normalizeSocialScore = (score, fallback) => {
    const numericScore = Number(score);
    return Number.isFinite(numericScore)
      ? Math.max(0, Math.min(100, Math.round(numericScore)))
      : fallback;
  };
  return {
    feedPeriodDays,
    candidateLimit,
    savedSort,
    savedLimit,
    deepxivScore: normalizeSocialScore(value?.deepxivScore, 5),
    trackedXScore: normalizeSocialScore(value?.trackedXScore, 5),
  };
}

function normalizeState(value) {
  const progress = value?.progress;
  return {
    version: 3,
    reviews: normalizeReviews(value?.reviews),
    notes: normalizeNotes(value?.notes),
    progress:
      progress && /^\d{4}-\d{2}-\d{2}$/.test(progress.date ?? "")
        ? {
            date: progress.date,
            seenIds: Array.isArray(progress.seenIds)
              ? progress.seenIds.filter(isArxivId).slice(0, 1000)
              : [],
            autoBookmarkId: isArxivId(progress.autoBookmarkId) ? progress.autoBookmarkId : null,
            manualBookmarkId: isArxivId(progress.manualBookmarkId)
              ? progress.manualBookmarkId
              : null,
          }
        : {
            date: localDateKey(),
            seenIds: [],
            autoBookmarkId: null,
            manualBookmarkId: null,
          },
    downloads: normalizeDownloads(value?.downloads),
    preferences: normalizePreferences(value?.preferences),
  };
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""').replace(/[\r\n]+/g, " ")}"`;
}

function serializeCsv(rows) {
  return `${[csvColumns, ...rows.map((row) => csvColumns.map((column) => row[column] ?? ""))]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n")}\n`;
}

function parseCsv(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      if (record.some(Boolean)) records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  const [header, ...rows] = records;
  if (!header) return [];
  return rows.map((row) => Object.fromEntries(header.map((column, index) => [column, row[index] ?? ""])));
}

function reviewDate(review) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(review.selectedDate ?? "")) return review.selectedDate;
  return review.reviewedAt.slice(0, 10);
}

function rowFromReview(review, date, notes) {
  return {
    date,
    decision: review.decision,
    arxiv_id: review.paper.id,
    arxiv_link: review.paper.arxivUrl,
    title: review.paper.title,
    first_author: review.paper.authors[0] ?? "",
    last_author: review.paper.authors.at(-1) ?? "",
    score: review.paper.baseScore ?? 0,
    note: notes[review.paper.id]?.text ?? "",
    selected_at: review.reviewedAt,
  };
}

function sortChoiceRows(a, b) {
  return (
    String(b.date).localeCompare(String(a.date)) ||
    (a.decision === b.decision ? 0 : a.decision === "superheart" ? -1 : 1) ||
    String(a.selected_at).localeCompare(String(b.selected_at))
  );
}

function markdownEscape(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
}

async function updateReadme(rows) {
  let readme;
  try {
    readme = await readFile(readmePath, "utf8");
  } catch {
    return;
  }
  const start = "<!-- DAILY_ARXIV_CHOICES_START -->";
  const end = "<!-- DAILY_ARXIV_CHOICES_END -->";
  const recent = [...rows].sort(sortChoiceRows).slice(0, 10);
  const table = recent.length
    ? [
        "| Date | Pick | Paper | Authors | Note |",
        "| --- | --- | --- | --- | --- |",
        ...recent.map(
          (row) =>
            `| ${markdownEscape(row.date)} | ${row.decision === "superheart" ? "♥+" : "♥"} | [${markdownEscape(row.title)}](${row.arxiv_link}) | ${markdownEscape(row.first_author)} · ${markdownEscape(row.last_author)} | ${markdownEscape(row.note)} |`,
        ),
      ].join("\n")
    : "No published choices yet.";
  const block = `${start}\n${table}\n${end}`;
  const next = readme.includes(start) && readme.includes(end)
    ? readme.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block)
    : `${readme.trimEnd()}\n\n## Recent choices\n\n${block}\n`;
  await writeIfChanged(readmePath, `${next.trimEnd()}\n`);
}

async function updateChoices(reviews, notes, targetDate) {
  const year = targetDate.slice(0, 4);
  const csvPath = path.join(choicesRoot, `${year}.csv`);
  let existing = [];
  try {
    existing = parseCsv(await readFile(csvPath, "utf8"));
  } catch {
    // The yearly CSV is created on first save.
  }
  const retained = existing.filter((row) => row.date !== targetDate);
  const todayRows = reviews
    .filter((review) => reviewDate(review) === targetDate)
    .map((review) => rowFromReview(review, targetDate, notes));
  const rows = [...retained, ...todayRows].sort(sortChoiceRows);
  await writeIfChanged(csvPath, serializeCsv(rows));
  await updateReadme(rows);
  return path.relative(projectRoot, csvPath);
}

function safePdfName(title, arxivId) {
  const cleanTitle = title
    .normalize("NFKC")
    .replace(/[\p{Cc}<>:"/\\|?*]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "paper";
  return `${cleanTitle}--${arxivId.replaceAll("/", "_")}.pdf`;
}

async function isUsablePdf(file) {
  let handle;
  try {
    const info = await stat(file);
    if (info.size < 5) return false;
    handle = await open(file, "r");
    const header = Buffer.alloc(5);
    await handle.read(header, 0, 5, 0);
    return header.toString("ascii") === "%PDF-";
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

async function downloadPdf(body) {
  if (!isArxivId(body.arxivId)) throw new Error("Invalid arXiv ID.");
  if (typeof body.title !== "string" || !body.title.trim()) throw new Error("Missing paper title.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "")) throw new Error("Invalid save date.");

  const pdfUrl = new URL(body.pdfUrl);
  if (
    pdfUrl.protocol !== "https:" ||
    !["arxiv.org", "export.arxiv.org"].includes(pdfUrl.hostname) ||
    !pdfUrl.pathname.startsWith("/pdf/")
  ) {
    throw new Error("Only arXiv PDF URLs can be cached.");
  }

  const folder = path.join(papersRoot, body.date);
  const filename = safePdfName(body.title, body.arxivId);
  const destination = path.join(folder, filename);
  const relativePath = path.relative(projectRoot, destination);

  if (await isUsablePdf(destination)) return { relativePath, cached: true };

  await mkdir(folder, { recursive: true });
  const response = await fetch(pdfUrl, {
    headers: { "User-Agent": "daily-arxiv-local/1.0 (personal research reader)" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`arXiv PDF request failed (${response.status}).`);
  const expectedSize = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (expectedSize > maxPdfBytes) throw new Error("PDF is larger than the 100 MB cache limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxPdfBytes) throw new Error("PDF is larger than the 100 MB cache limit.");
  if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new Error("arXiv did not return a PDF file.");
  }

  const temporary = `${destination}.${process.pid}.part`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return { relativePath, cached: false };
}

function safeAiStem(arxivId) {
  return arxivId.replaceAll("/", "_");
}

function aiRecordPath(arxivId) {
  return path.join(aiRoot, `${safeAiStem(arxivId)}.json`);
}

function aiTextPath(arxivId) {
  return path.join(aiRoot, `${safeAiStem(arxivId)}.txt`);
}

function resolvePaperPath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.startsWith(".local/papers/") ||
    relativePath.includes("..")
  ) return null;
  const candidate = path.resolve(projectRoot, relativePath);
  return candidate.startsWith(`${papersRoot}${path.sep}`) ? candidate : null;
}

async function resolvePdfForAnalysis(body) {
  const existing = resolvePaperPath(body.relativePath);
  if (existing && await isUsablePdf(existing)) {
    return { relativePath: body.relativePath, cached: true };
  }
  return downloadPdf(body);
}

async function extractPaperText(pdfPath, paper) {
  const textPath = aiTextPath(paper.arxivId);
  try {
    const cached = await readFile(textPath, "utf8");
    if (cached.startsWith(`arXiv: ${paper.arxivId}\n`) && cached.length > 500) {
      return { text: cached, textPath, cached: true };
    }
  } catch {
    // Extract the PDF below.
  }

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(await readFile(pdfPath));
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  const document = await loadingTask.promise;
  const sections = [`arXiv: ${paper.arxivId}`, `Title: ${paper.title}`, `URL: https://arxiv.org/abs/${paper.arxivId}`];
  let characterCount = sections.join("\n").length;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!pageText) continue;
      const section = `\n\n--- Page ${pageNumber} ---\n${pageText}`;
      const remaining = maxPaperTextCharacters - characterCount;
      if (remaining <= 0) break;
      sections.push(section.slice(0, remaining));
      characterCount += Math.min(section.length, remaining);
      if (section.length > remaining) break;
    }
  } finally {
    await loadingTask.destroy();
  }

  const text = `${sections.join("\n").trim()}\n`;
  if (text.length < 500) throw new Error("PDF에서 분석할 텍스트를 충분히 추출하지 못했어요.");
  await writeIfChanged(textPath, text);
  return { text, textPath, cached: false };
}

async function getCodexClient() {
  if (!codexClientPromise) {
    codexClientPromise = import("@openai/codex-sdk").then(({ Codex }) => new Codex());
  }
  return codexClientPromise;
}

function paperGuidePrompt(paperText) {
  return `너는 머신러닝 연구자를 돕는 꼼꼼한 논문 리뷰어다.

요청: 이 논문을 한국어로 소개해줘. 특히 method를 구체적으로 소개해줘.

다음 형식으로 답해라.
1. 한눈에 보는 요약: 논문이 푸는 문제, 핵심 아이디어, 결과를 짧게 설명한다.
2. 문제 설정과 핵심 기여: 기존 방식의 한계와 이 논문의 차별점을 구분한다.
3. Method 상세: 입력과 출력, 전체 pipeline, 각 component의 역할과 데이터 흐름, 학습 objective/loss, training과 inference 절차, 중요한 수식과 구현 세부사항을 가능한 구체적으로 설명한다. 단계가 있으면 번호를 붙인다.
4. 실험: 어떤 실험이 method의 주장을 뒷받침하는지 핵심 결과와 ablation 중심으로 설명한다.
5. 한계와 읽을 때 확인할 점: 논문이 밝힌 한계와 본문에서 확인해야 할 불확실한 점을 구분한다.

규칙:
- 아래에 제공된 논문 본문만 근거로 사용하고, 없는 내용을 지어내지 않는다.
- method에 관한 주요 설명과 수치 뒤에는 가능한 경우 [p.N] 형식으로 페이지를 표시한다.
- 수식의 기호가 텍스트 추출 과정에서 깨졌다면 억지로 복원하지 말고 그 사실을 밝힌다.
- 마케팅식 표현 대신 ML 연구자가 재구현을 판단할 수 있을 정도로 기술적으로 쓴다.

<paper>
${paperText}
</paper>`;
}

async function readAiRecord(arxivId) {
  const record = await readJsonFile(aiRecordPath(arxivId), null);
  if (
    !record ||
    record.arxivId !== arxivId ||
    record.promptVersion !== aiPromptVersion ||
    typeof record.response !== "string" ||
    !record.response.trim()
  ) return null;
  return record;
}

function friendlyAiError(error) {
  const message = error instanceof Error ? error.message : "Codex 분석에 실패했어요.";
  if (/login|auth|unauthorized|401/i.test(message)) {
    return new Error("Codex 로그인이 필요해요. Codex 앱에서 로그인한 뒤 npm run dev를 다시 실행해주세요.");
  }
  if (/rate.?limit|usage.?limit|quota/i.test(message)) {
    return new Error("현재 Codex 사용 한도에 도달했어요. 한도가 갱신된 뒤 다시 시도해주세요.");
  }
  return new Error(`Codex 분석에 실패했어요: ${message.slice(0, 300)}`);
}

async function createAiGuide(body) {
  if (!isArxivId(body.arxivId)) throw new Error("Invalid arXiv ID.");
  if (typeof body.title !== "string" || !body.title.trim()) throw new Error("Missing paper title.");

  const cached = await readAiRecord(body.arxivId);
  if (cached && !body.force) return { ...cached, cached: true };

  const pdf = await resolvePdfForAnalysis(body);
  const pdfPath = resolvePaperPath(pdf.relativePath);
  if (!pdfPath) throw new Error("Invalid local PDF path.");
  const extracted = await extractPaperText(pdfPath, body);

  try {
    const codex = await getCodexClient();
    const thread = codex.startThread({
      workingDirectory: projectRoot,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      modelReasoningEffort: "medium",
    });
    const turn = await thread.run(paperGuidePrompt(extracted.text));
    if (!turn.finalResponse.trim()) throw new Error("Codex가 빈 응답을 반환했어요.");
    const record = {
      arxivId: body.arxivId,
      title: body.title.trim(),
      promptVersion: aiPromptVersion,
      response: turn.finalResponse.trim(),
      createdAt: new Date().toISOString(),
      threadId: thread.id,
      sourcePdfRelativePath: pdf.relativePath,
      sourceTextRelativePath: path.relative(projectRoot, extracted.textPath),
    };
    await writeIfChanged(aiRecordPath(body.arxivId), `${JSON.stringify(record, null, 2)}\n`);
    return { ...record, cached: false };
  } catch (error) {
    throw friendlyAiError(error);
  }
}

async function runAiGuide(body) {
  const arxivId = typeof body.arxivId === "string" ? body.arxivId : "";
  if (aiJobs.has(arxivId)) return aiJobs.get(arxivId);
  const job = createAiGuide(body).finally(() => aiJobs.delete(arxivId));
  aiJobs.set(arxivId, job);
  return job;
}

async function servePaper(request, response, pathname) {
  const suffix = decodeURIComponent(pathname.slice("/papers/".length));
  const candidate = path.resolve(papersRoot, suffix);
  if (!candidate.startsWith(`${papersRoot}${path.sep}`)) {
    sendJson(request, response, 400, { error: "Invalid PDF path." });
    return;
  }
  let info;
  try {
    info = await stat(candidate);
  } catch {
    sendJson(request, response, 404, { error: "PDF not found." });
    return;
  }

  const range = request.headers.range?.match(/bytes=(\d*)-(\d*)/);
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  if (range) {
    start = range[1] ? Number.parseInt(range[1], 10) : 0;
    end = range[2] ? Number.parseInt(range[2], 10) : end;
    if (start > end || end >= info.size) {
      setCors(request, response);
      response.writeHead(416, { "Content-Range": `bytes */${info.size}` });
      response.end();
      return;
    }
    status = 206;
  }

  setCors(request, response);
  response.writeHead(status, {
    "Accept-Ranges": "bytes",
    "Content-Type": "application/pdf",
    "Content-Length": String(end - start + 1),
    ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}),
  });
  createReadStream(candidate, { start, end }).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (!allowedOrigin(request)) {
    sendJson(request, response, 403, { error: "This companion only accepts local browser requests." });
    return;
  }
  if (request.method === "OPTIONS") {
    setCors(request, response);
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(request, response, 200, {
        connected: true,
        projectRoot,
        choicesPath: "choices/",
        papersPath: ".local/papers/",
        aiPath: ".local/ai/",
        codexPaperGuide: true,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/ai") {
      const arxivId = normalizeArxivId(url.searchParams.get("arxivId") ?? "");
      if (!arxivId) {
        sendJson(request, response, 400, { error: "Invalid arXiv ID." });
        return;
      }
      const record = await readAiRecord(arxivId);
      sendJson(request, response, 200, record ? { ...record, cached: true } : { cached: false });
      return;
    }

    if (request.method === "GET" && url.pathname === "/snapshot") {
      const [rules, state] = await Promise.all([
        readJsonFile(rulesPath, defaultRules),
        readJsonFile(statePath, normalizeState({})),
      ]);
      sendJson(request, response, 200, {
        connected: true,
        rules: normalizeRules(rules),
        state: normalizeState(state),
      });
      return;
    }

    if (request.method === "PUT" && url.pathname === "/snapshot") {
      const body = await readJsonBody(request);
      const rules = normalizeRules(body.rules);
      const state = normalizeState(body.state);
      const csvPath = await enqueueWrite(async () => {
        await writeIfChanged(rulesPath, `${JSON.stringify(rules, null, 2)}\n`);
        await writeIfChanged(statePath, `${JSON.stringify(state, null, 2)}\n`);
        return updateChoices(state.reviews, state.notes, state.progress.date);
      });
      sendJson(request, response, 200, { saved: true, csvPath });
      return;
    }

    if (request.method === "POST" && url.pathname === "/pdf") {
      const result = await downloadPdf(await readJsonBody(request));
      sendJson(request, response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/ai") {
      const result = await runAiGuide(await readJsonBody(request));
      sendJson(request, response, 200, result);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/papers/")) {
      await servePaper(request, response, url.pathname);
      return;
    }

    sendJson(request, response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(request, response, 500, {
      error: error instanceof Error ? error.message : "Local companion request failed.",
    });
  }
});

await Promise.all([mkdir(localRoot, { recursive: true }), mkdir(aiRoot, { recursive: true })]);
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Daily arXiv local companion: http://127.0.0.1:${port}\n`);
});
