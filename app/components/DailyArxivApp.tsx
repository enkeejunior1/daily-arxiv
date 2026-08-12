"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canonicalizeKeywordGroup,
  keywordGroupKey,
  keywordGroupMatches,
  normalizeText,
} from "../lib/keyword-groups.mjs";
import { PdfCanvasReader } from "./PdfCanvasReader";

type Decision = "heart" | "superheart";
type View = "daily" | "saved" | "rules";
type FeedFilter = "all" | "unread" | "heart" | "superheart";

type DeepXivSignal = {
  rank: number;
  mentions: number;
  likes: number;
  retweets: number;
  views: number;
  mentionedBy: string[];
  latestMention: string;
};

type CitationSeed = {
  arxivId: string;
  weight: number;
};

type Paper = {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  publishedAt: string;
  arxivUrl: string;
  pdfUrl: string;
  deepxiv?: DeepXivSignal;
  citationSeedIds?: string[];
};

type Rules = {
  authors: string[];
  positiveKeywords: string[];
  negativeKeywords: string[];
  citationSeeds: CitationSeed[];
};

type ScoredPaper = Paper & {
  authorHit: boolean;
  baseScore: number;
  reasons: {
    label: string;
    value: number;
    kind: "positive" | "negative" | "featured" | "citation";
  }[];
};

type ReviewRecord = {
  paper: ScoredPaper;
  decision: Decision;
  reviewedAt: string;
  selectedDate: string;
};

type FeedProgress = {
  date: string;
  seenIds: string[];
  autoBookmarkId: string | null;
  manualBookmarkId: string | null;
};

type DownloadRecord = {
  relativePath: string;
  savedAt: string;
};

type CompanionSnapshot = {
  connected: boolean;
  rules?: Rules;
  state?: {
    reviews?: ReviewRecord[];
    progress?: FeedProgress;
    downloads?: Record<string, DownloadRecord>;
  };
};

const STORAGE_KEY = "daily-arxiv-state-v3";
const LEGACY_STORAGE_KEY = "daily-arxiv-state-v2";
const COMPANION_URL = "http://127.0.0.1:4317";
const USER_TIME_ZONE = "America/Los_Angeles";
const DAILY_TARGET = 250;
const FEATURED_SCORE = 5;
const PDF_ZOOM_MIN = 50;
const PDF_ZOOM_MAX = 300;
const PDF_ZOOM_STEP = 25;

function todayKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: USER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = value.year;
  const month = value.month;
  const day = value.day;
  return `${year}-${month}-${day}`;
}

const DEFAULT_RULES: Rules = {
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

const DEMO_PAPERS: Paper[] = [
  {
    id: "1706.03762",
    title: "Attention Is All You Need",
    abstract:
      "A sequence transduction architecture based entirely on attention mechanisms, dispensing with recurrence and convolutions. The resulting language model is more parallelizable and reaches strong translation quality.",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
    categories: ["cs.CL", "cs.LG"],
    publishedAt: "2017-06-12T17:57:34Z",
    arxivUrl: "https://arxiv.org/abs/1706.03762",
    pdfUrl: "https://arxiv.org/pdf/1706.03762",
  },
  {
    id: "2103.00020",
    title: "Learning Transferable Visual Models From Natural Language Supervision",
    abstract:
      "We study a scalable method for learning visual representations from natural language supervision and demonstrate strong zero-shot transfer across vision benchmarks.",
    authors: ["Alec Radford", "Jong Wook Kim", "Chris Hallacy", "Ilya Sutskever"],
    categories: ["cs.CV", "cs.CL"],
    publishedAt: "2021-02-26T19:04:58Z",
    arxivUrl: "https://arxiv.org/abs/2103.00020",
    pdfUrl: "https://arxiv.org/pdf/2103.00020",
  },
  {
    id: "2010.11929",
    title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale",
    abstract:
      "We apply a pure transformer directly to sequences of image patches. Pre-training at scale produces excellent results on image classification tasks.",
    authors: ["Alexey Dosovitskiy", "Lucas Beyer", "Alexander Kolesnikov"],
    categories: ["cs.CV"],
    publishedAt: "2020-10-22T12:03:52Z",
    arxivUrl: "https://arxiv.org/abs/2010.11929",
    pdfUrl: "https://arxiv.org/pdf/2010.11929",
  },
  {
    id: "2302.13971",
    title: "LLaMA: Open and Efficient Foundation Language Models",
    abstract:
      "We introduce a collection of foundation language models ranging from 7B to 65B parameters and show that training on publicly available datasets can reach competitive performance.",
    authors: ["Hugo Touvron", "Thibaut Lavril", "Gautier Izacard"],
    categories: ["cs.CL"],
    publishedAt: "2023-02-27T18:05:36Z",
    arxivUrl: "https://arxiv.org/abs/2302.13971",
    pdfUrl: "https://arxiv.org/pdf/2302.13971",
  },
  {
    id: "2307.09288",
    title: "Llama 2: Open Foundation and Fine-Tuned Chat Models",
    abstract:
      "We develop and release pretrained and fine-tuned large language models, including models optimized for dialogue use cases with extensive safety evaluations.",
    authors: ["Hugo Touvron", "Louis Martin", "Kevin Stone", "Thomas Scialom"],
    categories: ["cs.CL", "cs.AI"],
    publishedAt: "2023-07-18T14:33:31Z",
    arxivUrl: "https://arxiv.org/abs/2307.09288",
    pdfUrl: "https://arxiv.org/pdf/2307.09288",
  },
  {
    id: "2005.14165",
    title: "Language Models are Few-Shot Learners",
    abstract:
      "Scaling autoregressive language models greatly improves task-agnostic few-shot performance, sometimes reaching competitiveness with prior fine-tuned approaches.",
    authors: ["Tom Brown", "Benjamin Mann", "Nick Ryder", "Ilya Sutskever"],
    categories: ["cs.CL"],
    publishedAt: "2020-05-28T17:00:07Z",
    arxivUrl: "https://arxiv.org/abs/2005.14165",
    pdfUrl: "https://arxiv.org/pdf/2005.14165",
  },
  {
    id: "2206.07682",
    title: "Emergent Abilities of Large Language Models",
    abstract:
      "We discuss abilities that are not present in smaller language models but arise in larger models, surveying emergence across model families and tasks.",
    authors: ["Jason Wei", "Yi Tay", "Rishi Bommasani"],
    categories: ["cs.CL"],
    publishedAt: "2022-06-15T17:57:32Z",
    arxivUrl: "https://arxiv.org/abs/2206.07682",
    pdfUrl: "https://arxiv.org/pdf/2206.07682",
  },
  {
    id: "1803.10122",
    title: "World Models",
    abstract:
      "A generative recurrent world model learns compressed spatial and temporal representations that allow an agent to solve reinforcement learning tasks inside its own dream.",
    authors: ["David Ha", "Jürgen Schmidhuber"],
    categories: ["cs.LG", "cs.AI"],
    publishedAt: "2018-03-27T15:25:42Z",
    arxivUrl: "https://arxiv.org/abs/1803.10122",
    pdfUrl: "https://arxiv.org/pdf/1803.10122",
  },
];

function normalize(value: string) {
  return normalizeText(value);
}

function normalizeArxivId(value: string) {
  const id = value
    .trim()
    .replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "");
  return /^(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})$/i.test(id) ? id : "";
}

