const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');

// ---------------------------------------------------------------------------
// Step 1 of the spec: "compile a URL list of possible companies" — via
// actual web scraping (not a hardcoded list).
//
// Source: Wikipedia category pages for IT/tech companies. Wikipedia is a
// good scrape target here because:
//  - it's static HTML, no login/CAPTCHA/anti-bot walls
//  - it explicitly offers a public API for listing category members
//  - company articles almost always have an infobox with an official
//    "Website" link we can scrape out
// ---------------------------------------------------------------------------

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

// Categories to pull candidate companies from. Add/remove freely.
const SEED_CATEGORIES = [
  'Category:Software companies of Germany',
  'Category:Internet companies of Germany',
  'Category:Information technology companies of Germany',
  'Category:Technology companies of Germany',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Uses Wikipedia's public API (list=categorymembers) to get article titles
// belonging to a category — this is the "compile a list" step.
async function getCategoryMembers(category, limit) {
  const { data } = await axios.get(WIKIPEDIA_API, {
    params: {
      action: 'query',
      list: 'categorymembers',
      cmtitle: category,
      cmlimit: limit,
      cmnamespace: 0, // articles only, no subcategories
      format: 'json',
    },
    headers: { 'User-Agent': config.USER_AGENT },
    timeout: 10000,
  });
  const members = (data && data.query && data.query.categorymembers) || [];
  return members.map((m) => m.title);
}

// Scrapes a company's Wikipedia article HTML and pulls the official
// "Website" row out of the infobox.
async function getOfficialWebsiteFromWikipedia(title) {
  const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const { data: html } = await axios.get(pageUrl, {
    headers: { 'User-Agent': config.USER_AGENT },
    timeout: 10000,
  });
  const $ = cheerio.load(html);

  let website = null;
  $('.infobox tr').each((_, row) => {
    const label = $(row).find('th').text().trim().toLowerCase();
    if (label === 'website') {
      const href = $(row).find('a').attr('href');
      if (href) website = href;
    }
  });

  return website;
}

/**
 * Compiles a URL list of candidate companies by scraping Wikipedia category
 * pages for IT/tech companies, then scraping each company's Wikipedia
 * article for its official website link. Returns [{ name, url }, ...] with
 * de-duplicated entries and only companies whose website could be resolved.
 */
async function compileCompanyUrlList({ perCategoryLimit = 30, onProgress } = {}) {
  const seenTitles = new Set();
  const companies = [];

  for (const category of SEED_CATEGORIES) {
    let titles = [];
    try {
      titles = await getCategoryMembers(category, perCategoryLimit);
    } catch (err) {
      if (onProgress) onProgress(`Failed to list category "${category}": ${err.message}`);
      continue;
    }

    for (const title of titles) {
      if (seenTitles.has(title)) continue;
      seenTitles.add(title);

      let website = null;
      try {
        website = await getOfficialWebsiteFromWikipedia(title);
      } catch {
        website = null;
      }

      if (website) {
        companies.push({ name: title, url: website });
        if (onProgress) onProgress(`Found candidate company: ${title} -> ${website}`);
      }

      await sleep(250); // be polite to Wikipedia's servers
    }
  }

  return companies;
}

module.exports = {
  compileCompanyUrlList,
  // exported for testing / reuse
  getCategoryMembers,
  getOfficialWebsiteFromWikipedia,
};
