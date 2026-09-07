import {
  createPageSection,
  createButton,
  createBadge,
  createTabs,
  createTabsList,
  createTabsTrigger,
  createTabsPanel,
  createColorSwatch,
  createListingCard,
  formatSats,
} from "./src/conduit-primitives.js";

import {
  LISTING,
  createListingProvenanceInspector,
  createCompactProvenanceCue,
} from "./src/listing-provenance.js";

const BUTTON_VARIANTS = [
  "primary",
  "secondary",
  "muted",
  "outline",
  "destructive",
  "ghost",
  "link",
  "accent",
];

const COLOR_GROUPS = [
  {
    title: "Base",
    swatches: [
      ["paper", "--color-paper"],
      ["ink", "--color-ink"],
      ["50", "--base-50"],
      ["500", "--base-500"],
      ["800", "--base-800"],
      ["950", "--base-950"],
    ],
  },
  {
    title: "Primary",
    swatches: [
      ["500", "--primary-500"],
      ["600", "--color-primary"],
      ["foreground", "--color-primary-foreground", "--color-primary"],
    ],
  },
  {
    title: "Secondary",
    swatches: [
      ["500", "--secondary-500"],
      ["600", "--color-secondary"],
      ["foreground", "--color-secondary-foreground", "--color-secondary"],
    ],
  },
  {
    title: "Tertiary",
    swatches: [
      ["500", "--tertiary-500"],
      ["600", "--color-tertiary"],
      ["foreground", "--color-tertiary-foreground", "--color-tertiary"],
    ],
  },
  {
    title: "Accent",
    swatches: [
      ["500", "--accent-500"],
      ["600", "--color-accent"],
      ["foreground", "--color-accent-foreground", "--color-accent"],
    ],
  },
  {
    title: "Status",
    swatches: [
      ["success", "--color-success", "--color-success-foreground"],
      ["warning", "--color-warning", "--color-warning-foreground"],
      ["info", "--color-info", "--color-info-foreground"],
      ["destructive", "--color-destructive", "--color-destructive-foreground"],
    ],
  },
];

function appendHeading(parent, level, className, text) {
  const heading = document.createElement(`h${level}`);
  heading.className = className;
  heading.textContent = text;
  parent.appendChild(heading);
  return heading;
}

function appendParagraph(parent, className, text) {
  const paragraph = document.createElement("p");
  paragraph.className = className;
  paragraph.textContent = text;
  parent.appendChild(paragraph);
  return paragraph;
}

function renderColorGuide(container) {
  const region = document.createElement("div");
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", "Color guide");
  appendHeading(region, 2, "voice-3l", "Colors");

  for (const group of COLOR_GROUPS) {
    const block = document.createElement("section");
    block.className = "styleguide-group";
    appendHeading(block, 3, "voice-lg", `${group.title} colors`);
    appendParagraph(block, "voice-xs font-mono text-muted", `--color-${group.title.toLowerCase()}`);

    const grid = document.createElement("div");
    grid.className = "styleguide-swatch-grid";
    for (const entry of group.swatches) {
      const [name, cssVar, foregroundVar] = entry;
      grid.appendChild(createColorSwatch(name, cssVar, foregroundVar));
    }
    block.appendChild(grid);
    region.appendChild(block);
  }

  container.appendChild(region);
}

function renderTypographyGuide(container) {
  const region = document.createElement("div");
  region.className = "styleguide-group";
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", "Typography guide");
  appendHeading(region, 2, "voice-3l", "Typography & voices");

  const samples = [
    ["voice-xs", "Micro voice for compact labels"],
    ["voice-sm whisper-voice", "Whisper voice for supporting detail"],
    ["voice-base calm-voice", "Calm voice for body copy"],
    ["voice-lg notice-voice", "Notice voice for section labels"],
    ["voice-2l firm-voice", "Firm voice for card titles"],
    ["voice-3l attention-voice", "Attention voice for guide headings"],
    ["voice-5l loud-voice", "Loud display voice"],
    ["voice-6l booming-voice", "Booming display voice"],
  ];

  for (const [className, text] of samples) {
    const sample = document.createElement("p");
    sample.className = className;
    sample.textContent = text;
    region.appendChild(sample);
  }

  const mono = document.createElement("p");
  mono.className = "voice-sm";
  mono.innerHTML = "Monospace sample: <code>21000 sats</code>";
  region.appendChild(mono);

  container.appendChild(region);
}

