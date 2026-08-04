const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');
const progress = require('./progress');
const db = require('./db');

// robots-parser is a required dependency, but guard it anyway so a bad
// install never crashes the whole scrape run.
let robotsParserFactory;
try {
  // eslint-disable-next-line global-require
  robotsParserFactory = require('robots-parser');
} catch {
  robotsParserFactory = null;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const robotsCache = new Map(); // origin -> parser | null

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// robots.txt (basic checking, fail-open for hackathon purposes)
// ---------------------------------------------------------------------------
async function isAllowedByRobots(url) {
  try {
    const { origin } = new URL(url);

    if (!robotsCache.has(origin)) {
      let robotsTxt = '';
      try {
        const res = await axios.get(`${origin}/robots.txt`, {
          timeout: 5000,
          headers: { 'User-Agent': config.USER_AGENT },
          validateStatus: (s) => s < 500,
        });
        robotsTxt = typeof res.data === 'string' ? res.data : '';
      } catch {
        robotsTxt = ''; // no robots.txt / unreachable -> treat as allowed
      }

      const parser = robotsParserFactory ? robotsParserFactory(`${origin}/robots.txt`, robotsTxt) : null;
      robotsCache.set(origin, parser);
    }

    const parser = robotsCache.get(origin);
    if (!parser) return true;
    return parser.isAllowed(url, config.USER_AGENT) !== false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Fetching: axios+cheerio first, Puppeteer as a lazy, optional fallback for
// JavaScript-rendered job detail pages.
// ---------------------------------------------------------------------------
async function fetchStaticHtml(url) {
  const res = await axios.get(url, {
    timeout: 12000,
    maxRedirects: 5,
    headers: { 'User-Agent': config.USER_AGENT },
    validateStatus: (s) => s < 500,
  });
  return typeof res.data === 'string' ? res.data : String(res.data || '');
}

function htmlLooksEmpty(html) {
  if (!html) return true;
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return text.length < 200; // heuristic: likely an un-rendered JS app shell
}

let puppeteerLoadAttempted = false;
let puppeteerModule = null;

function loadPuppeteer() {
  if (puppeteerLoadAttempted) return puppeteerModule;
  puppeteerLoadAttempted = true;
  try {
    // eslint-disable-next-line global-require
    puppeteerModule = require('puppeteer');
  } catch {
    puppeteerModule = null;
    console.warn(
      '[scraper] Puppeteer not installed — JS-rendered fallback disabled. ' +
        'Static-HTML scraping will still work. Run "npm install puppeteer" to enable it.'
    );
  }
  return puppeteerModule;
}

async function fetchWithPuppeteerFallback(url) {
  const puppeteer = loadPuppeteer();
  if (!puppeteer) return null;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(config.USER_AGENT);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    return await page.content();
  } catch (err) {
    console.warn(`[scraper] Puppeteer fallback failed for ${url}: ${err.message}`);
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function getRenderedHtml(url) {
  let html = '';
  try {
    html = await fetchStaticHtml(url);
  } catch {
    html = '';
  }

  if (htmlLooksEmpty(html)) {
    const rendered = await fetchWithPuppeteerFallback(url);
    if (rendered) html = rendered;
  }

  return html;
}

// ---------------------------------------------------------------------------
// Contact email extraction from job detail pages
// ---------------------------------------------------------------------------
function extractEmailFromText(text) {
  if (!text) return null;
  const matches = text.match(EMAIL_REGEX);
  if (!matches || !matches.length) return null;
  // Contact emails are typically at the end of the job description
  // (e.g. "Send your application to jobs@company.com").
  return matches[matches.length - 1];
}

async function scrapeJobDetailForEmail(jobUrl) {
  try {
    const allowed = await isAllowedByRobots(jobUrl);
    if (!allowed) return null;

    const html = await getRenderedHtml(jobUrl);
    if (!html) return null;

    const $ = cheerio.load(html);
    return extractEmailFromText($('body').text());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-company job enrichment: jobs (title + url) were already discovered via
// the Arbeitnow API. For each job we visit its detail page to try to extract
// a contact email; if none is found, the job posting URL itself is kept as
// an "Apply" link fallback.
// ---------------------------------------------------------------------------
async function enrichCompanyJobs(company) {
  const enrichedJobs = [];

  for (const job of company.jobs || []) {
    const email = await scrapeJobDetailForEmail(job.url);
    enrichedJobs.push({ title: job.title, url: job.url, contactEmail: email || null });
    await sleep(config.REQUEST_DELAY_MS);
  }

  return enrichedJobs;
}

async function scrapeAllCompanies(companies) {
  const total = companies.length;

  for (let i = 0; i < total; i += 1) {
    const company = companies[i];
    progress.update({
      step: 'scraping',
      current: i + 1,
      total,
      message: `Scraping ${i + 1}/${total} companies: ${company.name}`,
    });

    try {
      const jobs = await enrichCompanyJobs(company);
      db.clearJobsForCompany(company.id);
      for (const job of jobs) {
        db.insertJob({
          company_id: company.id,
          job_title: job.title,
          job_url: job.url,
          contact_email: job.contactEmail,
        });
      }
    } catch (err) {
      progress.update({ message: `Error scraping ${company.name}: ${err.message}` });
    }
  }
}

module.exports = {
  scrapeAllCompanies,
  enrichCompanyJobs,
  // exported for testing / reuse
  extractEmailFromText,
};