function normalizeRules(value: Partial<Rules> | undefined): Rules {
  return {
    authors: Array.isArray(value?.authors) ? value.authors : [],
    positiveKeywords: Array.isArray(value?.positiveKeywords) ? value.positiveKeywords : [],
    negativeKeywords: Array.isArray(value?.negativeKeywords) ? value.negativeKeywords : [],
    citationSeeds: Array.isArray(value?.citationSeeds)
      ? value.citationSeeds.flatMap((seed) => {
          const arxivId = normalizeArxivId(seed?.arxivId ?? "");
          const weight = Number(seed?.weight);
          return arxivId && Number.isFinite(weight)
            ? [{ arxivId, weight: Math.max(1, Math.min(100, weight)) }]
            : [];
        })
      : [],
  };
}

function scorePaper(paper: Paper, rules: Rules): ScoredPaper {
  const authorHit = rules.authors.some((tracked) =>
    paper.authors.some((author) => normalize(author) === normalize(tracked)),
  );
  const text = `${paper.title} ${paper.abstract}`;
  const positiveHits = rules.positiveKeywords.filter((group) => keywordGroupMatches(text, group));
  const negativeHits = rules.negativeKeywords.filter((group) => keywordGroupMatches(text, group));
  const citationHits = (paper.citationSeedIds ?? []).flatMap((seedId) => {
    const seed = rules.citationSeeds.find((candidate) => candidate.arxivId === seedId);
    return seed ? [seed] : [];
  });
  const isFeatured = Boolean(paper.deepxiv);
  const reasons: ScoredPaper["reasons"] = [];

  if (isFeatured) {
    reasons.push({
      label: `DeepXiv 7d #${paper.deepxiv?.rank}`,
      value: FEATURED_SCORE,
      kind: "featured",
    });
  }
  positiveHits.forEach((keyword) =>
    reasons.push({ label: keyword, value: 2, kind: "positive" }),
  );
  negativeHits.forEach((keyword) =>
    reasons.push({ label: keyword, value: -2, kind: "negative" }),
  );
  citationHits.forEach((seed) =>
    reasons.push({ label: `Cites ${seed.arxivId}`, value: seed.weight, kind: "citation" }),
  );

  return {
    ...paper,
    authorHit,
    baseScore:
      (isFeatured ? FEATURED_SCORE : 0) +
      positiveHits.length * 2 -
      negativeHits.length * 2 +
      citationHits.reduce((total, seed) => total + seed.weight, 0),
    reasons,
  };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function queueForToday(papers: Paper[], rules: Rules) {
  const today = todayKey();
  const scored = papers.map((paper) => scorePaper(paper, rules));
  const authorPapers = scored.filter((paper) => paper.authorHit);
  const regular = scored
    .filter((paper) => !paper.authorHit && paper.baseScore > 0)
    .sort(
      (a, b) =>
        b.baseScore - a.baseScore || stableHash(`${today}:${a.id}`) - stableHash(`${today}:${b.id}`),
    );
  authorPapers.sort(
    (a, b) =>
      b.baseScore - a.baseScore || stableHash(`${today}:${a.id}`) - stableHash(`${today}:${b.id}`),
  );
  return [...authorPapers, ...regular].slice(0, DAILY_TARGET);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function decisionLabel(decision: Decision) {
  return decision === "superheart" ? "Superheart" : "Heart";
}

function companionPdfUrl(download: DownloadRecord | undefined) {
  if (!download?.relativePath.startsWith(".local/papers/")) return null;
  const suffix = download.relativePath
    .slice(".local/papers/".length)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `${COMPANION_URL}/papers/${suffix}`;
}

function TagsEditor({
  label,
  hint,
  values,
  supportsAliases = false,
  placeholder,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  supportsAliases?: boolean;
  placeholder?: string;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addValue() {
    const value = supportsAliases ? canonicalizeKeywordGroup(draft) : draft.trim();
    const valueKey = supportsAliases ? keywordGroupKey(value) : normalize(value);
    if (
      !valueKey ||
      values.some((item) =>
        supportsAliases ? keywordGroupKey(item) === valueKey : normalize(item) === valueKey,
      )
    ) return;
    onChange([...values, value]);
    setDraft("");
  }

  return (
    <section className="rule-block">
      <div className="rule-heading">
        <div>
          <h3>{label}</h3>
          <p>{hint}</p>
        </div>
        <span>{values.length}</span>
      </div>
      <div className="rule-tags">
        {values.map((value) => (
          <button
            className="rule-tag"
            key={value}
            onClick={() => onChange(values.filter((item) => item !== value))}
            aria-label={`${value} 삭제`}
          >
            {value} <span>×</span>
          </button>
        ))}
      </div>
      <div className="rule-input-row">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addValue();
            }
          }}
          placeholder={placeholder ?? `${label} 추가`}
        />
        <button onClick={addValue}>추가</button>
      </div>
    </section>
  );
}

