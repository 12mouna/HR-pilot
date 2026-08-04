const express = require('express');
const router = express.Router();
const db = require('../db');

// Home page: renders the results table (server-rendered) with the current
// aggregated scrape results, sorted by open IT position count descending.
router.get('/', (req, res) => {
  const results = db.getAggregatedResults();
  res.render('index', { results });
});

module.exports = router;
