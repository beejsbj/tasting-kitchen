import { summarize } from "./logic.mjs";

const root = document.querySelector("#app");
const numberFormat = new Intl.NumberFormat("en-CA");

const escapeHTML = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const formatNumber = (value) => numberFormat.format(value);

const monthLabel = (value) => {
  const date = new Date(`${value}-01T00:00:00`);
  return date.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
};

const sectionLabels = {
  door: "Arrival",
  intake: "Description",
  shelves: "Selection",
  ledger: "Record",
  alteration: "Permission",
  labour: "Labour",
  return: "Departure",
};

const pullQuotes = {
  door: "“We keep things available,” she says. “Saving them is what the next person manages to do.”",
  intake: "A thing can keep its story without being trapped inside it.",
  shelves: "A depot built only from the photographs of its contents would be a very different institution.",
  ledger: "The point of publishing the table is to let that difference remain visible instead of reducing the season to one triumphant number.",
  alteration: "A scarred panel that can be drilled is more useful than a perfect panel that cannot.",
  labour: "That confidence is a service, even when it looks like a bag of labelled bolts.",
  return: "For once, the best evidence that the depot is useful is an absence.",
};

const moonIllustration = `
  <svg class="moon-illustration" viewBox="0 0 320 280" role="img" aria-labelledby="moon-ill-title moon-ill-desc">
    <title id="moon-ill-title">A painted scenic moon on padded blocks</title>
    <desc id="moon-ill-desc">Original diagram of a crescent moon resting on two padded blocks beside a loading door.</desc>
    <rect class="ill-bg" x="0" y="0" width="320" height="280" rx="4"/>
    <path class="ill-door" d="M20 40h80v200H20z"/>
    <path class="ill-door-frame" d="M28 48h64v184H28z"/>
    <path class="ill-door-light" d="M36 56h48v168H36z"/>
    <path class="ill-block ill-block--left" d="M130 210h52v28h-52z"/>
    <path class="ill-block ill-block--right" d="M198 210h52v28h-52z"/>
    <path class="ill-floor" d="M110 238h140"/>
    <circle class="ill-moon" cx="200" cy="120" r="72"/>
    <path class="ill-moon-shadow" d="M218 58c-28 12-48 38-48 70 0 42 34 76 76 76 8 0 16-1 23-4-18 8-38 12-59 12-48 0-86-39-86-86s38-86 86-86c6 0 12 1 18 2z"/>
    <path class="ill-moon-face" d="M188 118c6-5 14-5 20 0M192 134c5 3 10 3 15 0"/>
    <path class="ill-orbit" d="M108 90c20-36 58-58 100-58"/>
    <circle class="ill-dot" cx="108" cy="90" r="3"/>
    <circle class="ill-dot" cx="300" cy="170" r="3"/>
  </svg>`;

const cardIllustration = `
  <svg class="card-illustration" viewBox="0 0 280 200" role="img" aria-labelledby="card-ill-title card-ill-desc">
    <title id="card-ill-title">An intake card diagram</title>
    <desc id="card-ill-desc">Original diagram of a labelled intake card with dimension lines and material fields.</desc>
    <rect class="ill-card" x="20" y="16" width="240" height="168" rx="3"/>
    <line class="ill-rule" x1="36" y1="44" x2="244" y2="44"/>
    <rect class="ill-field" x="36" y="56" width="100" height="14" rx="1"/>
    <rect class="ill-field" x="36" y="78" width="140" height="14" rx="1"/>
    <rect class="ill-field" x="36" y="100" width="80" height="14" rx="1"/>
    <path class="ill-dimension" d="M160 130h60M160 126v8M220 126v8"/>
    <text class="ill-dim-text" x="190" y="148">180 cm</text>
    <path class="ill-dimension" d="M160 156v28M156 156h8M156 184h8"/>
    <text class="ill-dim-text" x="172" y="174">90</text>
    <rect class="ill-checkbox" x="36" y="130" width="12" height="12"/>
    <rect class="ill-field ill-field--short" x="54" y="130" width="90" height="12" rx="1"/>
  </svg>`;

