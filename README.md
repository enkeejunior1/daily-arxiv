# Daily arXiv

A local-first, mode-seeking paper feed for machine learning, language, and vision research.

## Current MVP

- Reads up to 500 papers from the current arXiv feeds for `cs.LG`, `stat.ML`, `cs.CL`, `cs.CV`, `cs.AI`, and `cs.NE`.
- Gives tracked authors absolute priority.
- Adds a configurable score when a new paper cites one of your tracked arXiv seed papers, using Semantic Scholar's citation graph.
- Adds `Featured +5` to papers in DeepXiv's recent 7-day Trending Top 50.
- Scores every positive keyword once at `+2` and every negative keyword once at `-2` across the title and abstract.
- Supports keyword alias groups separated by `|`; matching any number of aliases in one group applies that group's score only once.
- Shows up to 250 papers, ordered by score with a stable daily shuffle for ties.
- Uses a two-pane feed: scroll to skip, click to open the PDF, double-click a card for Heart, and double-click `♥+` for Superheart.
- Renders papers with Mozilla PDF.js so trackpad pinch zooms only the PDF under the pointer, while the feed and app chrome stay fixed.
- Retries temporary arXiv failures through a fallback host and offers an in-reader Retry action when a PDF still cannot load.
- Installs as an Android PWA, opens the PDF reader as a mobile full-screen sheet, and supports two-finger PDF pinch zoom.
- Syncs rules, Heart/Superheart choices, and automatic/manual bookmarks across signed-in devices with Cloudflare D1.
- Adds an optional 200-character note beside the PDF and syncs it across devices without automatically selecting the paper.
- Adds a Mac-local Codex paper guide beside the PDF, with a Korean method-focused prompt and a per-paper cached response under `.local/ai/`.
- Downloads a selected PDF to Android's browser-managed Downloads area with a `date_title.pdf` filename.
- Restores automatic and manual bookmarks when the app reopens.
- Saves rules to `config/rules.json` and selected papers to a yearly CSV under `choices/`.
- Caches Heart and Superheart PDFs under the gitignored `.local/papers/YYYY-MM-DD/` directory.
- Falls back to browser storage and CSV download if the local companion is unavailable.

## Run locally

```bash
npm run dev
```

This starts both the web UI and the local companion. The companion only listens on `127.0.0.1` and provides repository file storage, the PDF cache, and the Codex paper guide. The AI button uses the Codex login already available on the Mac, extracts text from the PDF, and stores the response under `.local/ai/`; it does not require an OpenAI API key. DeepXiv's public trending endpoint does not require a token.

Citation matching uses Semantic Scholar's public Academic Graph API. It works without authentication when shared capacity is available. For reliable use, copy `.env.example` to `.env.local`, add a free `SEMANTIC_SCHOLAR_API_KEY`, and restart the app.

## Android

Open the deployed HTTPS URL in Chrome and choose **Install app** (or **Add to Home screen**). Sign in with the same account on each device to share rules, choices, and bookmarks. On touch screens, tap `♡` or `♥+` directly; tapping a paper opens a full-screen PDF reader, where a two-finger pinch changes only the PDF zoom.

Android browsers choose the physical download directory. `Download PDF` saves to the browser-managed Downloads area; the Mac companion continues to cache selected PDFs under the gitignored `.local/papers/` directory.

## Recommended daily workflow

1. Set tracked authors and keyword groups in **Rules**. Treat Rules as a filter profile: tune it when your interests change, not every day.
2. Spend 15–25 minutes in **Daily**. Scroll past irrelevant papers, and open the PDF only when the title or abstract is promising. The automatic bookmark remembers how far you got.
3. Use **Heart** for papers worth reading later and **Superheart** for the 1–3 papers you intend to read first. Selecting the same action again removes it.
4. Finish in **Saved**, not in the full feed. This is the short reading queue that should lead to downloading, reading, or removing a paper.

Android is best for lightweight triage while away from the desk. The hosted app syncs Rules, decisions, and bookmarks between devices signed in with the same account. PDF files are device-local: Android downloads them to browser-managed storage.

Mac is best for durable repository output. Run `npm run dev` from this repository; the local companion mirrors the current snapshot to `config/rules.json`, `choices/YYYY.csv`, the README table, and the gitignored `.local/papers/` cache. Those GitHub-facing files are only published after you commit and push them.

The same quick explanation is available in the app's **Guide** tab.

## Repository data

The files intended for GitHub are:

- `config/rules.json`: tracked authors, positive/negative keywords, and citation seed papers with their weights.
- Keyword alias example: `"ttt | test-time training | test time training"` is one `+2` group.
- Citation seed example: `{ "arxivId": "1706.03762", "weight": 10 }` adds `+10` to a paper that cites that seed.
- `choices/YYYY.csv`: Heart and Superheart choices, regenerated for the current day whenever state changes.
- The Recent choices table below, generated from the same CSV.

Progress, downloaded PDFs, extracted paper text, and Codex paper guides stay local under `.local/` and are excluded by `.gitignore`.
The deployed app stores the shared rules, choices, and bookmark snapshot in D1. Local PDF paths are deliberately excluded from cloud sync because they are device-specific.

The CSV schema is:

```text
date,decision,arxiv_id,arxiv_link,title,first_author,last_author,score,note,selected_at
```

## Recent choices

<!-- DAILY_ARXIV_CHOICES_START -->
No published choices yet.
<!-- DAILY_ARXIV_CHOICES_END -->
