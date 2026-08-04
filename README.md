# HR-Pilot

Auto-discovers IT companies in Germany and tech startups, scrapes their job postings for open IT positions, and displays results in a server-rendered table with a live progress bar — all triggered on-demand via a button.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

   > `puppeteer` is listed as an *optional* dependency (used only as a fallback for JavaScript-rendered job detail pages). If its Chromium download fails or is slow, `npm install` will still succeed — the app runs fine without it, just with reduced email-extraction coverage on JS-heavy pages.

2. **Configure `.env`** (no API keys needed!)

   ```env
   PORT=3000
   DB_PATH=./data/hrpilot.db
   DISCOVERY_MODE=scrape
   ```

3. **Run**

   ```bash
   npm start
   ```

   Open <http://localhost:3000>.

## How it works

1. Click **▶ Run Scrape**.
2. **Company discovery (default: real web scraping, per spec)** — the backend first *compiles a URL list of candidate companies* by scraping Wikipedia's IT/tech company category pages (`src/companyUrlScraper.js`): it lists article titles via Wikipedia's public API, then scrapes each company's article page for its official website link (from the infobox). For each candidate URL, it then scrapes the company's own homepage to locate a careers/jobs page (`src/discoverFromCompanySites.js`), and scans that page for IT job matches against a configurable keyword list (`developer`, `devops`, `frontend`, `backend`, `full stack`, `software engineer`, `sysadmin`, `data engineer`, `QA`, `cloud`, etc.), capped at **100 companies** per run. New companies are stored in SQLite (`companies` table); already-known companies are skipped unless "Force refresh" is checked.
   > Set `DISCOVERY_MODE=arbeitnow` in `.env` to switch to the original fallback path, which pulls companies/jobs directly from the free, public [Arbeitnow Job Board API](https://arbeitnow.com/api/job-board-api) instead (`src/discovery.js`) — faster and with zero ToS/anti-bot risk, at the cost of not literally "compiling a URL list" first.
3. For each matched job, the job's detail page is visited (`axios` + `cheerio`, with an optional Puppeteer fallback for JS-rendered pages) and a contact email is extracted via regex (typically found at the end of the job description). If no email is found, the job URL itself is stored as an "Apply" link fallback. Requests respect a rate-limiting delay and basic `robots.txt` checking.
4. The frontend polls `/scrape-status` every 1.5s to render a live progress bar ("Scraping 34/100 companies...").
5. When done, the page reloads and shows the results table (aggregated per company, sorted by open IT position count descending), with a live search-by-name filter and sortable columns.

## Project structure

```
server.js                 Express app entry point
src/
  config.js               Env vars, DISCOVERY_MODE toggle, Arbeitnow API URL, keyword lists, tunables
  db.js                    SQLite access (better-sqlite3): companies & jobs tables
  progress.js              Shared in-memory progress tracker (EventEmitter)
  companyUrlScraper.js     Step 1: scrapes Wikipedia to compile a URL list of candidate companies
  discoverFromCompanySites.js  Steps 2-3: scrapes each company's site for its careers page + IT job matches
  discovery.js             Fallback: Arbeitnow API pagination + keyword filtering + company grouping
  scraper.js               axios+cheerio job-detail fetch, Puppeteer fallback, email regex
  routes/
    index.js               GET  /              -> renders results table
    scrape.js               POST /scrape        -> triggers pipeline
                             GET  /scrape-status -> polling endpoint
views/
  index.ejs                Server-rendered page (button, progress bar, table)
public/
  css/style.css
  js/app.js                Polling logic, search filter, column sort
data/
  hrpilot.db               SQLite database file (created automatically)
```

## Notes / limitations (hackathon scope)

- **Why Arbeitnow instead of scraping Indeed/LinkedIn/Glassdoor directly?** Those sites use aggressive anti-bot detection (CAPTCHAs, IP bans, login walls) and enforce ToS restrictions against scraping — LinkedIn in particular has pursued legal action against scrapers. Arbeitnow's API is public, free, and explicitly designed for programmatic consumption, so there's no blocking or legal risk.
- Robots.txt checking (for job detail pages) is basic and fails **open** (if `robots.txt` can't be fetched or parsed, the request is allowed) — good enough for a demo, not production-grade compliance.
- Puppeteer launch args include `--no-sandbox` for compatibility in constrained/CI environments; tighten this for any non-demo use.
- Progress state is in-memory and per-process — fine for a single-instance hackathon demo, not meant to survive a server restart mid-run.
- "Domain" in the `companies` table is a slugified company name (Arbeitnow doesn't always expose the company's real domain), used purely as a stable dedup key — not a literal DNS domain.
