# Daily arXiv

A local-first, mode-seeking paper feed for machine learning, language, and vision research.

## Current MVP

- Reads the latest 100, 500, or 1,000 papers for `cs.LG`, `stat.ML`, `cs.CL`, `cs.CV`, `cs.AI`, and `cs.NE`. `1d` means the latest available arXiv announcement day, while `7d` and `30d` use rolling windows.
- Gives tracked authors absolute priority.
- Adds a configurable score when a new paper cites one of your tracked arXiv seed papers, using Semantic Scholar's citation graph.
- Adds `Featured +5` to papers in DeepXiv's recent 7-day Trending Top 50.
- Adds `Tracked X +5` once when `@fly51fly`, `@che_shr_cat`, or `@rosinality` has shared the paper, using a durable GitHub archive rather than a live browser scrape.
- Scores every positive keyword once at `+2` and every negative keyword once at `-2` across the title and abstract.
- Supports keyword alias groups separated by `|`; matching any number of aliases in one group applies that group's score only once.
- Shows matching papers up to the selected candidate limit, ordered by score with a stable daily shuffle for ties.
- Uses a two-pane feed: scroll to skip, click to open the PDF, double-click a card for Heart, and double-click `♥+` for Superheart.
- Renders papers with Mozilla PDF.js so trackpad pinch zooms only the PDF under the pointer, while the feed and app chrome stay fixed.
- Retries temporary arXiv failures through a fallback host and offers an in-reader Retry action when a PDF still cannot load.
- Installs as an Android PWA, opens the PDF reader as a mobile full-screen sheet, and supports two-finger PDF pinch zoom.
- Syncs rules, Heart/Superheart choices, automatic/manual bookmarks, and feed/library display preferences across signed-in devices with Cloudflare D1.
- Sorts Saved papers by the Heart date or arXiv date and limits the visible library to 10, 25, 50, 100, or all papers.
- Adds an optional 200-character note beside the PDF and syncs it across devices without automatically selecting the paper.
- Adds a Mac-local Codex paper guide beside the PDF, with a Korean method-focused prompt, automatic helper startup from the hosted AI button, and a per-paper cached response under `.local/ai/`.
- Downloads a selected PDF to Android's browser-managed Downloads area with a `date_title.pdf` filename.
- Restores automatic and manual bookmarks when the app reopens.
- Saves rules to `config/rules.json` and selected papers to a yearly CSV under `choices/`.
- Caches Heart and Superheart PDFs under the gitignored `.local/papers/YYYY-MM-DD/` directory.
- Falls back to browser storage and CSV download if the local companion is unavailable.

## Run locally

```bash
npm run dev
```

This starts both the web UI and the local companion. The companion only listens on `127.0.0.1` and provides repository file storage, the PDF cache, and the Codex paper guide. It accepts browser requests only from localhost or this app's exact deployed origin. The AI button uses the Codex login already available on the Mac, extracts text from the PDF, and stores the response under `.local/ai/`; it does not require an OpenAI API key. DeepXiv's public trending endpoint does not require a token.

For one-click Mac startup, double-click `Daily arXiv.app` in Finder. It registers the hidden `Daily arXiv Helper.app`, starts the same web UI and companion in the background, waits until both are ready, and opens `http://localhost:3000/`. Clicking it again only reopens the browser instead of starting a duplicate server. After that one-time registration, pressing **AI** on the deployed site wakes the helper, waits for the companion, and continues the selected paper analysis automatically. Safari may ask permission to open Daily arXiv Helper the first time. Keep both app bundles in this repository; you can drag the main app to the Dock without moving it. Runtime logs and the managed process ID stay under `.local/`. Run `npm run stop` when you want to stop the background server.

Citation matching uses Semantic Scholar's public Academic Graph API. It works without authentication when shared capacity is available. For reliable use, copy `.env.example` to `.env.local`, add a free `SEMANTIC_SCHOLAR_API_KEY`, and restart the app.

## Tracked X archive

The official X API collector runs in GitHub Actions once per day. It searches only the configured accounts and arXiv-related URL domains, follows expanded and quoted-post URLs, normalizes arXiv versions to one paper ID, and appends unique `(X post, arXiv paper)` pairs to `data/x-shares.csv`. The app reads the compact `data/x-featured.json` index and adds `+5` once per paper even if more than one tracked account shared it.

1. Create an X developer app with pay-per-use credits and copy its Bearer Token.
2. In the GitHub repository, open **Settings → Secrets and variables → Actions** and create the secret `X_BEARER_TOKEN`.
3. Open **Actions → Sync tracked X arXiv shares → Run workflow** and run `recent` once.
4. For history, run `backfill` with a bounded date regime such as `2025-01-01` through `2025-04-01`. The default cap is 2,000 X posts per run; if a regime is incomplete, running the same dates again resumes from its saved cursor.

The scheduled workflow uses Recent Search plus `since_id`, so after the first run it pays only for newly returned matching posts. Backfill uses Full-archive Search and is never scheduled automatically. Edit `config/x-sources.json` to change tracked accounts, the `+5` weight, or supported arXiv-link domains. The token is never committed or sent to the browser.

## Android

Open the deployed HTTPS URL in Chrome and choose **Install app** (or **Add to Home screen**). Sign in with the same account on each device to share rules, choices, and bookmarks. On touch screens, tap `♡` or `♥+` directly; tapping a paper opens a full-screen PDF reader, where a two-finger pinch changes only the PDF zoom.

Android browsers choose the physical download directory. `Download PDF` saves to the browser-managed Downloads area; the Mac companion continues to cache selected PDFs under the gitignored `.local/papers/` directory.

## Recommended daily workflow

1. Set tracked authors and keyword groups in **Rules**. Treat Rules as a filter profile: tune it when your interests change, not every day.
2. Choose a 1-, 7-, or 30-day window and a 100/500/1,000-paper candidate pool in **Daily**. Scroll past irrelevant papers, and open the PDF only when the title or abstract is promising. The automatic bookmark remembers how far you got.
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
- `data/x-shares.csv`: append-only normalized arXiv shares from tracked X accounts.
- `data/x-featured.json`: compact paper-to-X-signal index consumed by the app.
- `data/x-sync-state.json`: recent-search and bounded-backfill cursors, allowing idempotent resume.
- The Recent choices table below, generated from the same CSV.

Progress, downloaded PDFs, extracted paper text, and Codex paper guides stay local under `.local/` and are excluded by `.gitignore`.
The deployed app stores the shared rules, choices, and bookmark snapshot in D1. Local PDF paths are deliberately excluded from cloud sync because they are device-specific.

The CSV schema is:

```text
date,decision,arxiv_id,arxiv_link,title,first_author,last_author,score,note,selected_at
```

## Recent choices

<!-- DAILY_ARXIV_CHOICES_START -->
| Date | Pick | Paper | Authors | Note |
| --- | --- | --- | --- | --- |
| 2026-08-13 | ♥ | [How Can Driving World Models Do Counterfactual Prediction?](https://arxiv.org/abs/2608.11601) | Jiaru Zhang · Ziran Wang |  |
| 2026-08-13 | ♥ | [Small-Scale Experiments: Are We There Yet?](https://arxiv.org/abs/2608.11859) | Nicholas Lourie · Sanae Lotfi |  |
<!-- DAILY_ARXIV_CHOICES_END -->