function renderButtonGuide(container) {
  const region = document.createElement("div");
  region.className = "styleguide-stack";
  appendHeading(region, 2, "voice-3l", "Buttons");

  const variants = document.createElement("section");
  variants.className = "styleguide-group";
  appendHeading(variants, 3, "voice-2l", "Variants");
  const variantRow = document.createElement("div");
  variantRow.className = "styleguide-row";
  for (const variant of BUTTON_VARIANTS) {
    variantRow.appendChild(createButton({ variant, label: variant }));
  }
  variants.appendChild(variantRow);
  region.appendChild(variants);

  const sizes = document.createElement("section");
  sizes.className = "styleguide-group";
  appendHeading(sizes, 3, "voice-2l", "Sizes");
  const sizeRow = document.createElement("div");
  sizeRow.className = "styleguide-row";
  sizeRow.append(
    createButton({ size: "sm", label: "Small" }),
    createButton({ size: "md", label: "Default" }),
    createButton({ size: "lg", label: "Large" })
  );
  sizes.appendChild(sizeRow);
  region.appendChild(sizes);

  const badges = document.createElement("section");
  badges.className = "styleguide-group";
  appendHeading(badges, 3, "voice-2l", "Badge treatment");
  const badgeRow = document.createElement("div");
  badgeRow.className = "styleguide-row";
  for (const variant of ["primary", "secondary", "muted", "success", "warning", "destructive"]) {
    badgeRow.appendChild(createBadge({ variant, label: variant }));
  }
  badges.appendChild(badgeRow);
  region.appendChild(badges);

  container.appendChild(region);
}

function renderListingContexts(container) {
  const region = document.createElement("div");
  region.className = "styleguide-stack";
  appendHeading(region, 2, "voice-3l", "Listing contexts");
  appendParagraph(
    region,
    "voice-sm text-muted",
    "Three buyer-facing surfaces for the same listing: market card, saved card, and provenance inspection."
  );

  const grid = document.createElement("div");
  grid.className = "styleguide-context-grid";

  const listingSection = document.createElement("section");
  listingSection.className = "styleguide-group";
  appendHeading(listingSection, 3, "voice-lg", "Listing");
  appendParagraph(
    listingSection,
    "voice-sm text-muted",
    "Present a market listing with sats price, seller, and a compact provenance cue."
  );
  const listingCard = createListingCard({
    title: LISTING.title,
    seller: LISTING.seller,
    priceSats: LISTING.priceSats,
    provenanceLabel: "Verified",
    provenanceVariant: "success",
  });
  listingCard.querySelector(".conduit-listing-card__provenance")?.replaceWith(
    createCompactProvenanceCue("signed")
  );
  listingSection.appendChild(listingCard);
  grid.appendChild(listingSection);

  const savedSection = document.createElement("section");
  savedSection.className = "styleguide-group";
  appendHeading(savedSection, 3, "voice-lg", "Saved");
  appendParagraph(
    savedSection,
    "voice-sm text-muted",
    "Same listing when a buyer has saved it, with a quiet action."
  );
  savedSection.appendChild(
    createListingCard({
      title: LISTING.title,
      seller: LISTING.seller,
      priceSats: LISTING.priceSats,
      saved: true,
      action: createButton({
        variant: "ghost",
        size: "sm",
        label: "Remove from saved",
      }),
    })
  );
  grid.appendChild(savedSection);

  const inspectionSection = document.createElement("section");
  inspectionSection.className = "styleguide-group styleguide-context--wide";
  appendHeading(inspectionSection, 3, "voice-lg", "Inspection");
  appendParagraph(
    inspectionSection,
    "voice-sm text-muted",
    "Inspect three local provenance samples and read their state in text."
  );

  const inspectorHost = document.createElement("div");
  const inspector = createListingProvenanceInspector(inspectorHost);
  inspectionSection.appendChild(inspectorHost);

  const apiBlock = document.createElement("div");
  apiBlock.className = "styleguide-api";
  appendHeading(apiBlock, 4, "voice-lg", "Public API");
  const apiPre = document.createElement("pre");
  apiPre.textContent = [
    "createListingProvenanceInspector(container, options?)",
    "  options.samples   — provenance sample objects",
    "  options.initialId — starting sample id",
    "  options.onChange  — callback when selection changes",
    "",
    "returns {",
    "  getSelectedId(),",
    "  getSelectedSample(),",
    "  selectSample(id),",
    "  element",
    "}",
  ].join("\n");
  apiBlock.appendChild(apiPre);

  const statesBlock = document.createElement("div");
  statesBlock.className = "styleguide-api";
  appendHeading(statesBlock, 4, "voice-lg", "Sample states");
  const statesList = document.createElement("ul");
  statesList.className = "voice-sm";
  for (const sample of LISTING.samples) {
    const item = document.createElement("li");
    item.textContent = `${sample.label}: state "${sample.state}" — ${sample.detail}`;
    statesList.appendChild(item);
  }
  statesBlock.appendChild(statesList);

  inspectionSection.append(apiBlock, statesBlock);
  grid.appendChild(inspectionSection);

  region.appendChild(grid);
  container.appendChild(region);

  return inspector;
}