const periodLabel = (period) => ({
  all: "All six months",
  spring: "Spring · March–May",
  summer: "Summer · June–August",
}[period]);

const renderNav = (sections) => sections.map((section, index) => `
  <li>
    <a href="#section-${escapeHTML(section.id)}" data-section="${escapeHTML(section.id)}">
      <span class="nav__num">${String(index + 1).padStart(2, "0")}</span>
      <span class="nav__label">${escapeHTML(sectionLabels[section.id] ?? section.heading)}</span>
    </a>
  </li>`).join("");

const renderLedger = () => `
  <div class="ledger" id="ledger-panel" data-period="all">
    <header class="ledger__header">
      <div>
        <p class="label">Recorded activity</p>
        <h3 id="ledger-heading">Six-month teaching dataset</h3>
      </div>
      <p class="ledger__meta">March–August 2026<br>Mass rounded to whole kilograms.</p>
    </header>

    <div class="ledger__controls" aria-label="Ledger period">
      <span class="ledger__controls-label" id="period-label">Period</span>
      <div class="period-toggle" role="group" aria-labelledby="period-label">
        <button type="button" class="period-btn" data-period="all" aria-pressed="true">All</button>
        <button type="button" class="period-btn" data-period="spring" aria-pressed="false">Spring</button>
        <button type="button" class="period-btn" data-period="summer" aria-pressed="false">Summer</button>
      </div>
      <p class="ledger__status" id="ledger-status" role="status" aria-live="polite">${periodLabel("all")}</p>
    </div>

    <dl class="ledger__totals" aria-label="Selected period totals">
      <div class="total-card">
        <dt>Months</dt>
        <dd data-total="months">6</dd>
        <dd class="total-card__hint">selected rows</dd>
      </div>
      <div class="total-card">
        <dt>Completed loans</dt>
        <dd data-total="loans">142</dd>
        <dd class="total-card__hint">outgoing bookings</dd>
      </div>
      <div class="total-card">
        <dt>Loaned mass</dt>
        <dd data-total="loanedKg">4,780 <span class="unit">kg</span></dd>
        <dd class="total-card__hint">at dispatch</dd>
      </div>
      <div class="total-card">
        <dt>Returned mass</dt>
        <dd data-total="returnedKg">4,410 <span class="unit">kg</span></dd>
        <dd class="total-card__hint">at return</dd>
      </div>
    </dl>

    <div class="ledger__legend" aria-label="Table legend">
      <span><i class="legend-swatch legend-swatch--out" aria-hidden="true"></i> Loaned</span>
      <span><i class="legend-swatch legend-swatch--ret" aria-hidden="true"></i> Returned</span>
      <span class="ledger__legend-note">Bars scale to the visible rows only.</span>
    </div>

    <div class="table-scroll" tabindex="0" aria-label="Scrollable monthly ledger table">
      <table class="ledger-table">
        <caption>Monthly ledger for <span data-caption-period>all six months</span>. All mass figures are in kilograms.</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Loans</th>
            <th scope="col">Loaned <span class="unit-head">(kg)</span></th>
            <th scope="col">Returned <span class="unit-head">(kg)</span></th>
            <th scope="col" class="col-bars">Monthly shape</th>
          </tr>
        </thead>
        <tbody id="ledger-rows"></tbody>
      </table>
    </div>

    <p class="ledger__footnote">Many small kits and fewer heavy scenic units place different demands on staff. These figures do not count unique objects, waste diverted, or emissions avoided.</p>
  </div>`;

