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

const sectionKickers = {
  door: "Field note / arrival",
  intake: "Intake / description",
  shelves: "Storage / selection",
  ledger: "Instrument / six months",
  alteration: "Terms / permission",
  labour: "Labour / availability",
  return: "Last look / departure",
};

const pullQuotes = {
  door: "“We keep things available,” she says.",
  intake: "A thing can keep its story without being trapped inside it.",
  shelves: "The shelves are an argument.",
  ledger: "The point of publishing the table is to let that difference remain visible instead of reducing the season to one triumphant number.",
  alteration: "A scarred panel that can be drilled is more useful than a perfect panel that cannot.",
  labour: "That confidence is a service, even when it looks like a bag of labelled bolts.",
  return: "For once, the best evidence that the depot is useful is an absence.",
};

const depotMark = `
  <svg class="moon-mark" viewBox="0 0 240 240" role="img" aria-labelledby="moon-mark-title moon-mark-description">
    <title id="moon-mark-title">A painted moon on padded blocks</title>
    <desc id="moon-mark-description">A diagrammatic crescent moon held above two square padded blocks, with a looping path around it.</desc>
    <defs>
      <pattern id="moon-grid" width="18" height="18" patternUnits="userSpaceOnUse">
        <path d="M 18 0 L 0 0 0 18" fill="none" stroke="currentColor" stroke-width="1" opacity=".22" />
      </pattern>
    </defs>
    <path class="moon-orbit" d="M28 120c0-52 42-94 94-94 44 0 82 31 91 73" />
    <path class="moon-orbit moon-orbit--short" d="M190 143c-9 44-47 76-92 76-34 0-64-18-80-45" />
    <circle class="moon-disc" cx="120" cy="105" r="61" />
    <circle class="moon-texture" cx="120" cy="105" r="61" />
    <path class="moon-cut" d="M135 48c-20 9-34 29-34 52 0 31 24 57 54 61-10 4-21 6-32 6-35 0-62-28-62-62s27-62 62-62c4 0 8 0 12 1z" />
    <path class="moon-face" d="M108 103c7-6 16-6 23 0M112 121c6 4 12 4 18 0" />
    <path class="moon-block moon-block--left" d="M52 177h43v23H52z" />
    <path class="moon-block moon-block--right" d="M145 177h43v23h-43z" />
    <path class="moon-floor" d="M35 201h170" />
  </svg>`;

const renderContents = (sections) => sections.map((section, index) => `
  <li>
    <a href="#section-${escapeHTML(section.id)}">
      <span class="contents__number">${String(index + 1).padStart(2, "0")}</span>
      <span>${escapeHTML(section.heading)}</span>
    </a>
  </li>`).join("");

const renderSection = (section, index) => {
  const paragraphs = section.paragraphs.map((paragraph, paragraphIndex) => `
    <p class="${paragraphIndex === 0 ? "section__lead" : ""}">${escapeHTML(paragraph)}</p>`).join("");
  const termsBridge = section.id === "alteration" ? `
    <p class="section__bridge"><span>Related note</span> <a href="#terms-note">Read the loan and transfer terms <span aria-hidden="true">↗</span></a></p>` : "";
  const ledgerBridge = section.id === "ledger" ? `
    <p class="section__bridge"><span>Data boundary</span> <a href="#method-note">Read how the ledger was made <span aria-hidden="true">↗</span></a></p>` : "";
  const ledger = section.id === "ledger" ? renderLedger() : "";

  return `
    <section class="story-section story-section--${escapeHTML(section.id)}" id="section-${escapeHTML(section.id)}" aria-labelledby="heading-${escapeHTML(section.id)}">
      <div class="section__meta">
        <span class="section__index">${String(index + 1).padStart(2, "0")}</span>
        <span class="section__kicker">${escapeHTML(sectionKickers[section.id] ?? "Chapter")}</span>
      </div>
      <div class="section__body">
        <h2 id="heading-${escapeHTML(section.id)}">${escapeHTML(section.heading)}</h2>
        ${paragraphs}
        ${termsBridge}
        ${ledgerBridge}
        ${ledger}
        <blockquote class="pull-quote"><span aria-hidden="true">“</span>${escapeHTML(pullQuotes[section.id] ?? "")}</blockquote>
        <a class="return-link" href="#contents"><span aria-hidden="true">↑</span> Back to contents</a>
      </div>
    </section>`;
};

const periodLabel = (period) => ({
  all: "All six months",
  spring: "Spring · March–May",
  summer: "Summer · June–August",
}[period]);

