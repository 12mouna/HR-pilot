const express = require('express');
const router = express.Router();
const config = require('../config');
const progress = require('../progress');
const { discoverCompanies } = require('../discovery');
const { discoverCompaniesViaScraping } = require('../discoverFromCompanySites');
const { scrapeAllCompanies } = require('../scraper');

// Kicks off the full discovery + scraping pipeline in the background and
// returns immediately so the frontend can start polling /scrape-status.
router.post('/scrape', async (req, res) => {
  if (progress.getState().running) {
    return res.status(409).json({ error: 'A scrape is already running.' });
  }

  const forceRefresh = req.body?.forceRefresh === true || req.query.forceRefresh === 'true';

  res.json({ started: true });

  progress.start();
  try {
    const useScraping = config.DISCOVERY_MODE !== 'arbeitnow';
    progress.update({
      step: 'discovering',
      message: useScraping
        ? 'Discovering companies by compiling a URL list and scraping career pages...'
        : 'Discovering companies via the Arbeitnow job board API...',
    });
    const companies = useScraping
      ? await discoverCompaniesViaScraping({ forceRefresh })
      : await discoverCompanies({ forceRefresh });

    progress.update({
      step: 'scraping',
      current: 0,
      total: companies.length,
      message: `Starting scrape of ${companies.length} companies...`,
    });
    await scrapeAllCompanies(companies);

    progress.finish(`Done! Scraped ${companies.length} companies.`);
  } catch (err) {
    progress.fail(err);
  }
});

// Polled by the frontend to render/update the live progress bar.
router.get('/scrape-status', (req, res) => {
  res.json(progress.getState());
});

module.exports = router;