const renderLedgerRows = (rows) => {
  if (!rows.length) {
    return `<tr><td colspan="5" class="empty-row">No rows in this period.</td></tr>`;
  }

  const maxMass = Math.max(...rows.flatMap((row) => [row.loanedKg, row.returnedKg]));
  return rows.map((row) => {
    const loanedPct = Math.round((row.loanedKg / maxMass) * 100);
    const returnedPct = Math.round((row.returnedKg / maxMass) * 100);
    return `
      <tr>
        <th scope="row">
          <time datetime="${escapeHTML(row.month)}-01">${escapeHTML(monthLabel(row.month))}</time>
          <span class="season-badge">${escapeHTML(row.season)}</span>
        </th>
        <td>${formatNumber(row.loans)}</td>
        <td>${formatNumber(row.loanedKg)} <span class="unit">kg</span></td>
        <td>${formatNumber(row.returnedKg)} <span class="unit">kg</span></td>
        <td class="col-bars">
          <div class="bar-pair">
            <span class="bar-line">
              <span class="bar-tag" aria-hidden="true">out</span>
              <span class="bar-track"><span class="bar bar--out" style="--w:${loanedPct}%"></span></span>
              <span class="sr-only">${formatNumber(row.loanedKg)} kilograms loaned</span>
            </span>
            <span class="bar-line">
              <span class="bar-tag" aria-hidden="true">back</span>
              <span class="bar-track"><span class="bar bar--ret" style="--w:${returnedPct}%"></span></span>
              <span class="sr-only">${formatNumber(row.returnedKg)} kilograms returned</span>
            </span>
          </div>
        </td>
      </tr>`;
  }).join("");
};

const updateLedger = (ledger, period) => {
  const panel = document.querySelector("#ledger-panel");
  if (!panel) return;

  const rows = period === "all" ? ledger : ledger.filter((row) => row.season === period);
  const totals = summarize(ledger, period);

  panel.dataset.period = period;
  panel.querySelector("#ledger-rows").innerHTML = renderLedgerRows(rows);
  panel.querySelector("[data-caption-period]").textContent = periodLabel(period).toLowerCase();
  panel.querySelector("#ledger-status").textContent = periodLabel(period);

  for (const [key, value] of Object.entries(totals)) {
    const target = panel.querySelector(`[data-total="${key}"]`);
    if (target) {
      target.innerHTML = key.endsWith("Kg")
        ? `${formatNumber(value)} <span class="unit">kg</span>`
        : formatNumber(value);
    }
  }

  for (const button of panel.querySelectorAll(".period-btn")) {
    const active = button.dataset.period === period;
    button.setAttribute("aria-pressed", String(active));
  }
};

const sectionIllustration = (id, captions) => {
  if (id === "door") {
    const caption = captions.find((c) => c.id === "moon");
    return `
      <figure class="section-figure section-figure--moon">
        ${moonIllustration}
        ${caption ? `<figcaption>${escapeHTML(caption.text)}</figcaption>` : ""}
      </figure>`;
  }
  if (id === "intake") {
    const caption = captions.find((c) => c.id === "card");
    return `
      <figure class="section-figure section-figure--card">
        ${cardIllustration}
        ${caption ? `<figcaption>${escapeHTML(caption.text)}</figcaption>` : ""}
      </figure>`;
  }
  return "";
};

const renderSection = (section, index, captions) => {
  const paragraphs = section.paragraphs.map((p, i) => `
    <p class="${i === 0 ? "lead" : ""}">${escapeHTML(p)}</p>`).join("");

  const bridge = section.id === "ledger"
    ? `<p class="note-bridge"><a href="#method-note">About the ledger <span aria-hidden="true">→</span></a></p>`
    : section.id === "alteration"
      ? `<p class="note-bridge"><a href="#terms-note">Loan and transfer terms <span aria-hidden="true">→</span></a></p>`
      : "";

  const ledger = section.id === "ledger" ? renderLedger() : "";
  const illustration = sectionIllustration(section.id, captions);
  const quote = pullQuotes[section.id] ?? "";

  return `
    <section class="chapter chapter--${escapeHTML(section.id)}" id="section-${escapeHTML(section.id)}" aria-labelledby="heading-${escapeHTML(section.id)}">
      <header class="chapter__head">
        <span class="chapter__index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
        <h2 id="heading-${escapeHTML(section.id)}">${escapeHTML(section.heading)}</h2>
      </header>
      <div class="chapter__grid">
        <div class="chapter__body">
          ${paragraphs}
          ${bridge}
          ${ledger}
        </div>
        <aside class="chapter__aside">
          ${illustration}
          ${quote ? `<blockquote class="pull-quote"><p>${escapeHTML(quote)}</p></blockquote>` : ""}
          <a class="back-link" href="#contents"><span aria-hidden="true">↑</span> Contents</a>
        </aside>
      </div>
    </section>`;
};