function mountStyleGuide() {
  const app = document.getElementById("app");
  const main = document.createElement("main");
  main.id = "main-content";
  main.className = "styleguide-root";

  const heroSection = createPageSection({ width: "wide" });
  const hero = document.createElement("div");
  hero.className = "styleguide-intro";
  appendHeading(hero, 1, "voice-6l", "Conduit Style Guide");
  appendParagraph(
    hero,
    "text-muted voice-base",
    "Adapted tokens, primitives, and listing provenance for Conduit Market."
  );
  appendParagraph(
    hero,
    "voice-sm text-muted",
    `${LISTING.title} · ${LISTING.seller} · ${formatSats(LISTING.priceSats)}`
  );
  heroSection._inner.appendChild(hero);
  main.appendChild(heroSection);

  const tabs = createTabs({ defaultValue: "design-system" });
  const tabListSection = createPageSection({ width: "wide", gap: "none" });
  const tabList = createTabsList();
  const tabDefs = [
    ["design-system", "Design System"],
    ["colors", "Colors"],
    ["voices", "Typography"],
    ["buttons", "Buttons"],
    ["listings", "Listings"],
  ];

  for (const [value, label] of tabDefs) {
    tabList.appendChild(createTabsTrigger(tabs, { value, label }));
  }
  tabListSection._inner.appendChild(tabList);
  tabs.appendChild(tabListSection);

  const designPanel = createTabsPanel(tabs, {
    value: "design-system",
    className: "styleguide-stack",
  });
  const designSection = createPageSection({ width: "wide" });
  renderColorGuide(designSection._inner);
  renderTypographyGuide(designSection._inner);
  designPanel.appendChild(designSection);
  tabs.appendChild(designPanel);

  const colorsPanel = createTabsPanel(tabs, { value: "colors" });
  const colorsSection = createPageSection({ width: "wide" });
  renderColorGuide(colorsSection._inner);
  colorsPanel.appendChild(colorsSection);
  tabs.appendChild(colorsPanel);

  const voicesPanel = createTabsPanel(tabs, { value: "voices" });
  const voicesSection = createPageSection({ width: "wide" });
  renderTypographyGuide(voicesSection._inner);
  voicesPanel.appendChild(voicesSection);
  tabs.appendChild(voicesPanel);

  const buttonsPanel = createTabsPanel(tabs, { value: "buttons" });
  const buttonsSection = createPageSection({ width: "wide" });
  renderButtonGuide(buttonsSection._inner);
  buttonsPanel.appendChild(buttonsSection);
  tabs.appendChild(buttonsPanel);

  const listingsPanel = createTabsPanel(tabs, { value: "listings" });
  const listingsSection = createPageSection({ width: "wide" });
  renderListingContexts(listingsSection._inner);
  listingsPanel.appendChild(listingsSection);
  tabs.appendChild(listingsPanel);

  main.appendChild(tabs);
  app.replaceChildren(main);
}

mountStyleGuide();
