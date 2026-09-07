import {
  Badge,
  Button,
  CONDUIT_PRIMITIVE_API,
  PageSection,
  Tabs
} from "./src/conduit-primitives.js";
import {
  createListingProvenanceInspector,
  LISTING_PROVENANCE_API,
  PROVENANCE_SAMPLES,
  PROVENANCE_STATES
} from "./src/listing-provenance.js";

const app = document.querySelector("#app");

function el(tagName, className = "", text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function append(parent, ...children) {
  children.flat(Infinity).forEach((child) => {
    if (child !== null && child !== undefined && child !== false) parent.append(child);
  });
  return parent;
}

function activateGuideTab(value) {
  const trigger = document.querySelector(`.tabs__trigger[data-value="${value}"]`);
  trigger?.click();
  trigger?.scrollIntoView({ block: "start", behavior: "auto" });
}

function buildHeader() {
  const header = el("header", "site-header");
  const inner = el("div", "site-header__inner");
  const wordmark = el("a", "wordmark");
  wordmark.href = "#guide";
  append(wordmark, document.createTextNode("CONDUIT"), el("span", "wordmark__sub", "MARKET"));
  append(
    inner,
    wordmark,
    el("p", "header-meta", "static-web / system 01")
  );
  header.append(inner);
  return header;
}

function buildHero() {
  const grid = el("div", "hero__grid");
  const copy = el("div", "hero__copy");
  const eyebrow = el("p", "eyebrow", "Conduit Market / browser-native extension");
  const title = el("h1", "hero__title voice-6l");
  append(title, document.createTextNode("Make every " ), el("em", "", "market signal"), document.createTextNode(" legible."));
  const lede = el(
    "p",
    "hero__lede",
    "A compact language for listings, saved objects, and the local evidence around them — carried from the Conduit source snapshot into a dependency-free guide."
  );
  const actions = el("div", "hero__actions");
  append(
    actions,
    Button({
      label: "Open listing contexts",
      variant: "primary",
      size: "lg",
      onClick: () => activateGuideTab("contexts")
    }),
    Button({
      label: "Read the tokens",
      variant: "outline",
      onClick: () => activateGuideTab("tokens")
    })
  );
  const readout = el("div", "hero__readout");
  append(
    readout,
    el("span", "", "Frozen direction"),
    el("strong", "", "signal board / violet object / local state")
  );
  append(copy, eyebrow, title, lede, actions, readout);

  const signalCard = el("aside", "hero__signal-card");
  const signalTop = el("div", "signal-card__top");
  const signalCopy = el("div", "stack-sm");
  append(signalCopy, el("p", "", "system readout"), el("strong", "", "Roles, not recipes."));
  append(signalTop, signalCopy, Badge({ label: "LOCAL", variant: "secondary" }));
  const rail = el("div", "signal-rail");
  ["primary", "secondary", "tertiary", "accent"].forEach((role) => {
    const bar = el("span");
    bar.dataset.role = role;
    rail.append(bar);
  });
  const signalBottom = el("div", "signal-card__bottom");
  append(
    signalBottom,
    el("p", "", "paper / ink base\npurple / orange / rose / indigo"),
    el("p", "", "4 roles\n1 local feature")
  );
  append(signalCard, signalTop, rail, signalBottom);

  const heroGrid = append(grid, copy, signalCard);
  return PageSection({ sectionClassName: "hero-section", children: heroGrid });
}

function buildPanelHeading(kicker, title, copy) {
  const heading = el("div", "panel-heading");
  append(
    heading,
    el("p", "section-kicker", kicker),
    el("h2", "panel-heading__title voice-3l", title),
    el("p", "panel-heading__copy", copy)
  );
  return heading;
}

function buildTokensPanel() {
  const panel = el("section", "guide-panel");
  append(
    panel,
    buildPanelHeading(
      "Tokens / semantic roles",
      "A dark paper with a clear signal path.",
      "The upstream hue families remain distinct. The browser layer adds semantic aliases so every surface, control, and state can read back to a role instead of a one-off value."
    )
  );

  const roleGrid = el("div", "role-grid");
  const roles = [
    { name: "Primary", token: "--role-primary", variable: "var(--role-primary)", note: "Action / emphasis" },
    { name: "Secondary", token: "--role-secondary", variable: "var(--role-secondary)", note: "Quiet energy / saved" },
    { name: "Tertiary", token: "--role-tertiary", variable: "var(--role-tertiary)", note: "Review / local state" },
    { name: "Accent", token: "--role-accent", variable: "var(--role-accent)", note: "Navigation / orientation" }
  ];
  roles.forEach((role) => {
    const card = el("article", "role-card");
    const swatch = el("div", "role-card__swatch");
    swatch.style.setProperty("--swatch", role.variable);
    swatch.setAttribute("role", "img");
    swatch.setAttribute("aria-label", `${role.name} color role`);
    append(
      card,
      swatch,
      el("h3", "role-card__name", role.name),
      el("p", "role-card__token", role.token),
      el("p", "role-card__note", role.note)
    );
    roleGrid.append(card);
  });

  const toneBand = el("div", "tone-band");
  [
    ["paper", "var(--paper)"],
    ["ink", "var(--ink)"],
    ["surface", "var(--surface)"],
    ["raised", "var(--surface-raised)"],
    ["sunken", "var(--surface-sunken)"]
  ].forEach(([label, tone]) => {
    const chip = el("span", "tone-chip", label);
    chip.style.setProperty("--tone", tone);
    toneBand.append(chip);
  });

  const typeScale = el("div", "type-scale");
  const typeRows = [
    ["voice-6l", "booming", "A market signal"],
    ["voice-4l", "display", "Hand-thrown violet cup"],
    ["voice-2l", "firm", "Juniper Works"],
    ["voice-lg", "notice", "Received from a selected relay"],
    ["voice-sm", "solid", "21,000 sats · local sample"]
  ];
  typeRows.forEach(([className, name, sample]) => {
    const row = el("div", "type-row");
    const meta = el("span", "type-row__meta", name);
    const specimen = el("span", `type-row__sample ${className}`, sample);
    append(row, meta, specimen);
    typeScale.append(row);
  });

  const typeHeading = el("div", "stack-sm");
  append(
    typeHeading,
    el("h3", "voice-2l", "Rounded display / sans body / mono evidence"),
    el("p", "muted-copy", "The voice scale keeps the object name warm and legible while metadata stays precise and inspectable.")
  );
  append(panel, roleGrid, toneBand, typeHeading, typeScale);
  return panel;
}

function buildPrimitivesPanel() {
  const panel = el("section", "guide-panel");
  append(
    panel,
    buildPanelHeading(
      "Primitives / imported behavior",
      "The small parts keep their contracts.",
      "Buttons, badges, tabs, and the readable section shell are real browser modules. This page calls their public APIs; it does not repeat their internals in the specimen."
    )
  );

  const feedback = el("div", "demo-feedback", "Last interaction: none — try a control.");
  const buttonSection = el("div", "stack-md");
  append(buttonSection, el("h3", "voice-2l", "Button variants"));
  const buttonGrid = el("div", "button-grid");
  const variants = ["primary", "secondary", "accent", "muted", "ink", "outline", "ghost", "destructive", "link"];
  variants.forEach((variant) => {
    const specimen = el("article", "button-specimen");
    const label = el("p", "button-specimen__label", variant);
    const button = Button({
      label: variant === "link" ? "Read link" : "Use action",
      variant,
      onClick: () => {
        feedback.textContent = `Last interaction: ${variant} button`;
      }
    });
    append(specimen, label, button);
    buttonGrid.append(specimen);
  });
  append(buttonSection, buttonGrid, feedback);

  const stateSection = el("div", "stack-md");
  append(stateSection, el("h3", "voice-2l", "Sizes, geometry, and states"));
  const buttonRow = el("div", "button-row");
  append(
    buttonRow,
    Button({ label: "Small", size: "sm", variant: "secondary" }),
    Button({ label: "Default", size: "md", variant: "primary" }),
    Button({ label: "Large", size: "lg", variant: "accent" }),
    Button({ label: "Square", size: "icon", rounded: false, variant: "outline", ariaLabel: "Square action" }),
    Button({ label: "Disabled", variant: "primary", disabled: true })
  );
  append(stateSection, buttonRow);

  const badgeSection = el("div", "stack-md");
  append(badgeSection, el("h3", "voice-2l", "Compact Badge treatment"));
  const badgeRow = el("div", "button-row");
  [
    ["primary", "Primary"],
    ["secondary", "Saved"],
    ["tertiary", "Review"],
    ["muted", "Local"]
  ].forEach(([variant, label]) => badgeRow.append(Badge({ variant, label })));
  append(badgeSection, badgeRow);

  const anatomy = el("div", "anatomy-grid");
  const buttonAnatomy = el("article", "anatomy-card");
  append(
    buttonAnatomy,
    el("h3", "", "Button anatomy"),
    el("p", "", "Root control → optional label/icon slot."),
    el("p", "", "Tokens: role fill, ink foreground, control height, pill or square radius, focus ring."),
    el("p", "", "States: rest, hover, active, focus-visible, disabled, pressed.")
  );
  const tabsAnatomy = el("article", "anatomy-card");
  append(
    tabsAnatomy,
    el("h3", "", "Tabs anatomy"),
    el("p", "", "Root → tablist → roving tab triggers → one visible tabpanel."),
    el("p", "", "Tokens: mono labels, accent underline, readable sticky rail, focus ring."),
    el("p", "", "States: rest, hover, selected, keyboard focus; Arrow/Home/End navigation.")
  );
  append(anatomy, buttonAnatomy, tabsAnatomy);

  const measureSection = el("div", "stack-md");
  append(
    measureSection,
    el("h3", "voice-2l", "PageSection-like reading widths"),
    el("p", "muted-copy", "Every guide panel sits in a wide, centered shell; narrower contracts remain available for readable content.")
  );
  const measureGrid = el("div", "measure-grid");
  [
    ["wide", "80rem"],
    ["normal", "64rem"],
    ["narrow", "48rem"],
    ["xNarrow", "36rem"]
  ].forEach(([name, width]) => {
    const card = el("article", "measure-card");
    append(card, el("span", "label-caps", name), el("p", "muted-copy mono", width), el("div", "measure-card__line"));
    measureGrid.append(card);
  });
  append(measureSection, measureGrid);

  append(panel, buttonSection, stateSection, badgeSection, anatomy, measureSection);
  return panel;
}

function buildListingCard({ saved = false } = {}) {
  const listing = el("div", "listing-card");
  const art = el("div", "listing-art");
  art.setAttribute("role", "img");
  art.setAttribute("aria-label", "Abstract violet cup illustration");
  art.append(el("span", "listing-art__mark", "J/W"));

  const details = el("div", "listing-details");
  const heading = el("div", "stack-sm");
  append(
    heading,
    el("p", "section-kicker", saved ? "market / saved" : "market / listing"),
    el("h3", "listing-details__title", "Hand-thrown violet cup"),
    el("p", "listing-details__seller", "Juniper Works")
  );

  const footer = el("div", "listing-details__footer");
  const price = el("div", "price");
  append(price, el("strong", "price__value", "21,000"), el("span", "price__unit", "sats"));
  if (!saved) {
    append(footer, price, Button({ label: "Inspect", variant: "primary", size: "sm" }));
  } else {
    let isSaved = true;
    const savedAction = Button({
      label: "Saved",
      variant: "ghost",
      size: "sm",
      pressed: true,
      ariaLabel: "Toggle saved listing",
      onClick: () => {
        isSaved = !isSaved;
        savedAction.textContent = isSaved ? "Saved" : "Save listing";
        savedAction.setAttribute("aria-pressed", String(isSaved));
        savedAction.dataset.pressed = String(isSaved);
        savedNote.textContent = isSaved ? "Saved locally · quiet action" : "Not saved · quiet action";
      }
    });
    const savedNote = el("div", "saved-note", "Saved locally · quiet action");
    append(details, heading, savedNote);
    append(footer, price, savedAction);
  }
  if (!saved) append(details, heading);
  append(details, footer);
  append(listing, art, details);
  return listing;
}

function buildContextsPanel() {
  const panel = el("section", "guide-panel");
  append(
    panel,
    buildPanelHeading(
      "Listing contexts / local feature",
      "One violet cup, three ways to read it.",
      "The listing and saved states keep the market object familiar. Inspection adds a text-first provenance readout for the three supplied local samples."
    )
  );

  const contexts = el("div", "contexts-grid");
  const listingCard = el("article", "context-card");
  const listingHeader = el("div", "context-card__header");
  const listingHeading = el("div", "context-card__heading");
  append(listingHeading, el("p", "section-kicker", "Context 01"), el("h3", "context-card__title", "Listing"));
  append(listingHeader, listingHeading, Badge({ label: "LISTING", variant: "primary" }));
  append(listingCard, listingHeader, el("p", "context-card__copy", "A market listing with sats price, seller, and a compact provenance cue."), buildListingCard());

  const savedCard = el("article", "context-card");
  const savedHeader = el("div", "context-card__header");
  const savedHeading = el("div", "context-card__heading");
  append(savedHeading, el("p", "section-kicker", "Context 02"), el("h3", "context-card__title", "Saved"));
  append(savedHeader, savedHeading, Badge({ label: "SAVED", variant: "secondary" }));
  append(savedCard, savedHeader, el("p", "context-card__copy", "The same listing after a buyer saves it, with a quiet reversible action."), buildListingCard({ saved: true }));

  const inspectionCard = el("article", "context-card context-card--wide");
  const inspectionHeader = el("div", "context-card__header");
  const inspectionHeading = el("div", "context-card__heading");
  append(inspectionHeading, el("p", "section-kicker", "Context 03"), el("h3", "context-card__title", "Inspection"));
  append(inspectionHeader, inspectionHeading, Badge({ label: "LOCAL ONLY", variant: "tertiary" }));
  const inspectionCopy = el("p", "context-card__copy", "Choose a sample with pointer or keyboard. The visible label, detail, and text state stay synchronized without a request.");
  const inspectorMount = el("div");
  const inspector = createListingProvenanceInspector({
    container: inspectorMount,
    samples: PROVENANCE_SAMPLES,
    initialId: "signed"
  });
  inspectorMount.dataset.component = inspector.root.className;

  const stateSection = el("div", "stack-md");
  append(stateSection, el("h4", "label-caps", "State matrix"));
  const stateRow = el("div", "button-row");
  PROVENANCE_STATES.forEach((state) => {
    const stateItem = el("div", "stack-sm");
    append(stateItem, Badge({ label: state.label, variant: state.id }), el("p", "muted-copy voice-sm", state.note));
    stateRow.append(stateItem);
  });

  const apiBlock = el("div", "api-block");
  append(apiBlock, el("h4", "api-block__title", "Public API"));
  const apiList = el("ul", "api-list");
  [
    ["component", LISTING_PROVENANCE_API.component],
    ["mount", LISTING_PROVENANCE_API.mount],
    ["methods", LISTING_PROVENANCE_API.methods.join(" · ")],
    ["boundary", LISTING_PROVENANCE_API.boundary]
  ].forEach(([term, value]) => {
    const item = el("li");
    append(item, el("code", "", term), el("span", "", value));
    apiList.append(item);
  });
  append(apiBlock, apiList);

  append(inspectionCard, inspectionHeader, inspectionCopy, inspectorMount, stateSection, apiBlock);
  append(contexts, listingCard, savedCard, inspectionCard);
  append(panel, contexts);
  return panel;
}

function buildGuide() {
  const intro = el("div", "guide-intro");
  intro.id = "guide";
  append(
    intro,
    el("p", "section-kicker", "Styleguide / adapted language"),
    el("h2", "guide-intro__title voice-3l", "A market system with its evidence visible."),
    el("p", "guide-intro__copy", "Explore the semantic roles, the imported primitives, and the local listing feature that extends them.")
  );

  const tabs = Tabs({
    items: [
      { value: "contexts", label: "Contexts" },
      { value: "tokens", label: "Tokens & voices" },
      { value: "primitives", label: "Primitives" }
    ],
    initialValue: "contexts",
    label: "Conduit styleguide sections",
    renderPanel: (value) => {
      if (value === "tokens") return buildTokensPanel();
      if (value === "primitives") return buildPrimitivesPanel();
      return buildContextsPanel();
    }
  });
  tabs.root.id = "guide-tabs";

  const footer = el("div", "footer-note");
  const footerLeft = el("span");
  append(footerLeft, document.createTextNode("Conduit Market / "), el("strong", "", "local browser artifact"));
  append(
    footer,
    footerLeft,
    el("span", "", "No relay · account · inventory · payment requests")
  );

  return PageSection({ sectionClassName: "guide-shell", children: [intro, tabs.root, footer] });
}

function mount() {
  if (!app) throw new Error("Styleguide mount is missing #app");
  const shell = el("div", "app-shell");
  append(shell, buildHeader(), buildHero(), buildGuide());
  app.replaceChildren(shell);
}

mount();

export { mount };
