const axios = require('axios');
const config = require('./config');
const db = require('./db');
const progress = require('./progress');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugifyCompanyName(name) {
  const slug = (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug || 'unknown-company';
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary regexes so short/ambiguous keywords like "IT" or "QA" only
// match as standalone words (e.g. "IT Support"), not as substrings inside
// unrelated words like "Digital" or "Sicherheit" (both contain "it").
const JOB_KEYWORD_REGEXES = config.JOB_KEYWORDS.map(
  (kw) => new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i')
);

function matchesJobKeywords(text) {
  if (!text) return false;
  return JOB_KEYWORD_REGEXES.some((re) => re.test(text));
}

async function fetchArbeitnowPage(page) {
  const { data } = await axios.get(config.ARBEITNOW_API_URL, {
    params: { page },
    timeout: 10000,
    headers: { 'User-Agent': config.USER_AGENT },
  });
  return data; // shape: { data: [...jobs], links: {...}, meta: {...} }
}

/**
 * Discovers IT/tech companies by pulling job postings from the free, public
 * Arbeitnow Job Board API (no key, no ToS risk — unlike scraping
 * Indeed/LinkedIn/Glassdoor directly), filtering by our keyword list, and
 * grouping matched postings by company. New companies are persisted to
 * SQLite (skipped if already known, unless forceRefresh is set). Returns up
 * to MAX_COMPANIES companies, each with the raw job postings (title + url)
 * discovered for it, ready for the scraper's email-enrichment step.
 */
async function discoverCompanies({ forceRefresh = false } = {}) {
  progress.update({
    step: 'discovering',
    message: 'Discovering IT/tech job postings via the Arbeitnow public job board API...',
  });

  const companiesMap = new Map(); // slug -> { name, jobs: [{ title, url }] }
  let page = 1;

  while (page <= config.MAX_ARBEITNOW_PAGES && companiesMap.size < config.MAX_COMPANIES) {
    let payload;
    try {
      payload = await fetchArbeitnowPage(page);
    } catch (err) {
      progress.update({ message: `Arbeitnow API error on page ${page}: ${err.message}` });
      break;
    }

    const jobs = (payload && payload.data) || [];
    if (!jobs.length) break; // no more pages

    for (const job of jobs) {
      const title = job.title || '';
      const tags = Array.isArray(job.tags) ? job.tags.join(' ') : '';
      if (!matchesJobKeywords(`${title} ${tags}`)) continue;

      const companyName = (job.company_name || 'Unknown Company').trim();
      const slug = slugifyCompanyName(companyName);

      if (!companiesMap.has(slug)) {
        if (companiesMap.size >= config.MAX_COMPANIES) continue; // cap reached
        companiesMap.set(slug, { name: companyName, jobs: [] });
      }

      companiesMap.get(slug).jobs.push({ title, url: job.url });
    }

    progress.update({
      message: `Scanned page ${page} — ${companiesMap.size} matching companies found so far...`,
    });

    page += 1;
    await sleep(200); // be nice to the public API
  }

  progress.update({
    message: `Found ${companiesMap.size} companies with matching IT job postings. Saving to database...`,
  });

  const companiesToScrape = [];

  for (const [slug, entry] of companiesMap) {
    const careersUrl = (entry.jobs[0] && entry.jobs[0].url) || null;
    const existing = db.getCompanyByDomain(slug);

    let companyRecord;
    let skipScrape = false;
    if (existing && !forceRefresh) {
      // Per spec: skip re-discovering AND re-scraping companies already
      // known; their previously scraped jobs stay as-is in the DB.
      companyRecord = existing;
      skipScrape = true;
    } else if (existing && forceRefresh) {
      db.updateCompanyCareersUrl(existing.id, careersUrl);
      companyRecord = { ...existing, careers_url: careersUrl };
    } else {
      const id = db.insertCompany({ name: entry.name, domain: slug, careers_url: careersUrl });
      companyRecord = { id, name: entry.name, domain: slug, careers_url: careersUrl };
    }

    if (skipScrape) continue;

    companiesToScrape.push({ ...companyRecord, jobs: entry.jobs });
  }

  return companiesToScrape.slice(0, config.MAX_COMPANIES);
}

module.exports = {
  discoverCompanies,
  // exported for testing / reuse
  slugifyCompanyName,
  matchesJobKeywords,
};