function CitationSeedsEditor({
  values,
  source,
  resolved,
  onChange,
}: {
  values: CitationSeed[];
  source: "idle" | "loading" | "connected" | "error";
  resolved: number;
  onChange: (values: CitationSeed[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [weight, setWeight] = useState(10);
  const [error, setError] = useState("");

  function addSeed() {
    const arxivId = normalizeArxivId(draft);
    if (!arxivId) {
      setError("arXiv 링크 또는 ID를 입력해주세요.");
      return;
    }
    if (values.some((seed) => seed.arxivId === arxivId)) {
      setError("이미 등록된 기준 논문입니다.");
      return;
    }
    onChange([...values, { arxivId, weight: Math.max(1, Math.min(100, weight)) }]);
    setDraft("");
    setError("");
  }

  return (
    <section className="citation-rules">
      <div className="citation-rules-heading">
        <div>
          <p className="eyebrow">CITATION SEEDS</p>
          <h2>이 논문들을 인용한 새 논문 우선 보기</h2>
          <p>기준 논문의 arXiv 링크나 ID를 등록하세요. 논문 하나를 인용할 때마다 설정한 점수를 한 번 더합니다.</p>
        </div>
        <span className={`citation-connection ${source}`}>
          {source === "loading"
            ? "citation graph 확인 중"
            : source === "connected"
              ? `Semantic Scholar · ${resolved} resolved`
              : source === "error"
                ? "citation graph 오류"
                : `${values.length} seeds`}
        </span>
      </div>
      <div className="citation-seed-list">
        {values.length ? (
          values.map((seed) => (
            <div className="citation-seed-row" key={seed.arxivId}>
              <a href={`https://arxiv.org/abs/${seed.arxivId}`} target="_blank" rel="noreferrer">
                arXiv:{seed.arxivId} ↗
              </a>
              <label>
                <span>Weight</span>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={seed.weight}
                  onChange={(event) => {
                    const nextWeight = Math.max(1, Math.min(100, Number(event.target.value) || 1));
                    onChange(
                      values.map((item) =>
                        item.arxivId === seed.arxivId ? { ...item, weight: nextWeight } : item,
                      ),
                    );
                  }}
                  aria-label={`${seed.arxivId} citation weight`}
                />
              </label>
              <button
                onClick={() => onChange(values.filter((item) => item.arxivId !== seed.arxivId))}
                aria-label={`${seed.arxivId} 기준 논문 삭제`}
              >
                삭제
              </button>
            </div>
          ))
        ) : (
          <div className="citation-seed-empty">아직 등록된 기준 논문이 없습니다.</div>
        )}
      </div>
      <div className="citation-seed-add">
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addSeed();
            }
          }}
          placeholder="arXiv URL 또는 ID · 예: 1706.03762"
          aria-label="Citation seed arXiv URL 또는 ID"
        />
        <label>
          <span>+ score</span>
          <input
            type="number"
            min="1"
            max="100"
            value={weight}
            onChange={(event) => setWeight(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
            aria-label="새 citation seed 가중치"
          />
        </label>
        <button onClick={addSeed}>기준 논문 추가</button>
      </div>
      {error ? <p className="citation-seed-error">{error}</p> : null}
      {source === "error" ? (
        <p className="citation-seed-error">
          공용 API가 혼잡할 수 있어요. 무료 Semantic Scholar API key를 .env.local에 추가하면 안정적으로 동작합니다.
        </p>
      ) : null}
    </section>
  );
}

export function DailyArxivApp() {
  const [view, setView] = useState<View>("daily");
  const [papers, setPapers] = useState<Paper[]>(DEMO_PAPERS);
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [source, setSource] = useState<"loading" | "arxiv" | "demo">("loading");
  const [deepxivSource, setDeepxivSource] = useState<"loading" | "connected" | "error">("loading");
  const [deepxivByPaper, setDeepxivByPaper] = useState<Record<string, DeepXivSignal>>({});
  const [citationSource, setCitationSource] = useState<
    "idle" | "loading" | "connected" | "error"
  >("idle");
  const [citationMatches, setCitationMatches] = useState<Record<string, string[]>>({});
  const [citationResolved, setCitationResolved] = useState(0);
  const [companionStatus, setCompanionStatus] = useState<"loading" | "connected" | "offline">(
    "loading",
  );
  const [downloads, setDownloads] = useState<Record<string, DownloadRecord>>({});
  const [notice, setNotice] = useState("");
  const [selectedPaper, setSelectedPaper] = useState<ScoredPaper | null>(null);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [pdfState, setPdfState] = useState<"idle" | "loading" | "downloading" | "ready" | "error">(
    "idle",
  );
  const [pdfZoom, setPdfZoom] = useState(100);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [autoBookmarkId, setAutoBookmarkId] = useState<string | null>(null);
  const [manualBookmarkId, setManualBookmarkId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const restoreDoneRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 1800);

    function applySnapshot(snapshot: CompanionSnapshot) {
      if (snapshot.rules) {
        const nextRules = normalizeRules(snapshot.rules);
        setRules(nextRules);
        setCitationSource(nextRules.citationSeeds.length ? "loading" : "idle");
      }
      if (snapshot.state?.reviews) {
        setReviews(
          snapshot.state.reviews.map((review) => ({
            ...review,
            selectedDate: review.selectedDate || review.reviewedAt.slice(0, 10),
          })),
        );
      }
      if (snapshot.state?.downloads) setDownloads(snapshot.state.downloads);
      if (snapshot.state?.progress?.date === todayKey()) {
        setSeenIds(new Set(snapshot.state.progress.seenIds));
        setAutoBookmarkId(snapshot.state.progress.autoBookmarkId);
        setManualBookmarkId(snapshot.state.progress.manualBookmarkId);
      }
    }

    function applyLocalFallback() {
      try {
        const saved =
          window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as {
            rules?: Rules;
            reviews?: ReviewRecord[];
            progress?: FeedProgress;
            downloads?: Record<string, DownloadRecord>;
          };
          applySnapshot({ connected: false, rules: parsed.rules, state: parsed });
        }
      } catch {
        setNotice("저장된 설정을 읽지 못해 기본값으로 시작했어요.");
      }
    }

    fetch(`${COMPANION_URL}/snapshot`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("local companion unavailable");
        return (await response.json()) as CompanionSnapshot;
      })
      .then((snapshot) => {
        if (!active) return;
        applySnapshot(snapshot);
        setCompanionStatus("connected");
      })
      .catch(() => {
        if (!active) return;
        applyLocalFallback();
        setCompanionStatus("offline");
      })
      .finally(() => {
        if (!active) return;
        window.clearTimeout(timeout);
        setHydrated(true);
      });

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/arxiv")
      .then(async (response) => {
        if (!response.ok) throw new Error("feed unavailable");
        return (await response.json()) as { papers?: Paper[] };
      })
      .then((data) => {
        if (!active || !data.papers?.length) throw new Error("empty feed");
        setPapers(data.papers);
        setSource("arxiv");
      })
      .catch(() => {
        if (!active) return;
        setPapers(DEMO_PAPERS);
        setSource("demo");
      });
    return () => {
      active = false;
    };
  }, []);

  const citationSeedKey = rules.citationSeeds.map((seed) => seed.arxivId).sort().join(",");
  const activeCitationSource = citationSeedKey ? citationSource : "idle";
  const activeCitationResolved = citationSeedKey ? citationResolved : 0;

  useEffect(() => {
    if (!hydrated) return;
    const seedIds = citationSeedKey ? citationSeedKey.split(",") : [];
    if (!seedIds.length) return;

    let active = true;
    const controller = new AbortController();
    fetch("/api/citation-signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperIds: papers.map((paper) => paper.id), seedIds }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          connected?: boolean;
          matches?: Record<string, string[]>;
          resolved?: number;
          message?: string;
        };
        if (!response.ok || !data.connected) {
          throw new Error(data.message ?? "Citation graph unavailable");
        }
        return data;
      })
      .then((data) => {
        if (!active) return;
        setCitationMatches(data.matches ?? {});
        setCitationResolved(data.resolved ?? 0);
        setCitationSource("connected");
      })
      .catch((error) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setCitationMatches({});
        setCitationResolved(0);
        setCitationSource("error");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [citationSeedKey, hydrated, papers]);

  useEffect(() => {
    let active = true;
    fetch("/api/deepxiv-featured")
      .then(async (response) => {
        const data = (await response.json()) as {
          connected?: boolean;
          featured?: Record<string, DeepXivSignal>;
          message?: string;
        };
        if (!response.ok) throw new Error(data.message ?? "DeepXiv feed unavailable");
        return data;
      })
      .then((data) => {
        if (!active) return;
        setDeepxivByPaper(data.featured ?? {});
        setDeepxivSource(data.connected ? "connected" : "error");
      })
      .catch(() => {
        if (!active) return;
        setDeepxivByPaper({});
        setDeepxivSource("error");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const progress: FeedProgress = {
      date: todayKey(),
      seenIds: [...seenIds],
      autoBookmarkId,
      manualBookmarkId,
    };
    const state = { reviews, progress, downloads };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ rules, ...state }));
    if (companionStatus !== "connected") return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`${COMPANION_URL}/snapshot`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules, state }),
        signal: controller.signal,
      }).catch(() => setCompanionStatus("offline"));
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [autoBookmarkId, companionStatus, downloads, hydrated, manualBookmarkId, reviews, rules, seenIds]);

  const enrichedPapers = useMemo(
    () =>
      papers.map((paper) => ({
        ...paper,
        deepxiv: deepxivByPaper[paper.id],
        citationSeedIds: citationSeedKey ? citationMatches[paper.id] ?? [] : [],
      })),
    [citationMatches, citationSeedKey, deepxivByPaper, papers],
  );
  const queue = useMemo(() => queueForToday(enrichedPapers, rules), [enrichedPapers, rules]);
  const statusByPaper = useMemo(
    () => new Map(reviews.map((review) => [review.paper.id, review.decision])),
    [reviews],
  );
  const savedReviews = reviews;
  const filteredQueue = queue.filter((paper) => {
    const status = statusByPaper.get(paper.id);
    if (feedFilter === "unread") return !status && !seenIds.has(paper.id);
    if (feedFilter === "heart") return status === "heart";
    if (feedFilter === "superheart") return status === "superheart";
    return true;
  });
  const currentPaper = selectedPaper
    ? queue.find((paper) => paper.id === selectedPaper.id) ?? selectedPaper
    : null;
  const currentLocalPdfUrl = currentPaper ? companionPdfUrl(downloads[currentPaper.id]) : null;
  const currentPdfUrl = currentLocalPdfUrl ?? currentPaper?.pdfUrl ?? "";
  const pdfReaderUrl = currentPaper
    ? currentLocalPdfUrl ?? `/api/pdf-source?arxivId=${encodeURIComponent(currentPaper.id)}`
    : "";

  const updatePdfZoom = useCallback((nextZoom: number) => {
    setPdfZoom(Math.max(PDF_ZOOM_MIN, Math.min(PDF_ZOOM_MAX, nextZoom)));
  }, []);

  const zoomPdfOut = useCallback(() => {
    updatePdfZoom(pdfZoom - PDF_ZOOM_STEP);
  }, [pdfZoom, updatePdfZoom]);

  const zoomPdfIn = useCallback(() => {
    updatePdfZoom(pdfZoom + PDF_ZOOM_STEP);
  }, [pdfZoom, updatePdfZoom]);

  const cachePdf = useCallback(
    async (paper: ScoredPaper) => {
      if (downloads[paper.id]) return;
      if (companionStatus !== "connected") {
        setNotice("로컬 companion이 꺼져 있어 PDF는 arXiv에서 바로 열었어요.");
        return;
      }
      setPdfState("downloading");
      try {
        const response = await fetch(`${COMPANION_URL}/pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            arxivId: paper.id,
            title: paper.title,
            pdfUrl: paper.pdfUrl,
            date: todayKey(),
          }),
        });
        const data = (await response.json()) as { relativePath?: string; error?: string };
        if (!response.ok || !data.relativePath) throw new Error(data.error ?? "PDF cache failed");
        setDownloads((previous) => ({
          ...previous,
          [paper.id]: { relativePath: data.relativePath!, savedAt: new Date().toISOString() },
        }));
        setPdfState("loading");
        setNotice(`PDF 저장 완료 · ${data.relativePath}`);
      } catch {
        setPdfState("error");
        setNotice("PDF를 로컬에 저장하지 못했어요. arXiv 원본은 계속 열 수 있습니다.");
      }
    },
    [companionStatus, downloads],
  );

  const togglePaper = useCallback((paper: ScoredPaper, decision: Decision) => {
    const isActive = statusByPaper.get(paper.id) === decision;
    setReviews((previous) => {
      if (isActive) return previous.filter((review) => review.paper.id !== paper.id);
      const record: ReviewRecord = {
        paper,
        decision,
        reviewedAt: new Date().toISOString(),
        selectedDate: todayKey(),
      };
      return [...previous.filter((review) => review.paper.id !== paper.id), record];
    });
    if (!isActive) void cachePdf(paper);
    setNotice(`${decisionLabel(decision)}${isActive ? " 취소" : ""} · ${paper.title}`);
  }, [cachePdf, statusByPaper]);

  const openPaper = useCallback((paper: ScoredPaper) => {
    setSelectedPaper(paper);
    setPdfState("loading");
  }, []);

  const handleSingleClick = useCallback((paper: ScoredPaper) => {
    openPaper(paper);
  }, [openPaper]);

  const handleDoubleClick = useCallback(
    (paper: ScoredPaper) => {
      openPaper(paper);
      togglePaper(paper, "heart");
    },
    [openPaper, togglePaper],
  );

  const handleSuperheart = useCallback(
    (paper: ScoredPaper) => {
      openPaper(paper);
      togglePaper(paper, "superheart");
    },
    [openPaper, togglePaper],
  );

  const removeSavedStatus = useCallback((paperId: string) => {
    setReviews((previous) => previous.filter((review) => review.paper.id !== paperId));
    setNotice("저장 표시를 해제했어요.");
  }, []);

  const handleFeedScroll = useCallback(() => {
    if (feedFilter !== "all" || scrollRafRef.current !== null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const feed = feedRef.current;
      if (!feed) return;
      const cards = Array.from(feed.querySelectorAll<HTMLElement>("[data-paper-id]"));
      const feedTop = feed.getBoundingClientRect().top;
      const passedIds: string[] = [];
      let firstVisibleId: string | null = null;

      cards.forEach((card) => {
        const id = card.dataset.paperId;
        if (!id) return;
        const rect = card.getBoundingClientRect();
        if (rect.bottom <= feedTop + 2) passedIds.push(id);
        else if (!firstVisibleId) firstVisibleId = id;
      });

      if (passedIds.length) {
        setSeenIds((previous) => {
          const next = new Set(previous);
          passedIds.forEach((id) => next.add(id));
          return next.size === previous.size ? previous : next;
        });
      }
      if (firstVisibleId) setAutoBookmarkId(firstVisibleId);
    });
  }, [feedFilter]);

  useEffect(() => {
    if (!hydrated || source === "loading" || restoreDoneRef.current || !queue.length) return;
    const feed = feedRef.current;
    if (!feed) return;
    restoreDoneRef.current = true;
    const cards = Array.from(feed.querySelectorAll<HTMLElement>("[data-paper-id]"));
    const target = [manualBookmarkId, autoBookmarkId]
      .filter((id): id is string => Boolean(id))
      .map((id) => cards.find((card) => card.dataset.paperId === id))
      .find((card): card is HTMLElement => Boolean(card));
    if (target) feed.scrollTop = target.offsetTop;
  }, [autoBookmarkId, hydrated, manualBookmarkId, queue.length, source]);

  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) window.cancelAnimationFrame(scrollRafRef.current);
    },
    [],
  );

  const setManualBookmark = useCallback((paper: ScoredPaper) => {
    setManualBookmarkId(paper.id);
    setNotice(`수동 북마크 · ${paper.title}`);
  }, []);

  function downloadCsvBackup() {
    const header = [
      "date",
      "decision",
      "arxiv_id",
      "arxiv_link",
      "title",
      "first_author",
      "last_author",
      "score",
      "selected_at",
    ];
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = savedReviews.map((review) => [
      review.selectedDate,
      review.decision,
      review.paper.id,
      review.paper.arxivUrl,
      review.paper.title,
      review.paper.authors[0] ?? "",
      review.paper.authors.at(-1) ?? "",
      review.paper.baseScore,
      review.reviewedAt,
    ]);
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `daily-arxiv-${todayKey()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function syncRepositoryCsv() {
    if (companionStatus !== "connected") {
      downloadCsvBackup();
      setNotice("로컬 companion이 꺼져 있어 CSV 파일로 내려받았어요.");
      return;
    }
    const progress: FeedProgress = {
      date: todayKey(),
      seenIds: [...seenIds],
      autoBookmarkId,
      manualBookmarkId,
    };
    try {
      const response = await fetch(`${COMPANION_URL}/snapshot`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules, state: { reviews, progress, downloads } }),
      });
      const data = (await response.json()) as { csvPath?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "CSV sync failed");
      setNotice(`GitHub용 CSV 저장 완료 · ${data.csvPath}`);
    } catch {
      setCompanionStatus("offline");
      downloadCsvBackup();
      setNotice("저장소 연결이 끊겨 CSV 파일로 내려받았어요.");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("daily")} aria-label="Daily arXiv 홈">
          <span className="brand-mark">a</span>
          <span>
            <strong>daily arXiv</strong>
            <small>mode-seeking reader</small>
          </span>
        </button>
        <nav className="main-nav" aria-label="주 메뉴">
          <button className={view === "daily" ? "active" : ""} onClick={() => setView("daily")}>
            Daily
          </button>
          <button className={view === "saved" ? "active" : ""} onClick={() => setView("saved")}>
            Saved <span>{savedReviews.length}</span>
          </button>
          <button className={view === "rules" ? "active" : ""} onClick={() => setView("rules")}>
            Rules
          </button>
        </nav>
        <div className="source-status">
          <span>
            <i className={source === "arxiv" ? "online" : ""} />
            {source === "loading" ? "피드 확인 중" : source === "arxiv" ? "arXiv live" : "demo data"}
          </span>
          <span title="DeepXiv 최근 7일 Trending Top 50">
            <i className={deepxivSource === "connected" ? "featured-online" : ""} />
            {deepxivSource === "loading"
              ? "DeepXiv 확인 중"
              : deepxivSource === "connected"
                ? `DeepXiv ${Object.keys(deepxivByPaper).length}`
                : "DeepXiv 오류"}
          </span>
          <span title="Semantic Scholar citation graph">
            <i className={activeCitationSource === "connected" ? "citation-online" : ""} />
            {activeCitationSource === "loading"
              ? "Citations 확인 중"
              : activeCitationSource === "connected"
                ? `Citations ${activeCitationResolved}`
                : activeCitationSource === "error"
                  ? "Citations 오류"
                  : "Citations off"}
          </span>
          <span title="choices CSV, rules.json, PDF cache를 저장하는 로컬 companion">
            <i className={companionStatus === "connected" ? "online" : ""} />
            {companionStatus === "loading"
              ? "Repo 확인 중"
              : companionStatus === "connected"
                ? "Repo synced"
                : "Repo offline"}
          </span>
        </div>
      </header>

      {view === "daily" && (
        <div className="feed-workspace">
          <section className="feed-column">
            <div className="feed-heading">
              <div>
                <p className="eyebrow">TODAY · {new Date().toLocaleDateString("ko-KR", { timeZone: USER_TIME_ZONE })}</p>
                <h1>관심 논문 피드</h1>
                <p>스크롤해서 지나치고, 클릭해서 저장하고 읽어보세요.</p>
              </div>
              <strong>{queue.length}</strong>
            </div>
            <div className="gesture-guide" aria-label="피드 사용법">
              <span><b>Scroll</b> skip</span>
              <span><b>Click</b> open PDF</span>
              <span><b>Double-click</b> ♡ heart</span>
              <span><b>♥+ ×2</b> superheart</span>
            </div>
            <div className="feed-tools">
              <div className="feed-filters" aria-label="피드 필터">
                {(["all", "unread", "heart", "superheart"] as FeedFilter[]).map((filter) => (
                  <button
                    className={feedFilter === filter ? "active" : ""}
                    key={filter}
                    onClick={() => setFeedFilter(filter)}
                  >
                    {filter === "all" ? "All" : filter === "unread" ? "Unread" : filter === "heart" ? "Hearts" : "Superhearts"}
                    {filter === "heart" && <span>{reviews.filter((review) => review.decision === "heart").length}</span>}
                    {filter === "superheart" && <span>{reviews.filter((review) => review.decision === "superheart").length}</span>}
                  </button>
                ))}
              </div>
              <div className="bookmark-status">
                {manualBookmarkId ? (
                  <><span>Manual bookmark</span><button onClick={() => setManualBookmarkId(null)}>Clear</button></>
                ) : autoBookmarkId ? (
                  <span>Auto bookmark saved</span>
                ) : (
                  <span>Auto bookmark ready</span>
                )}
              </div>
            </div>

            <div className="paper-feed" ref={feedRef} onScroll={handleFeedScroll}>
              {filteredQueue.length ? (
                filteredQueue.map((paper, index) => {
                  const status = statusByPaper.get(paper.id);
                  const isSelected = selectedPaper?.id === paper.id;
                  return (
                    <article
                      className={`feed-card ${isSelected ? "selected" : ""} ${status ?? ""} ${seenIds.has(paper.id) ? "seen" : ""} ${manualBookmarkId === paper.id ? "bookmarked" : ""}`}
                      key={paper.id}
                      data-paper-id={paper.id}
                    >
                      <button
                        className="feed-card-open"
                        onClick={() => handleSingleClick(paper)}
                        onDoubleClick={() => handleDoubleClick(paper)}
                        aria-label={`${paper.title}. 클릭하면 PDF 열기, 더블클릭하면 Heart`}
                      >
                        <div className="feed-rank">{String(index + 1).padStart(2, "0")}</div>
                        <div className="feed-card-body">
                          <div className="feed-card-topline">
                            <div className="paper-tags">
                              {paper.authorHit && <span className="author-priority">Tracked author</span>}
                              {paper.deepxiv ? <span className="featured-pill">DeepXiv #{paper.deepxiv.rank} · +5</span> : null}
                              {paper.citationSeedIds?.length ? (
                                <span className="citation-pill">
                                  Cites {paper.citationSeedIds.length} seed{paper.citationSeedIds.length > 1 ? "s" : ""}
                                </span>
                              ) : null}
                              <span className="score-pill">Score {paper.baseScore > 0 ? `+${paper.baseScore}` : paper.baseScore}</span>
                              {paper.categories.slice(0, 2).map((category) => <span key={category}>{category}</span>)}
                            </div>
                            <span>{formatDate(paper.publishedAt)}</span>
                          </div>
                          <h2>{paper.title}</h2>
                          <p className="feed-authors">
                            {paper.authors.slice(0, 3).join(", ")}{paper.authors.length > 3 ? ` +${paper.authors.length - 3}` : ""}
                          </p>
                          {paper.deepxiv ? (
                            <p className="featured-by">
                              {paper.deepxiv.mentions} mentions · {paper.deepxiv.likes.toLocaleString()} likes
                              {paper.deepxiv.mentionedBy.length
                                ? ` · ${paper.deepxiv.mentionedBy.slice(0, 3).map((account) => `@${account}`).join(", ")}`
                                : ""}
                            </p>
                          ) : null}
                          <p className="feed-abstract">{paper.abstract}</p>
                          <div className="score-reasons compact">
                            {paper.reasons.slice(0, 4).map((reason) => (
                              <span className={reason.kind} key={`${reason.kind}-${reason.label}`}>
                                {reason.value > 0 ? "+" : ""}{reason.value} {reason.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      </button>
                      <div className="feed-side-actions">
                        <div className={`feed-heart ${status ?? ""}`} aria-hidden="true">
                          {status === "superheart" ? "♥+" : status === "heart" ? "♥" : seenIds.has(paper.id) ? "✓" : "♡"}
                        </div>
                        <button
                          className="superheart-trigger"
                          onClick={(event) => {
                            event.stopPropagation();
                            setNotice("Superheart는 이 버튼을 한 번 더 클릭하세요.");
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            handleSuperheart(paper);
                          }}
                          aria-label={`${paper.title} Superheart. 더블클릭`}
                        >♥+ <small>2×</small></button>
                        <button
                          className={`bookmark-trigger ${manualBookmarkId === paper.id ? "active" : ""}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setManualBookmark(paper);
                          }}
                          aria-label={`${paper.title}에 수동 북마크`}
                        >▮</button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="feed-empty">이 필터에 해당하는 논문이 없습니다.</div>
              )}
            </div>
          </section>

          <aside className="paper-reader">
            {currentPaper ? (
              <>
                <div className="reader-details">
                  <div className="reader-title-copy">
                    <span>
                      {currentPaper.deepxiv ? `DeepXiv #${currentPaper.deepxiv.rank} · Featured +5 · ` : ""}
                      {currentPaper.categories[0]} · {currentPaper.id}
                    </span>
                    <h2>{currentPaper.title}</h2>
                    {currentPaper.deepxiv ? (
                      <div className="reader-featured-links">
                        <span>
                          7일간 {currentPaper.deepxiv.mentions} mentions · {currentPaper.deepxiv.likes.toLocaleString()} likes · {currentPaper.deepxiv.views.toLocaleString()} views
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="reader-actions">
                    <button
                      className={statusByPaper.get(currentPaper.id) === "heart" ? "active" : ""}
                      onClick={() => setNotice("Heart는 이 버튼을 더블클릭하세요.")}
                      onDoubleClick={() => togglePaper(currentPaper, "heart")}
                      aria-label="Heart로 저장. 더블클릭"
                    >♡ <small>2×</small></button>
                    <button
                      className={statusByPaper.get(currentPaper.id) === "superheart" ? "active super" : ""}
                      onClick={() => setNotice("Superheart는 이 버튼을 더블클릭하세요.")}
                      onDoubleClick={() => togglePaper(currentPaper, "superheart")}
                      aria-label="Superheart로 저장. 더블클릭"
                    >♥+ <small>2×</small></button>
                    {statusByPaper.has(currentPaper.id) && (
                      <button className="clear-status" onClick={() => removeSavedStatus(currentPaper.id)}>Clear</button>
                    )}
                  </div>
                </div>
                <div className="preview-header">
                  <div className="preview-tabs">
                    <button className="active" disabled>PDF</button>
                    {currentLocalPdfUrl ? <span className="local-pdf-badge">Saved locally</span> : null}
                  </div>
                  <div className="pdf-header-tools">
                    <div className="pdf-zoom-controls" aria-label="PDF 확대 및 축소">
                      <button
                        onClick={zoomPdfOut}
                        disabled={pdfZoom <= PDF_ZOOM_MIN}
                        aria-label="PDF 축소"
                      >
                        −
                      </button>
                      <span>{pdfZoom}%</span>
                      <button
                        onClick={zoomPdfIn}
                        disabled={pdfZoom >= PDF_ZOOM_MAX}
                        aria-label="PDF 확대"
                      >
                        +
                      </button>
                      <button
                        className={pdfZoom === 100 ? "active" : ""}
                        onClick={() => updatePdfZoom(100)}
                        aria-label="PDF 너비에 맞추기"
                      >
                        Fit
                      </button>
                    </div>
                    <span className="pdf-pinch-hint">trackpad pinch</span>
                    <div className="reader-links">
                      <a href={currentPaper.arxivUrl} target="_blank" rel="noreferrer">arXiv ↗</a>
                      {!currentLocalPdfUrl && (
                        <button onClick={() => void cachePdf(currentPaper)}>Save locally</button>
                      )}
                      <a href={currentPdfUrl} target="_blank" rel="noreferrer">Open PDF ↗</a>
                    </div>
                  </div>
                </div>
                <div className="pdf-frame-wrap">
                  {(pdfState === "loading" || pdfState === "downloading") && (
                    <div className="pdf-loading"><i /><span>{pdfState === "downloading" ? "PDF를 로컬에 저장하는 중" : "PDF를 가져오는 중"}</span></div>
                  )}
                  <PdfCanvasReader
                    key={pdfReaderUrl}
                    url={pdfReaderUrl}
                    title={currentPaper.title}
                    zoomPercent={pdfZoom}
                    onZoomChange={updatePdfZoom}
                    onReady={() => setPdfState("ready")}
                    onError={() => setPdfState("error")}
                  />
                </div>
              </>
            ) : (
              <div className="reader-welcome">
                <div className="reader-orbit"><span>♡</span></div>
                <p className="eyebrow">PAPER READER</p>
                <h2>피드에서 논문을 선택하세요</h2>
                <p>한 번 클릭하면 PDF를 열고,<br />카드를 더블클릭하면 Heart로 저장합니다.</p>
                <div className="reader-welcome-keys"><span>scroll → skip</span><span>double-click → heart</span></div>
              </div>
            )}
          </aside>
        </div>
      )}

      {view === "saved" && (
        <section className="content-page">
          <div className="page-title-row">
            <div>
              <p className="eyebrow">LIBRARY</p>
              <h1>선택한 논문</h1>
              <p>Heart와 Superheart 논문을 한곳에서 관리합니다.</p>
            </div>
            <button className="primary-button" onClick={() => void syncRepositoryCsv()} disabled={!savedReviews.length}>
              {companionStatus === "connected" ? "Sync choices CSV" : "CSV 다운로드"}
            </button>
          </div>
          {savedReviews.length ? (
            <div className="saved-list">
              {[...savedReviews].reverse().map((review) => (
                <article className="saved-row" key={`${review.paper.id}-${review.reviewedAt}`}>
                  <div className={`saved-decision ${review.decision}`}>{review.decision === "superheart" ? "♥+" : "♥"}</div>
                  <div className="saved-main">
                    <div className="saved-meta">
                      <span>{decisionLabel(review.decision)}</span> · Score {review.paper.baseScore} · {review.paper.categories[0]}
                      {review.paper.deepxiv ? ` · DeepXiv #${review.paper.deepxiv.rank} · Featured +5` : ""}
                    </div>
                    <h2>{review.paper.title}</h2>
                    <p>{review.paper.authors[0]} · {review.paper.authors.at(-1)}</p>
                  </div>
                  <div className="saved-actions">
                    <a href={review.paper.arxivUrl} target="_blank" rel="noreferrer">arXiv</a>
                    <a href={companionPdfUrl(downloads[review.paper.id]) ?? review.paper.pdfUrl} target="_blank" rel="noreferrer">
                      {downloads[review.paper.id] ? "Local PDF" : "PDF"}
                    </a>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="list-empty"><strong>아직 선택한 논문이 없어요.</strong><p>Daily 피드에서 논문을 클릭해 Heart로 저장해보세요.</p></div>
          )}
        </section>
      )}

      {view === "rules" && (
        <section className="content-page rules-page">
          <div className="page-title-row">
            <div>
              <p className="eyebrow">RANKING RULES</p>
              <h1>관심 신호</h1>
              <p>Author는 항상 먼저, 나머지는 점수순으로 하루 최대 250개를 보여줍니다.</p>
            </div>
            <button className="ghost-button" onClick={() => setRules(DEFAULT_RULES)}>기본값 복원</button>
          </div>
          <div className="formula-card">
            <div><span>Author</span><strong>absolute priority</strong></div>
            <b>→</b>
            <div><span>Cites seed paper</span><strong>custom weight each</strong></div>
            <b>+</b>
            <div><span>DeepXiv Top 50</span><strong>+5 once</strong></div>
            <b>+</b>
            <div><span>Positive keyword</span><strong>+2 each</strong></div>
            <b>−</b>
            <div><span>Negative keyword</span><strong>−2 each</strong></div>
          </div>
          <section className="featured-sources">
            <div>
              <p className="eyebrow">FEATURED SOURCES · +5</p>
              <h2>DeepXiv에서 주목받는 논문</h2>
              <p>최근 7일 소셜 신호 기준 Top 50에 포함되면 논문당 한 번만 +5를 적용합니다.</p>
            </div>
            <div className="featured-handles">
              <span>7 days</span><span>Top 50</span><span>social signals</span>
            </div>
            <span className={`x-connection ${deepxivSource}`}>
              {deepxivSource === "connected"
                ? `연결됨 · ${Object.keys(deepxivByPaper).length} papers`
                : deepxivSource === "loading"
                  ? "확인 중"
                  : "DeepXiv 확인 필요"}
            </span>
          </section>
          <div className="rules-grid">
            <TagsEditor label="Positive authors" hint="정확한 저자명 매칭 · 최우선 노출" values={rules.authors} onChange={(authors) => setRules({ ...rules, authors })} />
            <TagsEditor
              label="Positive keywords"
              hint="그룹당 +2 · alias는 | 로 연결"
              values={rules.positiveKeywords}
              supportsAliases
              placeholder="예: ttt | test-time training | test time training"
              onChange={(positiveKeywords) => setRules({ ...rules, positiveKeywords })}
            />
            <TagsEditor
              label="Negative keywords"
              hint="그룹당 −2 · alias는 | 로 연결"
              values={rules.negativeKeywords}
              supportsAliases
              placeholder="예: benchmark | evaluation benchmark"
              onChange={(negativeKeywords) => setRules({ ...rules, negativeKeywords })}
            />
          </div>
          <CitationSeedsEditor
            values={rules.citationSeeds}
            source={activeCitationSource}
            resolved={activeCitationResolved}
            onChange={(citationSeeds) => {
              const nextSeedKey = citationSeeds.map((seed) => seed.arxivId).sort().join(",");
              if (nextSeedKey !== citationSeedKey) {
                setCitationSource(citationSeeds.length ? "loading" : "idle");
                if (!citationSeeds.length) {
                  setCitationMatches({});
                  setCitationResolved(0);
                }
              }
              setRules({ ...rules, citationSeeds });
            }}
          />
          <div className="local-note">
            <span>{companionStatus === "connected" ? "Repository synced" : "Browser fallback"}</span>
            <p>
              규칙은 <code>config/rules.json</code>, 선택은 <code>choices/{new Date().getFullYear()}.csv</code>, PDF는 gitignore된 <code>.local/papers/</code>에 저장됩니다.
            </p>
          </div>
        </section>
      )}

      {notice && (
        <button className="toast" onClick={() => setNotice("")} aria-label="알림 닫기">{notice}<span>×</span></button>
      )}
    </main>
  );
}