const renderLedger = () => `
  <div class="ledger" id="ledger-panel" data-period="all">
    <div class="ledger__head">
      <div>
        <p class="eyebrow">Recorded activity / kg and loans</p>
        <h3 id="ledger-title">A six-month teaching dataset</h3>
      </div>
      <p class="ledger__scope">March–August 2026<br>Mass is rounded to whole kilograms.</p>
    </div>
    <div class="ledger__controls" aria-label="Ledger period">
      <span class="ledger__controls-label">Show</span>
      <div class="segmented-control" role="group" aria-label="Select ledger period">
        <button type="button" class="period-button" data-period="all" aria-pressed="true">All</button>
        <button type="button" class="period-button" data-period="spring" aria-pressed="false">Spring</button>
        <button type="button" class="period-button" data-period="summer" aria-pressed="false">Summer</button>
      </div>
      <span class="ledger__status" id="ledger-status" role="status" aria-live="polite">${periodLabel("all")}</span>
    </div>
    <div class="ledger__totals" aria-label="Selected period totals">
      <div class="ledger-total"><span>Months</span><strong data-total="months">6</strong><small>selected rows</small></div>
      <div class="ledger-total"><span>Completed loans</span><strong data-total="loans">142</strong><small>outgoing bookings</small></div>
      <div class="ledger-total"><span>Loaned</span><strong data-total="loanedKg">4,780 <em>kg</em></strong><small>measured at dispatch</small></div>
      <div class="ledger-total"><span>Returned</span><strong data-total="returnedKg">4,410 <em>kg</em></strong><small>measured at return</small></div>
    </div>
    <div class="ledger__key" aria-label="Table key">
      <span><i class="key-mark key-mark--outgoing" aria-hidden="true"></i> Loaned mass</span>
      <span><i class="key-mark key-mark--returned" aria-hidden="true"></i> Returned mass</span>
      <span>Bars are relative to the visible rows.</span>
    </div>
    <div class="table-scroll" tabindex="0" aria-label="Scrollable monthly ledger">
      <table>
        <caption>Monthly ledger for the <span data-caption-period>All six months</span>. Every mass figure is in kilograms.</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Completed loans</th>
            <th scope="col">Loaned mass <span>(kg)</span></th>
            <th scope="col">Returned mass <span>(kg)</span></th>
            <th scope="col" class="table-bars-heading">Shape of the month</th>
          </tr>
        </thead>
        <tbody id="ledger-rows"></tbody>
      </table>
    </div>
    <p class="ledger__caption">The bars keep two kinds of work in view: a month can carry many small kits, or fewer heavy scenic units. Neither measure stands in for waste, emissions or unique objects.</p>
  </div>`;

