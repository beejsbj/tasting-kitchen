const content = await loadContent();

renderPage(content);
initNavigation();
initCopyButton(content.installation);
initPlanPreviews(content.pricing.plans);

async function loadContent() {
  const response = await fetch("./data/content.json");
  if (!response.ok) {
    throw new Error(`Failed to load content: ${response.status}`);
  }
  return response.json();
}

function renderPage(data) {
  document.title = `${data.product.name} — ${data.product.descriptor}`;

  const featureGrid = document.getElementById("feature-grid");
  for (const feature of data.features) {
    const li = document.createElement("li");
    li.className = "feature-card";
    li.innerHTML = `<h3>${escapeHtml(feature.title)}</h3><p>${escapeHtml(feature.body)}</p>`;
    featureGrid.appendChild(li);
  }

  const workflowSteps = document.getElementById("workflow-steps");
  for (const step of data.workflow) {
    const li = document.createElement("li");
    li.className = "workflow-step";
    li.innerHTML = `<h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.body)}</p>`;
    workflowSteps.appendChild(li);
  }

  document.getElementById("fiction-notice").textContent = data.fictionNotice;
  document.getElementById("installation-heading").textContent = data.installation.heading;
  document.getElementById("install-command").textContent = data.installation.command;
  document.getElementById("run-command").textContent = data.installation.runCommand;
  document.getElementById("config-filename").textContent = data.installation.filename;
  document.getElementById("config-specimen").textContent = data.installation.configSpecimen;
  document.getElementById("output-specimen").textContent = data.installation.outputSpecimen;
  document.getElementById("install-note").textContent = data.installation.note;
  document.getElementById("copy-label").textContent = data.installation.copyLabel;

  document.getElementById("pricing-heading").textContent = data.pricing.heading;
  document.getElementById("pricing-intro").textContent = data.pricing.intro;

  const pricingGrid = document.getElementById("pricing-grid");
  for (const plan of data.pricing.plans) {
    const card = document.createElement("article");
    card.className = "pricing-card" + (plan.id === "team" ? " is-featured" : "");
    card.dataset.planId = plan.id;

    const priceDisplay = formatPrice(plan);
    const featuresHtml = plan.features
      .map((f) => `<li>${escapeHtml(f)}</li>`)
      .join("");

    card.innerHTML = `
      <h3>${escapeHtml(plan.name)}</h3>
      <p class="pricing-audience">${escapeHtml(plan.audience)}</p>
      <p class="pricing-price">${priceDisplay}</p>
      <ul class="pricing-features">${featuresHtml}</ul>
      <button type="button" class="btn btn-secondary plan-action" data-plan-id="${escapeHtml(plan.id)}">${escapeHtml(plan.action)}</button>
    `;
    pricingGrid.appendChild(card);
  }

  const faqList = document.getElementById("faq-list");
  for (const item of data.faq) {
    const details = document.createElement("details");
    details.className = "faq-item";
    details.innerHTML = `
      <summary>${escapeHtml(item.question)}</summary>
      <div class="faq-answer"><p>${escapeHtml(item.answer)}</p></div>
    `;
    faqList.appendChild(details);
  }

  document.getElementById("footer-text").textContent = data.footer;
  document.getElementById("footer-fiction").textContent = data.fictionNotice;
  document.getElementById("contact-address").textContent = data.product.contact;
  document.getElementById("contact-note").textContent = data.product.contactNote;
}

function formatPrice(plan) {
  if (plan.monthlyPriceUsd === 0) {
    return `$0<span class="period"> / month</span>`;
  }
  if (plan.id === "team") {
    return `<span class="currency">$</span>${plan.monthlyPriceUsd}<span class="period"> / workspace / month</span>`;
  }
  return `<span class="currency">$</span>${plan.monthlyPriceUsd}<span class="period"> / month</span>`;
}

function initNavigation() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  const navLinks = nav.querySelectorAll("a");

  toggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  for (const link of navLinks) {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("is-open")) {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    }
  });
}

function initCopyButton(installation) {
  const button = document.getElementById("copy-install");
  const commandEl = document.getElementById("install-command");
  const statusEl = document.getElementById("copy-status");
  const fallbackEl = document.getElementById("copy-fallback");

  button.addEventListener("click", async () => {
    statusEl.textContent = "";
    statusEl.classList.remove("is-error");
    fallbackEl.classList.add("hidden");
    fallbackEl.textContent = "";

    const command = installation.command;

    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      showCopyFailure(installation, statusEl, fallbackEl, commandEl);
      return;
    }

    try {
      await navigator.clipboard.writeText(command);
      statusEl.textContent = installation.copied;
    } catch {
      showCopyFailure(installation, statusEl, fallbackEl, commandEl);
    }
  });
}

function showCopyFailure(installation, statusEl, fallbackEl, commandEl) {
  statusEl.textContent = installation.copyFailed;
  statusEl.classList.add("is-error");
  fallbackEl.textContent = installation.copyFailed;
  fallbackEl.classList.remove("hidden");
  commandEl.setAttribute("tabindex", "0");
  commandEl.focus();
}

function initPlanPreviews(plans) {
  const panel = document.getElementById("plan-preview-panel");
  const titleEl = document.getElementById("plan-preview-title");
  const textEl = document.getElementById("plan-preview-text");

  document.querySelectorAll(".plan-action").forEach((button) => {
    button.addEventListener("click", () => {
      const plan = plans.find((p) => p.id === button.dataset.planId);
      if (!plan) return;

      titleEl.textContent = `${plan.name} plan selected`;
      textEl.textContent = plan.preview;
      panel.hidden = false;
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
