import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptRoot, "..");
const configPath = path.join(projectRoot, "config", "x-sources.json");
const csvPath = path.join(projectRoot, "data", "x-shares.csv");
const featuredPath = path.join(projectRoot, "data", "x-featured.json");
const statePath = path.join(projectRoot, "data", "x-sync-state.json");
const RECENT_URL = "https://api.x.com/2/tweets/search/recent";
const ARCHIVE_URL = "https://api.x.com/2/tweets/search/all";
const CSV_HEADERS = [
  "shared_at",
  "x_account",
  "x_post_id",
  "x_post_url",
  "share_type",
  "arxiv_id",
  "arxiv_url",
  "post_text",
  "first_seen_at",
];

function parseArgs(values) {
  const args = {};
  for (const value of values) {
    const match = value.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.max(10, Math.min(parsed, maximum))
    : fallback;
}

function normalizeBearerToken(value) {
  const token = String(value ?? "")
    .trim()
    .replace(/[\s"'“”‘’]+/gu, "");
  if ([...token].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint < 0x21 || codePoint > 0x7e;
  })) {
    throw new Error("X_BEARER_TOKEN contains an unsupported character. Copy only the token value, without surrounding quotes.");
  }
  return token;
}

function isoDate(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return "";
  const suffix = endOfDay ? "T23:59:59Z" : "T00:00:00Z";
  const date = new Date(`${value}${suffix}`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().replace(".000Z", "Z");
}

function normalizeHandle(value) {
  return String(value ?? "").trim().replace(/^@/, "").toLowerCase();
}

function normalizeArxivId(value) {
  const id = String(value ?? "")
    .trim()
    .replace(/[\]),.;:'"]+$/g, "")
    .replace(/[?#].*$/, "")
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "");
  return /^(?:[a-z.-]+\/\d{7}|\d{4}\.\d{4,5})$/i.test(id) ? id : "";
}

function extractArxivIds(values) {
  const ids = new Set();
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?(?:export\.)?arxiv\.org\/(?:abs|pdf|html)\/([^\s?#]+)/gi,
    /(?:https?:\/\/)?ar5iv\.labs\.arxiv\.org\/(?:html\/)?([^\s?#]+)/gi,
    /(?:https?:\/\/)?(?:www\.)?alphaxiv\.org\/(?:abs|overview)\/([^\s?#]+)/gi,
    /\barxiv\s*:\s*((?:[a-z.-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?)/gi,
  ];
  for (const rawValue of values) {
    let value = String(rawValue ?? "");
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep the original text when a URL contains an invalid escape sequence.
    }
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of value.matchAll(pattern)) {
        const id = normalizeArxivId(match[1]);
        if (id) ids.add(id);
      }
    }
  }
  return [...ids];
}

function tweetStrings(tweet) {
  const urls = tweet?.entities?.urls ?? [];
  return [
    tweet?.text,
    ...urls.flatMap((url) => [url?.url, url?.expanded_url, url?.unwound_url, url?.display_url]),
  ].filter(Boolean);
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
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
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers = [], ...records] = rows;
  return records
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function rowKey(row) {
  return `${row.x_post_id}:${row.arxiv_id}`;
}

function newestPostId(values) {
  return values.reduce((latest, value) => {
    if (!/^\d+$/.test(value ?? "")) return latest;
    return !latest || BigInt(value) > BigInt(latest) ? value : latest;
  }, "");
}

function buildQuery(config) {
  const accounts = config.accounts.map(normalizeHandle).filter(Boolean);
  const domains = config.urlDomains.map((domain) => String(domain).trim()).filter(Boolean);
  if (!accounts.length || !domains.length) throw new Error("X source accounts and URL domains are required.");
  return `(${accounts.map((handle) => `from:${handle}`).join(" OR ")}) (${domains.map((domain) => `url:${domain}`).join(" OR ")})`;
}

async function fetchJson(url, token) {
  let lastError = new Error("X request failed.");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "daily-arxiv-x-collector/1.0",
      },
    });
    if (response.ok) return response.json();
    const details = await response.text();
    lastError = new Error(`X API ${response.status}: ${details.slice(0, 500)}`);
    if (response.status !== 429 && response.status < 500) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter)
      ? Math.min(30_000, Math.max(1_000, retryAfter * 1_000))
      : Math.min(30_000, 1_500 * 2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw lastError;
}

function rowsFromResponse(data, accountSet, firstSeenAt) {
  const users = new Map((data.includes?.users ?? []).map((user) => [user.id, normalizeHandle(user.username)]));
  const includedTweets = new Map((data.includes?.tweets ?? []).map((tweet) => [tweet.id, tweet]));
  const rows = [];
  for (const tweet of data.data ?? []) {
    const account = users.get(tweet.author_id) ?? "";
    if (!accountSet.has(account)) continue;
    const references = (tweet.referenced_tweets ?? [])
      .map((reference) => includedTweets.get(reference.id))
      .filter(Boolean);
    const ids = extractArxivIds([
      ...tweetStrings(tweet),
      ...references.flatMap((reference) => tweetStrings(reference)),
    ]);
    const shareType = (tweet.referenced_tweets ?? []).map((reference) => reference.type).join("+") || "post";
    for (const arxivId of ids) {
      rows.push({
        shared_at: tweet.created_at ?? firstSeenAt,
        x_account: account,
        x_post_id: tweet.id,
        x_post_url: `https://x.com/${account}/status/${tweet.id}`,
        share_type: shareType,
        arxiv_id: arxivId,
        arxiv_url: `https://arxiv.org/abs/${arxivId}`,
        post_text: String(tweet.text ?? "").replace(/\s+/g, " ").trim(),
        first_seen_at: firstSeenAt,
      });
    }
  }
  return rows;
}

function aggregateFeatured(rows, config, generatedAt) {
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.arxiv_id) ?? {
      sharedBy: new Set(),
      firstSharedAt: row.shared_at,
      latestSharedAt: row.shared_at,
      postUrls: new Set(),
      shareCount: 0,
    };
    current.sharedBy.add(row.x_account);
    current.postUrls.add(row.x_post_url);
    current.shareCount += 1;
    if (row.shared_at < current.firstSharedAt) current.firstSharedAt = row.shared_at;
    if (row.shared_at > current.latestSharedAt) current.latestSharedAt = row.shared_at;
    grouped.set(row.arxiv_id, current);
  }
  return {
    generatedAt,
    accounts: config.accounts.map(normalizeHandle),
    rowCount: rows.length,
    featured: Object.fromEntries(
      [...grouped.entries()].map(([arxivId, signal]) => [
        arxivId,
        {
          sharedBy: [...signal.sharedBy].sort(),
          firstSharedAt: signal.firstSharedAt,
          latestSharedAt: signal.latestSharedAt,
          postUrls: [...signal.postUrls],
          shareCount: signal.shareCount,
        },
      ]),
    ),
  };
}

async function writeArchive(rows, config, generatedAt) {
  rows.sort((a, b) => b.shared_at.localeCompare(a.shared_at) || b.x_post_id.localeCompare(a.x_post_id));
  const csv = [
    CSV_HEADERS.map(csvEscape).join(","),
    ...rows.map((row) => CSV_HEADERS.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n") + "\n";
  await writeFile(csvPath, csv);
  await writeFile(featuredPath, `${JSON.stringify(aggregateFeatured(rows, config, generatedAt), null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode === "backfill" ? "backfill" : "recent";
  const token = normalizeBearerToken(process.env.X_BEARER_TOKEN);
  if (!token) throw new Error("Set X_BEARER_TOKEN before running the X collector.");

  const config = JSON.parse(await readFile(configPath, "utf8"));
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const existingRows = parseCsv(await readFile(csvPath, "utf8"));
  const rowsByKey = new Map(existingRows.map((row) => [rowKey(row), row]));
  const accountSet = new Set(config.accounts.map(normalizeHandle));
  const query = buildQuery(config);
  const maxPosts = positiveInteger(args["max-posts"], mode === "backfill" ? 2_000 : 1_000, 10_000);
  const now = new Date().toISOString();
  const start = mode === "backfill" ? isoDate(args.start) : "";
  const requestedEnd = mode === "backfill" ? isoDate(args.end, true) : "";
  const latestAllowedEnd = new Date(Date.now() - 15_000).toISOString().replace(".000Z", "Z");
  const end = requestedEnd && requestedEnd > latestAllowedEnd ? latestAllowedEnd : requestedEnd;
  if (mode === "backfill" && (!start || !end || start >= end)) {
    throw new Error("Backfill requires --start=YYYY-MM-DD and --end=YYYY-MM-DD.");
  }

  const rangeKey = mode === "backfill" ? `${args.start}:${args.end}` : "";
  const resume = mode === "backfill" ? state.backfills?.[rangeKey] : null;
  if (mode === "backfill" && resume?.complete) {
    process.stdout.write(`backfill ${rangeKey} is already complete; no X API request was made.\n`);
    return;
  }
  const recentResume = mode === "recent" && state.recent?.nextToken ? state.recent : null;
  const recentBaseSinceId = recentResume?.baseSinceId ?? state.recent?.sinceId ?? "";
  const recentBaseStartTime = recentResume?.baseStartTime ?? new Date(Date.now() - 6 * 24 * 60 * 60 * 1_000).toISOString();
  let nextToken = mode === "backfill" ? resume?.nextToken : recentResume?.nextToken;
  let newestId = recentResume?.pendingNewestId ?? state.recent?.sinceId ?? "";
  let fetchedPosts = 0;
  let matchedRows = 0;
  let complete = false;

  do {
    const params = new URLSearchParams({
      query,
      max_results: String(mode === "backfill" ? Math.min(500, maxPosts - fetchedPosts) : Math.min(100, maxPosts - fetchedPosts)),
      "tweet.fields": "id,author_id,created_at,entities,referenced_tweets,text",
      expansions: "author_id,referenced_tweets.id",
      "user.fields": "username",
    });
    if (mode === "backfill") {
      params.set("start_time", start);
      params.set("end_time", end);
    } else if (recentBaseSinceId) {
      params.set("since_id", recentBaseSinceId);
    } else {
      params.set("start_time", recentBaseStartTime);
    }
    if (nextToken) params.set("next_token", nextToken);

    const data = await fetchJson(`${mode === "backfill" ? ARCHIVE_URL : RECENT_URL}?${params}`, token);
    const posts = data.data ?? [];
    fetchedPosts += posts.length;
    newestId = newestPostId([newestId, ...posts.map((post) => post.id)]);
    const newRows = rowsFromResponse(data, accountSet, now);
    matchedRows += newRows.length;
    for (const row of newRows) {
      const key = rowKey(row);
      if (!rowsByKey.has(key)) rowsByKey.set(key, row);
    }
    nextToken = data.meta?.next_token;
    complete = !nextToken;
  } while (nextToken && fetchedPosts < maxPosts);

  state.recent ??= {};
  state.backfills ??= {};
  if (mode === "recent") {
    state.recent = complete
      ? {
          sinceId: newestId || state.recent.sinceId || null,
          nextToken: null,
          baseSinceId: null,
          baseStartTime: null,
          pendingNewestId: null,
          lastSyncedAt: now,
        }
      : {
          sinceId: state.recent.sinceId || null,
          nextToken,
          baseSinceId: recentBaseSinceId || null,
          baseStartTime: recentBaseSinceId ? null : recentBaseStartTime,
          pendingNewestId: newestId || null,
          lastSyncedAt: now,
        };
  } else {
    state.backfills[rangeKey] = {
      start,
      end,
      nextToken: complete ? null : nextToken,
      complete,
      lastSyncedAt: now,
    };
  }
  await writeArchive([...rowsByKey.values()], config, now);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  process.stdout.write(
    `${mode}: read ${fetchedPosts} X posts, found ${matchedRows} arXiv links, archive has ${rowsByKey.size} rows${complete ? "." : "; run the same range again to continue."}\n`,
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { aggregateFeatured, extractArxivIds, normalizeArxivId, normalizeBearerToken, parseCsv };
