const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

// Ensure the data directory exists before opening the DB file.
const dataDir = path.dirname(path.resolve(config.DB_PATH));
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    domain TEXT NOT NULL UNIQUE,
    careers_url TEXT,
    discovered_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    job_title TEXT NOT NULL,
    job_url TEXT NOT NULL,
    contact_email TEXT,
    scraped_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON jobs(company_id);
`);

function getAllCompanies() {
  return db.prepare('SELECT * FROM companies ORDER BY discovered_at DESC').all();
}

function getCompanyByDomain(domain) {
  return db.prepare('SELECT * FROM companies WHERE domain = ?').get(domain);
}

function getCompanyById(id) {
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
}

function insertCompany({ name, domain, careers_url }) {
  const stmt = db.prepare(`
    INSERT INTO companies (name, domain, careers_url, discovered_at)
    VALUES (@name, @domain, @careers_url, @discovered_at)
  `);
  const info = stmt.run({
    name,
    domain,
    careers_url,
    discovered_at: new Date().toISOString(),
  });
  return info.lastInsertRowid;
}

function updateCompanyCareersUrl(id, careers_url) {
  db.prepare('UPDATE companies SET careers_url = ? WHERE id = ?').run(careers_url, id);
}

function clearJobsForCompany(companyId) {
  db.prepare('DELETE FROM jobs WHERE company_id = ?').run(companyId);
}

function insertJob({ company_id, job_title, job_url, contact_email }) {
  const stmt = db.prepare(`
    INSERT INTO jobs (company_id, job_title, job_url, contact_email, scraped_at)
    VALUES (@company_id, @job_title, @job_url, @contact_email, @scraped_at)
  `);
  stmt.run({
    company_id,
    job_title,
    job_url,
    contact_email: contact_email || null,
    scraped_at: new Date().toISOString(),
  });
}

// Aggregated view for the results table: one row per company that has at
// least one matched job, sorted by open position count descending.
function getAggregatedResults() {
  return db
    .prepare(
      `
      SELECT
        c.id AS company_id,
        c.name AS company_name,
        c.domain AS domain,
        c.careers_url AS careers_url,
        COUNT(j.id) AS job_count,
        GROUP_CONCAT(j.job_title, ' | ') AS job_titles,
        (
          SELECT contact_email FROM jobs
          WHERE company_id = c.id AND contact_email IS NOT NULL
          LIMIT 1
        ) AS contact_email,
        (
          SELECT job_url FROM jobs
          WHERE company_id = c.id
          ORDER BY id ASC
          LIMIT 1
        ) AS fallback_job_url
      FROM companies c
      JOIN jobs j ON j.company_id = c.id
      GROUP BY c.id
      ORDER BY job_count DESC, c.name ASC
    `
    )
    .all();
}

function clearAll() {
  db.exec('DELETE FROM jobs; DELETE FROM companies;');
}

module.exports = {
  db,
  getAllCompanies,
  getCompanyByDomain,
  getCompanyById,
  insertCompany,
  updateCompanyCareersUrl,
  clearJobsForCompany,
  insertJob,
  getAggregatedResults,
  clearAll,
};
