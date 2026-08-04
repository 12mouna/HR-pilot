require('dotenv').config();

module.exports = {
  PORT: Number(process.env.PORT) || 3000,

  DB_PATH: process.env.DB_PATH || './data/hrpilot.db',

  // Hard cap requested by spec: never discover/scrape more than this many
  // companies in a single run. Lowered from 100 -> 20 to keep scrape runs
  // fast (each company involves homepage + careers page + per-job detail
  // page requests, which adds up quickly).
  MAX_COMPANIES: 20,

  // 'scrape'    -> compile a company URL list via Wikipedia + scrape each
  //                company's own careers page (per original spec).
  // 'arbeitnow' -> pull companies/jobs directly from the Arbeitnow API
  //                (faster, no ToS risk, used as a pragmatic fallback).
  DISCOVERY_MODE: process.env.DISCOVERY_MODE || 'scrape',

  // Politeness delay between outbound HTTP requests (ms).
  REQUEST_DELAY_MS: 500,

  USER_AGENT: 'HR-Pilot-Bot/1.0 (+hackathon-demo; contact: demo@hr-pilot.local)',

  // Public, free, key-free job board API — no ToS/scraping risk, no billing.
  // https://arbeitnow.com/api/job-board-api
  ARBEITNOW_API_URL: 'https://www.arbeitnow.com/api/job-board-api',

  // Safety cap on how many Arbeitnow result pages we'll page through while
  // looking for MAX_COMPANIES distinct matching companies. The dataset
  // currently spans roughly ~25-35 pages; the loop stops early once a page
  // returns zero jobs, so this is just an upper safety bound.
  MAX_ARBEITNOW_PAGES: 35,

  // Keyword filter applied to job titles / tags.
  JOB_KEYWORDS: [
    'IT',
    'developer',
    'devops',
    'frontend',
    'backend',
    'full stack',
    'software engineer',
    'web developer',
    'sysadmin',
    'data engineer',
    'QA',
    'cloud',
  ],
};
