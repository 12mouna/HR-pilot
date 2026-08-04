const runBtn = document.getElementById('runScrapeBtn');
const forceRefreshCheckbox = document.getElementById('forceRefresh');
const progressContainer = document.getElementById('progressContainer');
const progressBarFill = document.getElementById('progressBarFill');
const progressMessage = document.getElementById('progressMessage');
const searchInput = document.getElementById('searchInput');
const resultsBody = document.getElementById('resultsBody');

let pollIntervalId = null;

runBtn.addEventListener('click', startScrape);

async function startScrape() {
  runBtn.disabled = true;
  progressContainer.classList.remove('hidden');
  progressBarFill.style.width = '0%';
  progressMessage.textContent = 'Starting...';

  try {
    const res = await fetch('/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceRefresh: forceRefreshCheckbox.checked }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
  } catch (err) {
    progressMessage.textContent = `Failed to start scrape: ${err.message}`;
    runBtn.disabled = false;
    return;
  }

  pollIntervalId = setInterval(pollStatus, 1500);
}

async function pollStatus() {
  try {
    const res = await fetch('/scrape-status');
    const state = await res.json();
    updateProgressUI(state);

    if (!state.running && (state.step === 'done' || state.step === 'error')) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
      runBtn.disabled = false;

      if (state.step === 'done') {
        // Reload to pull the freshly aggregated results from the server.
        window.location.reload();
      }
    }
  } catch (err) {
    console.error('Polling error:', err);
  }
}

function updateProgressUI(state) {
  let pct = 0;
  if (state.total > 0) {
    pct = Math.round((state.current / state.total) * 100);
  } else if (state.step === 'discovering' || state.step === 'starting') {
    pct = 10;
  } else if (state.step === 'done') {
    pct = 100;
  }

  progressBarFill.style.width = `${pct}%`;

  const suffix = state.total > 0 ? ` (${state.current}/${state.total} companies)` : '';
  progressMessage.textContent = `${state.message}${suffix}`;
}

// --- Search / filter by company name -------------------------------------
searchInput.addEventListener('input', () => {
  const term = searchInput.value.trim().toLowerCase();
  document.querySelectorAll('#resultsBody tr[data-company]').forEach((row) => {
    row.style.display = row.dataset.company.includes(term) ? '' : 'none';
  });
});

// --- Sortable columns (Company Name / Open IT Positions) -----------------
document.querySelectorAll('th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    const ascending = th.dataset.asc !== 'true';
    th.dataset.asc = String(ascending);

    const rows = Array.from(resultsBody.querySelectorAll('tr[data-company]'));

    rows.sort((a, b) => {
      const aVal = key === 'count' ? Number(a.children[1].textContent) : a.children[0].textContent.trim().toLowerCase();
      const bVal = key === 'count' ? Number(b.children[1].textContent) : b.children[0].textContent.trim().toLowerCase();

      if (aVal < bVal) return ascending ? -1 : 1;
      if (aVal > bVal) return ascending ? 1 : -1;
      return 0;
    });

    rows.forEach((row) => resultsBody.appendChild(row));
  });
});
