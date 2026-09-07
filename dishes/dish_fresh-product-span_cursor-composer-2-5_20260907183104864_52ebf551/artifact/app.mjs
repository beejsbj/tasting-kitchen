import { estimate, prepareInquiry } from "./logic.mjs";

const state = { size: "narrow", finish: "chalk", quantity: 1, mesh: false, bag: null };
let product;

const $ = (id) => document.getElementById(id);
const money = (cents) =>
  `CAD ${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const sizeFor = (id) => product.sizes.find((size) => size.id === id);
const finishFor = (id) => product.finishes.find((finish) => finish.id === id);
const stockFor = () => Number(product.stock[`${state.size}:${state.finish}`] ?? 0);
const dimensions = (values) => values.join(" × ");
const selection = () => ({ size: state.size, finish: state.finish, quantity: state.quantity, mesh: state.mesh });

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function renderSelectionClasses() {
  document.querySelectorAll(".option-card, .finish-option").forEach((card) => {
    const input = card.querySelector("input");
    card.classList.toggle("is-selected", input.checked);
  });
}

function renderFacts() {
  const size = sizeFor(state.size);
  const finish = finishFor(state.finish);
  setText("current-size-label", size.label);
  setText("current-finish-label", finish.label);
  setText("current-dimensions", `${dimensions(size.openCm)} cm open · ${dimensions(size.foldedCm)} cm folded`);
  setText("open-dimensions", dimensions(size.openCm));
  setText("folded-dimensions", dimensions(size.foldedCm));
  setText("ruler-label", `${size.openCm[0]} cm wide`);
  setText("capacity-title", `${size.lineMetres} m line`);
  setText("capacity-copy", `Carries up to ${size.loadKg} kg across its rails.`);
  setText("weight-value", `${size.weightKg} kg`);
  setText("material-copy", `${finish.description} with replaceable beech rails.`);
  setText("fact-line", size.lineMetres);
  setText("fact-load", size.loadKg);
  setText("fact-folded", size.foldedCm[2]);
  setText("inquiry-current", `Current selection: ${size.label} / ${finish.label}`);
  setText("narrow-price", money(product.sizes.find((item) => item.id === "narrow").priceCents));
  setText("wide-price", money(product.sizes.find((item) => item.id === "wide").priceCents));
  setText("mesh-price", money(product.accessory.priceCents));
  setText("delivery-region", product.delivery.region);
  setText("dispatch-copy", product.delivery.dispatch);
}

function renderEstimate() {
  const result = estimate(selection(), product);
  const stock = stockFor();
  const size = sizeFor(state.size);
  const finish = finishFor(state.finish);
  const addButton = $("add-to-bag");
  const stockMessage = $("stock-message");
  const meshText = state.mesh ? ` + ${product.accessory.name}` : "";
  setText("merchandise-total", money(result.merchandiseCents));
  setText("shipping-total", result.shippingCents === 0 ? "FREE" : money(result.shippingCents));
  setText(
    "shipping-note",
    result.shippingCents === 0
      ? `free at ${money(product.delivery.freeAtCents)}`
      : `${money(product.delivery.flatCents)} flat`,
  );
  setText("grand-total", money(result.totalCents));
  stockMessage.classList.toggle("is-unavailable", !result.available);
  if (result.reason === "sold-out") {
    stockMessage.textContent = `${size.label} / ${finish.label} is sold out. You can still ask about it below.`;
  } else if (result.reason === "insufficient-stock") {
    stockMessage.textContent = `Only ${stock} available in ${size.label} / ${finish.label}. Lower the quantity to add it.`;
  } else {
    stockMessage.textContent = `${stock} ${size.label} / ${finish.label} available${meshText}`;
  }
  addButton.disabled = !result.available;
  addButton.setAttribute("aria-disabled", String(!result.available));
  return result;
}

function renderBag() {
  const bagContent = $("bag-content");
  $("bag-count").textContent = state.bag ? "1" : "0";
  if (!state.bag) {
    bagContent.innerHTML =
      '<p class="empty-state">Nothing held here yet. Add an available configuration to keep it nearby.</p>';
    return;
  }
  const bagSize = sizeFor(state.bag.size);
  const bagFinish = finishFor(state.bag.finish);
  const meshLine = state.bag.mesh ? ` · ${product.accessory.name}` : "";
  bagContent.innerHTML = `<div class="bag-item"><div><h3>${bagSize.label} / ${bagFinish.label}</h3><p>${state.bag.quantity} rack${state.bag.quantity === 1 ? "" : "s"}${meshLine}</p></div><strong class="bag-item-price">${money(state.bag.result.totalCents)}</strong></div><button class="clear-bag" id="clear-bag" type="button">Clear local bag</button>`;
  $("clear-bag").addEventListener("click", () => {
    state.bag = null;
    renderBag();
    setText("selection-feedback", "Local bag cleared.");
  });
}

function populateProductFacts() {
  setText("hero-intro", product.intro);
  setText("hero-description", product.description);
  $("included-list").innerHTML = product.included.map((item) => `<li>${item}</li>`).join("");
  $("care-list").innerHTML = product.care.map((item) => `<li>${item}</li>`).join("");
  setText("repair-copy", product.repair);
  setText("policy-dispatch", product.delivery.dispatch);
  setText("policy-returns", product.policies.returns);
  setText("policy-warranty", product.policies.warranty);
  setText("policy-tax", product.policies.tax);
  $("faq-list").innerHTML = product.faq
    .map((item) => `<details><summary>${item.q}</summary><p>${item.a}</p></details>`)
    .join("");
  const topicSelect = $("inquiry-topic");
  topicSelect.innerHTML = `<option value="">Choose a topic</option>${product.inquiryTopics
    .map((topic) => `<option value="${topic}">${topic[0].toUpperCase()}${topic.slice(1)}</option>`)
    .join("")}`;
}

function syncFromControls() {
  const selectedSize = document.querySelector('input[name="size"]:checked');
  const selectedFinish = document.querySelector('input[name="finish"]:checked');
  state.size = selectedSize?.value ?? state.size;
  state.finish = selectedFinish?.value ?? state.finish;
  const quantity = Number($("quantity").value);
  state.quantity = Number.isInteger(quantity) ? Math.max(1, Math.min(3, quantity)) : 1;
  $("quantity").value = String(state.quantity);
  state.mesh = $("mesh").checked;
  renderSelectionClasses();
  renderFacts();
  renderEstimate();
}

function showInquiryErrors(errors) {
  const messages = {
    topic: "Choose fit, repair, or availability.",
    question: "Use 10–500 characters after trimming.",
    size: "Choose a supported size.",
    finish: "Choose a supported finish.",
  };
  ["topic", "question", "size", "finish"].forEach((field) => {
    const input = field === "topic" ? $("inquiry-topic") : field === "question" ? $("inquiry-question") : null;
    const error = $(`${field}-error`);
    if (error) error.textContent = errors.includes(field) ? messages[field] : "";
    if (input) input.setAttribute("aria-invalid", String(errors.includes(field)));
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInquiryPreview(preview) {
  const size = sizeFor(preview.size);
  const finish = finishFor(preview.finish);
  const target = $("inquiry-preview");
  target.hidden = false;
  target.innerHTML = `<span class="preview-label">Local preview ready</span><h4>${escapeHtml(preview.topic)} / ${escapeHtml(size.label)} ${escapeHtml(finish.label)}</h4><p class="preview-question">“${escapeHtml(preview.question)}”</p><p class="preview-meta"><span>${escapeHtml(size.label)}</span><span>${escapeHtml(finish.label)}</span><span>not sent</span></p><p class="preview-notice">${escapeHtml(preview.notice)}</p>`;
  target.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function openBag() {
  const panel = $("bag-panel");
  panel.hidden = false;
  $("bag-toggle").setAttribute("aria-expanded", "true");
  $("bag-close").focus();
}

function closeBag() {
  $("bag-panel").hidden = true;
  $("bag-toggle").setAttribute("aria-expanded", "false");
  $("bag-toggle").focus();
}

function wireInteractions() {
  $("selector-form").addEventListener("change", syncFromControls);
  $("quantity").addEventListener("input", syncFromControls);
  $("quantity-decrease").addEventListener("click", () => {
    $("quantity").value = String(Math.max(1, state.quantity - 1));
    syncFromControls();
  });
  $("quantity-increase").addEventListener("click", () => {
    $("quantity").value = String(Math.min(3, state.quantity + 1));
    syncFromControls();
  });
  $("selector-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const result = renderEstimate();
    if (!result.available) return;
    state.bag = { ...selection(), result };
    renderBag();
    setText("selection-feedback", "Added to your local bag. Changing the selector will not change it.");
    openBag();
  });
  $("bag-toggle").addEventListener("click", () => {
    if ($("bag-panel").hidden) openBag();
    else closeBag();
  });
  $("bag-close").addEventListener("click", closeBag);
  $("inquiry-question").addEventListener("input", () =>
    setText("question-count", `${$("inquiry-question").value.length} / 500`),
  );
  $("inquiry-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const response = prepareInquiry(
      {
        topic: $("inquiry-topic").value,
        question: $("inquiry-question").value,
        size: state.size,
        finish: state.finish,
      },
      product,
    );
    showInquiryErrors(response.ok ? [] : response.errors);
    if (!response.ok) {
      $("inquiry-preview").hidden = true;
      return;
    }
    renderInquiryPreview(response.preview);
  });
}

async function init() {
  const response = await fetch("./data/product.json");
  if (!response.ok) throw new Error(`Product data could not be loaded (${response.status})`);
  product = await response.json();
  populateProductFacts();
  wireInteractions();
  renderSelectionClasses();
  renderFacts();
  renderEstimate();
  renderBag();
}

init().catch((error) => {
  document.body.dataset.productError = "true";
  console.error(error);
});
