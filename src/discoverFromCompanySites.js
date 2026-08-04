const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');
const db = require('./db');
const progress = require('./progress');
const { compileCompanyUrlList } = require('./companyUrlScraper');
const { matchesJobKeywords, slugifyCompanyName } = require('./discovery');

// ---------------------------------------------------------------------------
// Steps 2+3 of the spec: given a compiled URL list of companies (step 1,
// companyUrlScraper.js), scrape each company's own site to find its
// careers/jobs page, then scan that page for open IT positions. Job entries
// produced here have the same { title, url } shape discovery.js produces,
// so scraper.js's existing enrichCompanyJobs()/scrapeAllCompanies() can be
// reused unmodified for the contact-email extraction step.
// ---------------------------------------------------------------------------

const CAREER_LINK_KEYWORDS = [
  'career', 'careers', 'jobs', 'job openings', 'karriere', 'stellen',
  'stellenangebote', 'join us', 'we are hiring', 'vacatures', 'openings',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const { data } = await axios.get(url, {
    timeout: 12000,
    maxRedirects: 5,
    headers: { 'User-Agent': config.USER_AGENT },
    validateStatus: (s) => s < 500,
  });
  return typeof data === 'string' ? data : String(data || '');
}

// Given a company homepage, try to locate its careers/jobs page by looking
// for an anchor whose href or link text mentions a careers-related keyword.
// Falls back to the homepage itself if nothing is found.
async function findCareersPage(homepageUrl) {
  let html;
  try {
    html = await fetchHtml(homepageUrl);
  } catch {
    return homepageUrl;
  }

  const $ = cheerio.load(html);
  let found = null;

  $('a[href]').each((_, el) => {
    if (found) return;
    const href = $(el).attr('href') || '';
    const text = $(el).text().toLowerCase();
    const haystack = `${href.toLowerCase()} ${text}`;
    if (CAREER_LINK_KEYWORDS.some((kw) => haystack.includes(kw))) {
      try {
        found = new URL(href, homepageUrl).toString();
      } catch {
        // ignore malformed hrefs (mailto:, javascript:, etc.)
      }
    }
  });

  return found || homepageUrl;
}

// Scans a careers page for IT-keyword matches and collects any job posting
// links found on it (reusing the same JOB_KEYWORDS filter as discovery.js).
async function scanCareersPageForItJobs(careersUrl) {
  const html = await fetchHtml(careersUrl);
  const $ = cheerio.load(html);
  const pageText = $('body').text();

  if (!matchesJobKeywords(pageText)) return [];

  const jobs = [];
  const seenUrls = new Set();

  $('a[href]').each((_, el) => {
    const title = $(el).text().trim();
    const href = $(el).attr('href');
    if (!title || !href) return;
    if (!matchesJobKeywords(title)) return;

    let jobUrl;
    try {
      jobUrl = new URL(href, careersUrl).toString();
    } catch {
      return;
    }
    if (seenUrls.has(jobUrl)) return;
    seenUrls.add(jobUrl);
    jobs.push({ title, url: jobUrl });
  });

  // Whole page matched the keywords but no individual job links were
  // distinguishable (e.g. an SPA job board) — keep the careers page itself
  // as a single generic opening so it still shows up in results.
  if (!jobs.length) {
    jobs.push({ title: 'Open IT position (see careers page)', url: careersUrl });
  }

  return jobs;
}

/**
 * Full discovery pipeline via web scraping (per spec):
 *  1. compileCompanyUrlList() scrapes Wikipedia to build a URL list of
 *     candidate companies.
 *  2. For each candidate, scrape its homepage to find the careers page.
 *  3. Scrape the careers page for IT-position matches.
 * Returns companies ready for scraper.js's enrichCompanyJobs() (email
 * extraction), same shape as discovery.discoverCompanies().
 */
async function discoverCompaniesViaScraping({ forceRefresh = false } = {}) {
  progress.update({
    step: 'discovering',
    message: 'Compiling company URL list from Wikipedia...',
  });

  const candidates = await compileCompanyUrlList({
    onProgress: (msg) => progress.update({ message: msg }),
  });

  progress.update({
    message: `Compiled ${candidates.length} candidate company URLs. Scanning career pages...`,
  });

  const companiesToScrape = [];

  for (const candidate of candidates) {
    if (companiesToScrape.length >= config.MAX_COMPANIES) break;

    const slug = slugifyCompanyName(candidate.name);
    const existing = db.getCompanyByDomain(slug);
    if (existing && !forceRefresh) continue; // already known, skip per spec

    progress.update({ message: `Scanning ${candidate.name} (${candidate.url})...` });

    let careersUrl;
    let jobs;
    try {
      careersUrl = await findCareersPage(candidate.url);
      jobs = await scanCareersPageForItJobs(careersUrl);
    } catch (err) {
      progress.update({ message: `Skipping ${candidate.name}: ${err.message}` });
      continue;
    }

    if (!jobs.length) continue; // no matching IT openings found on this site

    let companyRecord;
    if (existing) {
      db.updateCompanyCareersUrl(existing.id, careersUrl);
      companyRecord = { ...existing, careers_url: careersUrl };
    } else {
      const id = db.insertCompany({ name: candidate.name, domain: slug, careers_url: careersUrl });
      companyRecord = { id, name: candidate.name, domain: slug, careers_url: careersUrl };
    }

    companiesToScrape.push({ ...companyRecord, jobs });
    await sleep(config.REQUEST_DELAY_MS);
  }

  return companiesToScrape;
}

module.exports = {
  discoverCompaniesViaScraping,
  // exported for testing / reuse
  findCareersPage,
  scanCareersPageForItJobs,
};