const renderLedgerRows = (rows) => {
  if (!rows.length) {
    return `<tr><td colspan="5" class="empty-row">No rows in this period.</td></tr>`;
  }

  const maxMass = Math.max(...rows.flatMap((row) => [row.loanedKg, row.returnedKg]));
  return rows.map((row) => {
    const loanedWidth = Math.round((row.loanedKg / maxMass) * 100);
    const returnedWidth = Math.round((row.returnedKg / maxMass) * 100);
    return `
      <tr>
        <th scope="row"><time datetime="${escapeHTML(row.month)}-01">${escapeHTML(monthLabel(row.month))}</time><span class="season-tag">${escapeHTML(row.season)}</span></th>
        <td>${formatNumber(row.loans)}</td>
        <td>${formatNumber(row.loanedKg)} <span class="unit">kg</span></td>
        <td>${formatNumber(row.returnedKg)} <span class="unit">kg</span></td>
        <td class="table-bars">
          <span class="bar-row"><span class="bar-label">out</span><span class="bar-track"><span class="bar bar--outgoing" style="--bar-width: ${loanedWidth}%"></span></span><span class="sr-only">${formatNumber(row.loanedKg)} kilograms loaned</span></span>
          <span class="bar-row"><span class="bar-label">back</span><span class="bar-track"><span class="bar bar--returned" style="--bar-width: ${returnedWidth}%"></span></span><span class="sr-only">${formatNumber(row.returnedKg)} kilograms returned</span></span>
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
  panel.querySelector("[data-caption-period]").textContent = periodLabel(period);
  panel.querySelector("#ledger-status").textContent = periodLabel(period);
  for (const [key, value] of Object.entries(totals)) {
    const target = panel.querySelector(`[data-total="${key}"]`);
    if (target) {
      target.innerHTML = key.endsWith("Kg") ? `${formatNumber(value)} <em>kg</em>` : formatNumber(value);
    }
  }
  for (const button of panel.querySelectorAll(".period-button")) {
    const active = button.dataset.period === period;
    button.setAttribute("aria-pressed", String(active));
  }
};

const renderNotes = (notes) => notes.map((note, index) => `
  <section class="note-card" id="${escapeHTML(note.id)}-note" aria-labelledby="${escapeHTML(note.id)}-note-title">
    <div class="note-card__number">${String(index + 1).padStart(2, "0")}</div>
    <div>
      <p class="eyebrow">Reader's note</p>
      <h2 id="${escapeHTML(note.id)}-note-title">${escapeHTML(note.title)}</h2>
      <p>${escapeHTML(note.text)}</p>
      <a class="return-link" href="#section-${note.id === "method" ? "ledger" : "alteration"}"><span aria-hidden="true">↑</span> Back to the feature</a>
    </div>
  </section>`).join("");

const renderPage = (article, ledger) => {
  document.title = `${article.title} — ${article.publication}`;
  root.innerHTML = `
    <header class="site-header">
      <a class="wordmark" href="#top" aria-label="Common Measure home">Common <span>Measure</span></a>
      <div class="site-header__series">${escapeHTML(article.series)}</div>
      <a class="header-link" href="#contents">Contents <span aria-hidden="true">↘</span></a>
    </header>
    <main id="main-content">
      <section class="hero" id="top" aria-labelledby="article-title">
        <div class="hero__copy">
          <p class="publication-lockup"><span>${escapeHTML(article.publication)}</span><i aria-hidden="true"></i><span>Field feature 07</span></p>
          <p class="hero__series">${escapeHTML(article.series)}</p>
          <h1 id="article-title">${escapeHTML(article.title)}</h1>
          <p class="hero__dek">${escapeHTML(article.dek)}</p>
          <div class="hero__byline">
            <span>${escapeHTML(article.byline)}</span>
            <time datetime="${escapeHTML(article.date)}">01 September 2026</time>
          </div>
        </div>
        <div class="hero__art">
          <div class="hero__art-label">Object study <span>01 / 01</span></div>
          ${depotMark}
          <p class="hero__caption">${escapeHTML(article.captions.find((caption) => caption.id === "moon")?.text ?? "")}</p>
        </div>
        <div class="hero__footer">
          <span>Read the room</span>
          <span class="hero__rule" aria-hidden="true"></span>
          <a href="#section-door">Begin at the loading door <span aria-hidden="true">↓</span></a>
        </div>
      </section>

      <div class="disclosure"><span class="disclosure__label">Disclosure</span><p>${escapeHTML(article.disclosure)}</p></div>

      <section class="contents-wrap" id="contents" aria-labelledby="contents-title">
        <div class="contents-intro">
          <p class="eyebrow">A guided read</p>
          <h2 id="contents-title">The work behind the shelf.</h2>
          <p>Seven scenes follow one object from arrival to return. The ledger is a narrow instrument inside a wider story.</p>
        </div>
        <nav class="contents" aria-label="Article sections">
          <ol>${renderContents(article.sections)}</ol>
        </nav>
      </section>

      <article class="feature">
        ${article.sections.map((section, index) => renderSection(section, index)).join("")}
      </article>

      <section class="notes" aria-labelledby="notes-title">
        <div class="notes__heading">
          <p class="eyebrow">Read with care</p>
          <h2 id="notes-title">Notes on the record.</h2>
        </div>
        <div class="notes__grid">${renderNotes(article.notes)}</div>
      </section>
    </main>
    <footer class="site-footer">
      <a class="wordmark" href="#top">Common <span>Measure</span></a>
      <p>${escapeHTML(article.disclosure)}</p>
      <a class="return-link" href="#top"><span aria-hidden="true">↑</span> Back to top</a>
    </footer>`;

  updateLedger(ledger, "all");
  for (const button of document.querySelectorAll(".period-button")) {
    button.addEventListener("click", () => updateLedger(ledger, button.dataset.period));
  }
};

try {
  const [articleResponse, ledgerResponse] = await Promise.all([
    fetch("./data/article.json"),
    fetch("./data/ledger.json"),
  ]);
  if (!articleResponse.ok || !ledgerResponse.ok) throw new Error("The feature data could not be loaded.");
  const [article, ledger] = await Promise.all([articleResponse.json(), ledgerResponse.json()]);
  renderPage(article, ledger);
} catch (error) {
  root.innerHTML = `<main class="load-error"><p class="eyebrow">Common Measure</p><h1>Unable to open the feature.</h1><p>${escapeHTML(error.message)}</p></main>`;
}
