const content = await fetch("./data/content.json").then((r) => r.json());

const { business, services, about, trustFacts, visitSteps, faq, inquiry, footer, fictionNotice } = content;

const OTHER_SERVICE = "other";
const OTHER_AREA = "other";

const navItems = [
  { href: "#services", label: "Services" },
  { href: "#about", label: "About" },
  { href: "#area", label: "Area & hours" },
  { href: "#faq", label: "FAQ" },
  { href: "#enquiry", label: "Enquiry" },
];

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function populateContent() {
  document.title = business.name;
  setText("site-name", business.name);
  setText("tagline", business.tagline);
  setText("hero-heading", business.hero);
  setText("hero-intro", business.introduction);
  setText("primary-action", business.primaryAction);
  setText("secondary-action", business.secondaryAction);
  setText("about-heading", about.heading);

  const aboutParagraphs = document.getElementById("about-paragraphs");
  about.paragraphs.forEach((text) => {
    const p = document.createElement("p");
    p.textContent = text;
    aboutParagraphs.appendChild(p);
  });

  const trustList = document.getElementById("trust-list");
  trustFacts.forEach((fact) => {
    const li = document.createElement("li");
    li.textContent = fact;
    trustList.appendChild(li);
  });

  const servicesGrid = document.getElementById("services-grid");
  services.forEach((svc) => {
    const article = document.createElement("article");
    article.className = "service-card";
    article.id = `service-${svc.id}`;

    const h3 = document.createElement("h3");
    h3.textContent = svc.title;

    const desc = document.createElement("p");
    desc.textContent = svc.description;

    const scope = document.createElement("p");
    scope.className = "service-scope";
    scope.textContent = svc.scope;

    article.append(h3, desc, scope);
    servicesGrid.appendChild(article);
  });

  const processSteps = document.getElementById("process-steps");
  visitSteps.forEach((step) => {
    const li = document.createElement("li");
    li.className = "process-step";

    const h3 = document.createElement("h3");
    h3.textContent = step.title;

    const p = document.createElement("p");
    p.textContent = step.body;

    li.append(h3, p);
    processSteps.appendChild(li);
  });

  setText("location", business.location);
  setText("hours", business.hours);
  setText("availability", business.availability);

  const areaList = document.getElementById("area-list");
  business.serviceAreas.forEach((area) => {
    const li = document.createElement("li");
    li.textContent = area;
    areaList.appendChild(li);
  });

  setText("outside-area", business.outsideArea);
  setText("contact-email", business.email);
  setText("contact-note", business.contactNote);

  const faqList = document.getElementById("faq-list");
  faq.forEach((item) => {
    const details = document.createElement("details");
    details.className = "faq-item";

    const summary = document.createElement("summary");
    summary.textContent = item.question;

    const answer = document.createElement("p");
    answer.className = "faq-answer";
    answer.textContent = item.answer;

    details.append(summary, answer);
    faqList.appendChild(details);
  });

  setText("enquiry-heading", inquiry.heading);
  setText("enquiry-intro", inquiry.intro);
  setText("submit-button", inquiry.button);
  setText("preview-success", inquiry.success);
  setText("privacy-note", inquiry.privacy);
  setText("footer-text", footer);
  setText("fiction-notice", fictionNotice);
}

function populateNav() {
  const navList = document.getElementById("nav-list");
  navItems.forEach(({ href, label }) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    li.appendChild(a);
    navList.appendChild(li);
  });
}

function populateFormOptions() {
  const serviceSelect = document.getElementById("service");
  services.forEach((svc) => {
    const option = document.createElement("option");
    option.value = svc.id;
    option.textContent = svc.title;
    serviceSelect.appendChild(option);
  });
  const otherService = document.createElement("option");
  otherService.value = OTHER_SERVICE;
  otherService.textContent = "Other / not sure";
  serviceSelect.appendChild(otherService);

  const neighbourhoodSelect = document.getElementById("neighbourhood");
  business.serviceAreas.forEach((area) => {
    const option = document.createElement("option");
    option.value = area;
    option.textContent = area;
    neighbourhoodSelect.appendChild(option);
  });
  const otherArea = document.createElement("option");
  otherArea.value = OTHER_AREA;
  otherArea.textContent = inquiry.otherAreaLabel;
  neighbourhoodSelect.appendChild(otherArea);
}

function setupNavigation() {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("site-nav");

  function setNavOpen(open) {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  }

  toggle.addEventListener("click", () => {
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    setNavOpen(!isOpen);
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setNavOpen(false));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setNavOpen(false);
      toggle.focus();
    }
  });
}