const renderNotes = (notes) => notes.map((note) => {
  const returnTarget = note.id === "method" ? "ledger" : "alteration";
  return `
    <article class="reader-note" id="${escapeHTML(note.id)}-note" aria-labelledby="${escapeHTML(note.id)}-title">
      <h2 id="${escapeHTML(note.id)}-title">${escapeHTML(note.title)}</h2>
      <p>${escapeHTML(note.text)}</p>
      <a class="back-link" href="#section-${returnTarget}"><span aria-hidden="true">↑</span> Back to the feature</a>
    </article>`;
}).join("");

const renderPage = (article, ledger) => {
  document.title = `${article.title} — ${article.publication}`;

  root.innerHTML = `
    <header class="masthead" id="top">
      <a class="masthead__logo" href="#top" aria-label="${escapeHTML(article.publication)} home">
        ${escapeHTML(article.publication)}
      </a>
      <span class="masthead__series">${escapeHTML(article.series)}</span>
      <a class="masthead__jump" href="#contents">Contents</a>
    </header>

    <main id="main-content">
      <section class="hero" aria-labelledby="article-title">
        <div class="hero__text">
          <p class="hero__kicker">${escapeHTML(article.series)}</p>
          <h1 id="article-title">${escapeHTML(article.title)}</h1>
          <p class="hero__dek">${escapeHTML(article.dek)}</p>
          <p class="hero__credit">
            <span>${escapeHTML(article.byline)}</span>
            <time datetime="${escapeHTML(article.date)}">1 September 2026</time>
          </p>
        </div>
        <div class="hero__visual">
          ${moonIllustration}
        </div>
      </section>

      <aside class="disclosure" aria-label="Disclosure">
        <span class="disclosure__tag">Disclosure</span>
        <p>${escapeHTML(article.disclosure)}</p>
      </aside>

      <div class="layout">
        <nav class="section-nav" id="contents" aria-label="Article sections">
          <p class="section-nav__title">In this feature</p>
          <ol>${renderNav(article.sections)}</ol>
        </nav>

        <div class="feature-body">
          <article class="feature" aria-label="${escapeHTML(article.title)}">
            ${article.sections.map((s, i) => renderSection(s, i, article.captions)).join("")}
          </article>

          <section class="notes-block" aria-labelledby="notes-heading">
            <h2 id="notes-heading" class="notes-block__title">Reader's notes</h2>
            <div class="notes-block__grid">${renderNotes(article.notes)}</div>
          </section>
        </div>
      </div>
    </main>

    <footer class="colophon">
      <a class="masthead__logo" href="#top">${escapeHTML(article.publication)}</a>
      <p>${escapeHTML(article.disclosure)}</p>
      <a class="back-link" href="#top"><span aria-hidden="true">↑</span> Back to top</a>
    </footer>`;

  updateLedger(ledger, "all");

  for (const button of document.querySelectorAll(".period-btn")) {
    button.addEventListener("click", () => updateLedger(ledger, button.dataset.period));
  }
};

try {
  const [articleResponse, ledgerResponse] = await Promise.all([
    fetch("./data/article.json"),
    fetch("./data/ledger.json"),
  ]);
  if (!articleResponse.ok || !ledgerResponse.ok) {
    throw new Error("The feature data could not be loaded.");
  }
  const [article, ledger] = await Promise.all([
    articleResponse.json(),
    ledgerResponse.json(),
  ]);
  renderPage(article, ledger);
} catch (error) {
  root.innerHTML = `
    <main class="load-error">
      <p class="label">Common Measure</p>
      <h1>Unable to open the feature.</h1>
      <p>${escapeHTML(error.message)}</p>
    </main>`;
}
