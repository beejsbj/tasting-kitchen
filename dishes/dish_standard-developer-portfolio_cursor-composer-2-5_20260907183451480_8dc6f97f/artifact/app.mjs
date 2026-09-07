const content = await loadContent();
renderPage(content);
initNavigation();
initProjectFilter(content);

async function loadContent() {
  const response = await fetch("./data/content.json");
  if (!response.ok) {
    throw new Error("Failed to load content");
  }
  return response.json();
}

function renderPage(data) {
  const { person, projects, skills, experience, education } = data;

  document.getElementById("hero-role").textContent = person.role;
  document.getElementById("hero-heading").textContent = person.headline;
  document.getElementById("hero-intro").textContent = person.intro;
  document.getElementById("hero-availability").textContent = person.availability;
  document.getElementById("hero-location").textContent = person.location;

  document.getElementById("filter-label").textContent = data.filterCopy.label;

  renderProjectList(projects);
  renderCaseStudies(projects);

  const aboutEl = document.getElementById("about-content");
  aboutEl.innerHTML = person.about.map((para) => `<p>${escapeHtml(para)}</p>`).join("");

  const skillsEl = document.getElementById("skills-grid");
  skillsEl.innerHTML = skills
    .map(
      (group) => `
        <div class="skill-group">
          <h3>${escapeHtml(group.group)}</h3>
          <ul>${group.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>`
    )
    .join("");

  const experienceEl = document.getElementById("experience-list");
  experienceEl.innerHTML = experience
    .map(
      (job) => `
        <article class="experience-item">
          <h3>${escapeHtml(job.role)} · ${escapeHtml(job.company)}</h3>
          <p class="experience-dates">${escapeHtml(job.dates)}</p>
          <p>${escapeHtml(job.description)}</p>
          <ul>${job.contributions.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
        </article>`
    )
    .join("");

  const eduEl = document.getElementById("education-content");
  eduEl.innerHTML = `
    <div class="education-entry">
      <h3>${escapeHtml(education.qualification)}</h3>
      <p>${escapeHtml(education.institution)} · ${escapeHtml(education.year)}</p>
    </div>`;

  document.getElementById("contact-copy").textContent = person.contactCopy;
  const emailLink = document.getElementById("contact-email");
  emailLink.href = `mailto:${person.email}`;
  emailLink.textContent = person.email;
  document.getElementById("contact-note").textContent =
    "This is a fictional preview address. No messages are sent from this page.";

  document.getElementById("footer-text").textContent = data.footer;
  document.getElementById("fiction-notice").textContent = data.fictionNotice;
}

function renderProjectList(projects) {
  const listEl = document.getElementById("project-list");
  listEl.innerHTML = projects
    .map(
      (project) => `
        <li
          class="project-card"
          data-category="${escapeHtml(project.category)}"
          data-project-id="${escapeHtml(project.id)}"
        >
          <div class="project-card-meta">
            <span>${escapeHtml(project.category)}</span>
            <span>${escapeHtml(project.year)}</span>
          </div>
          <h3>${escapeHtml(project.title)}</h3>
          <p>${escapeHtml(project.summary)}</p>
          <p class="project-card-role">${escapeHtml(project.role)}</p>
          <ul class="project-stack" aria-label="Technologies used">
            ${project.stack.map((tech) => `<li>${escapeHtml(tech)}</li>`).join("")}
          </ul>
          <a class="project-card-link" href="#project-${escapeHtml(project.id)}">
            Read case study
          </a>
        </li>`
    )
    .join("");
}

function renderCaseStudies(projects) {
  const container = document.getElementById("case-study-details");
  container.innerHTML = projects
    .map(
      (project) => `
        <article class="case-study" id="project-${escapeHtml(project.id)}">
          <h3>${escapeHtml(project.title)}</h3>
          <p class="case-study-meta">
            ${escapeHtml(project.category)} · ${escapeHtml(project.year)} · ${escapeHtml(project.role)}
          </p>
          <p>${escapeHtml(project.summary)}</p>
          <ul class="project-stack" aria-label="Technologies used">
            ${project.stack.map((tech) => `<li>${escapeHtml(tech)}</li>`).join("")}
          </ul>

          <details>
            <summary>Problem</summary>
            <div class="case-study-body"><p>${escapeHtml(project.problem)}</p></div>
          </details>
          <details>
            <summary>Approach</summary>
            <div class="case-study-body"><p>${escapeHtml(project.approach)}</p></div>
          </details>
          <details>
            <summary>Result</summary>
            <div class="case-study-body"><p>${escapeHtml(project.result)}</p></div>
          </details>
          <details>
            <summary>Learning</summary>
            <div class="case-study-body"><p>${escapeHtml(project.learning)}</p></div>
          </details>

          <p class="case-study-links-note">${escapeHtml(project.linksNote)}</p>
          <a class="back-to-projects" href="#projects">Back to projects</a>
        </article>`
    )
    .join("");
}

function initNavigation() {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("site-nav");

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    nav.classList.toggle("is-open", !expanded);
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      toggle.setAttribute("aria-expanded", "false");
      nav.classList.remove("is-open");
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("is-open")) {
      toggle.setAttribute("aria-expanded", "false");
      nav.classList.remove("is-open");
      toggle.focus();
    }
  });
}

function initProjectFilter(data) {
  const categories = data.projectCategories;
  const controlsEl = document.getElementById("filter-controls");
  const statusEl = document.getElementById("filter-status");
  const cards = () => document.querySelectorAll(".project-card");

  let activeCategory = "All";

  controlsEl.innerHTML = categories
    .map(
      (cat, index) => `
        <button
          type="button"
          class="filter-btn"
          data-category="${escapeHtml(cat)}"
          aria-pressed="${cat === "All" ? "true" : "false"}"
          ${index === 0 ? 'id="filter-all"' : ""}
        >${escapeHtml(cat === "All" ? data.filterCopy.all : cat)}</button>`
    )
    .join("");

  const buttons = controlsEl.querySelectorAll(".filter-btn");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => applyFilter(btn.dataset.category, btn));
    btn.addEventListener("keydown", (event) => {
      const currentIndex = [...buttons].indexOf(btn);
      let nextIndex = currentIndex;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        nextIndex = (currentIndex + 1) % buttons.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      } else if (event.key === "Home") {
        event.preventDefault();
        nextIndex = 0;
      } else if (event.key === "End") {
        event.preventDefault();
        nextIndex = buttons.length - 1;
      } else {
        return;
      }

      buttons[nextIndex].focus();
    });
  });

  function applyFilter(category, focusedBtn) {
    activeCategory = category;

    buttons.forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.category === category));
    });

    let visibleCount = 0;
    cards().forEach((card) => {
      const show = category === "All" || card.dataset.category === category;
      card.classList.toggle("is-hidden", !show);
      if (show) visibleCount += 1;
    });

    const categoryLabel = category === "All" ? data.filterCopy.all : category;
    if (visibleCount === 0) {
      statusEl.textContent = `${categoryLabel}: ${data.filterCopy.empty}`;
    } else {
      statusEl.textContent = `${categoryLabel}: showing ${visibleCount} of ${data.projects.length} projects`;
    }

    if (focusedBtn) {
      focusedBtn.focus();
    }
  }

  applyFilter("All", document.getElementById("filter-all"));
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