const form = document.getElementById("enquiry-form");
const preview = document.getElementById("enquiry-preview");
const previewSummary = document.getElementById("preview-summary");
const otherAreaField = document.getElementById("other-area-field");
const neighbourhoodSelect = document.getElementById("neighbourhood");

const fields = {
  name: { input: document.getElementById("name"), error: document.getElementById("name-error") },
  email: { input: document.getElementById("email"), error: document.getElementById("email-error") },
  service: { input: document.getElementById("service"), error: document.getElementById("service-error") },
  neighbourhood: { input: neighbourhoodSelect, error: document.getElementById("neighbourhood-error") },
  otherArea: { input: document.getElementById("other-area"), error: document.getElementById("other-area-error") },
  description: { input: document.getElementById("description"), error: document.getElementById("description-error") },
};

function clearFieldError(key) {
  const { input, error } = fields[key];
  input.removeAttribute("aria-invalid");
  error.textContent = "";
  error.hidden = true;
}

function showFieldError(key, message) {
  const { input, error } = fields[key];
  input.setAttribute("aria-invalid", "true");
  error.textContent = message;
  error.hidden = false;
}

function clearAllErrors() {
  Object.keys(fields).forEach(clearFieldError);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getServiceLabel(value) {
  if (value === OTHER_SERVICE) return "Other / not sure";
  const svc = services.find((s) => s.id === value);
  return svc ? svc.title : value;
}

function getNeighbourhoodLabel(value, otherName) {
  if (value === OTHER_AREA) return otherName.trim() || inquiry.otherAreaLabel;
  return value;
}

function validateForm() {
  clearAllErrors();
  let firstInvalid = null;
  let valid = true;

  const name = fields.name.input.value;
  if (!name.trim()) {
    showFieldError("name", "Please enter your name.");
    firstInvalid = firstInvalid ?? fields.name.input;
    valid = false;
  }

  const email = fields.email.input.value;
  if (!email.trim()) {
    showFieldError("email", "Please enter your email address.");
    firstInvalid = firstInvalid ?? fields.email.input;
    valid = false;
  } else if (!isValidEmail(email)) {
    showFieldError("email", "Please enter a valid email address.");
    firstInvalid = firstInvalid ?? fields.email.input;
    valid = false;
  }

  const service = fields.service.input.value;
  if (!service) {
    showFieldError("service", "Please choose a service.");
    firstInvalid = firstInvalid ?? fields.service.input;
    valid = false;
  }

  const neighbourhood = fields.neighbourhood.input.value;
  if (!neighbourhood) {
    showFieldError("neighbourhood", "Please choose a neighbourhood.");
    firstInvalid = firstInvalid ?? fields.neighbourhood.input;
    valid = false;
  }

  const otherArea = fields.otherArea.input.value;
  if (neighbourhood === OTHER_AREA && !otherArea.trim()) {
    showFieldError("otherArea", "Please enter the area name.");
    firstInvalid = firstInvalid ?? fields.otherArea.input;
    valid = false;
  }

  const description = fields.description.input.value;
  if (!description.trim()) {
    showFieldError("description", "Please describe the job.");
    firstInvalid = firstInvalid ?? fields.description.input;
    valid = false;
  }

  if (firstInvalid) firstInvalid.focus();
  return valid;
}

function buildPreviewSummary() {
  previewSummary.replaceChildren();

  const entries = [
    ["Name", fields.name.input.value.trim()],
    ["Email", fields.email.input.value.trim()],
    ["Service", getServiceLabel(fields.service.input.value)],
    ["Neighbourhood", getNeighbourhoodLabel(fields.neighbourhood.input.value, fields.otherArea.input.value)],
    ["Job description", fields.description.input.value.trim()],
  ];

  entries.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    previewSummary.append(dt, dd);
  });
}

function showPreview() {
  buildPreviewSummary();
  form.hidden = true;
  preview.hidden = false;
  document.getElementById("edit-enquiry").focus();
}

function showForm() {
  preview.hidden = true;
  form.hidden = false;
  fields.name.input.focus();
}

function setupForm() {
  neighbourhoodSelect.addEventListener("change", () => {
    const isOther = neighbourhoodSelect.value === OTHER_AREA;
    otherAreaField.hidden = !isOther;
    if (!isOther) clearFieldError("otherArea");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (validateForm()) showPreview();
  });

  form.addEventListener("reset", () => {
    clearAllErrors();
    otherAreaField.hidden = true;
    preview.hidden = true;
    form.hidden = false;
  });

  document.getElementById("edit-enquiry").addEventListener("click", showForm);
}

populateContent();
populateNav();
populateFormOptions();
setupNavigation();
setupForm();
