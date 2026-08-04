const express = require('express');
const path = require('path');
const config = require('./src/config');

// Initializing the DB module ensures tables exist before any request comes in.
require('./src/db');

const indexRoutes = require('./src/routes/index');
const scrapeRoutes = require('./src/routes/scrape');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRoutes);
app.use('/', scrapeRoutes);

app.listen(config.PORT, () => {
  console.log(`\n🚀 HR-Pilot running at http://localhost:${config.PORT}\n`);
});
