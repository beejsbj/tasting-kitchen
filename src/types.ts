export type Cuisine = {
  id: string;
  label: string;
  description: string;
};

export type Configuration = {
  id: string;
  label: string;
  provider: string;
  model: string;
  harness: string;
  reasoningEffort: string;
  serviceTier: string;
  personality: string;
  capabilities: string[];
  configHash?: string;
  historical?: boolean;
  executionProfile: {
    id: string;
    label: string;
    runtime: "linux-host";
    sandbox: "danger-full-access";
    approvalPolicy: "never";
    nativeWeb: "disabled";
    networkPolicy: "not-enforced";
    filesystemBoundary: "not-a-secrecy-boundary";
  };
};

export type RecipeTurn = {
  id: string;
  role: "prompt" | "follow-up" | "correction" | "mode-transition";
  content: string;
};

export type RecipeCheck = {
  id: string;
  type: "file-exists" | "command" | "json-schema" | "trace-assertion" | "manual";
  required: boolean;
  description: string;
};

export type Recipe = {
  schemaVersion: 1;
  id: string;
  version: string;
  status: "draft" | "ready" | "hidden";
  title: string;
  summary: string;
  cuisines: string[];
  recipeHash: string;
  presentation?: { profile: string; semanticRuntime: null | { id: string; version: string } };
  origin: "textbook" | "mothers" | "hybrid";
  originNote: string;
  tags: string[];
  kind: "web" | "image" | "code" | "session" | "document" | "audio";
  harness: {
    workspace: "read" | "write";
    web: "disabled" | "enabled" | "closed-sources-only";
    capabilities: string[];
  };
  setup: {
    instructions: string;
    fixtures: Array<{ id: string; path: string; mountAs: string; public: true; mediaType: string; url?: string; sha256?: string }>;
  };
  turns: RecipeTurn[];
  output: { kind: Recipe["kind"]; entry: string; include: string[]; limits: { maxFiles: number; maxBytes: number } };
  validation: { mode: string; checks: RecipeCheck[] };
  variation?: string;
};

export type Dish = {
  schemaVersion: 1;
  id: string;
  recipe: { id: string; version: string; hash: string };
  executedAt: string;
  finalizedAt: string;
  identity: {
    variantId: string;
    provider: string;
    requestedModel: string;
    observedModel: string;
    harness: string;
    harnessVersion: string;
    reasoningEffort: string;
    serviceTier: string;
    requestedServiceTier?: string;
    observedServiceTier?: string;
    configHash: string;
    catalogHash?: string;
  };
  status: "accepted";
  artifact: {
    kind: Recipe["kind"];
    entry: string;
    preview?: string;
    treeHash: string;
    files: Array<{ path: string; sha256: string; bytes: number }>;
  };
  validation: { passed: true; report: string };
  publicTrace?: string;
  dishHash: string;
  artifactBase: string;
};

export type ReviewVerdict = "pass" | "issue" | "inconclusive";

export type ArtifactReviewProbe = {
  id: string;
  device: string;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
  verdict: ReviewVerdict;
  finding: string;
  details?: {
    method?: string;
    path?: string;
    scrollWidth?: number;
    clientWidth?: number;
  };
};

export type ArtifactReview = {
  schemaVersion: 1;
  id: string;
  dishId: string;
  dishHash: string;
  reviewer: string;
  reviewerKind: "human" | "agent";
  reviewedAt: string;
  probes: ArtifactReviewProbe[];
};

export type AxisLevel = { id: string; label: string; description: string };
export type AxisDefinition = {
  id: string;
  label: string;
  question: string;
  levels: AxisLevel[];
  consequentialDistance: number;
};
export type AxisSet = {
  schemaVersion: 1;
  id: string;
  version: string;
  status: "active" | "candidate" | "retired";
  title: string;
  purpose: string;
  adapter: { shape: "conversation" | "agentic" | "journal"; maxBytes: number };
  contexts: Array<{ kind: "recipe" | "menu"; id: string }>;
  axes: AxisDefinition[];
  revisionNote?: string;
  rubricHash: string;
};
export type TasteObservation = {
  schemaVersion: 1;
  id: string;
  dishId: string;
  dishHash: string;
  context: { kind: "recipe" | "menu"; id: string; revisionHash: string };
  axisSet: { id: string; version: string; hash: string };
  source: {
    kind: "human" | "jev";
    evaluator: { id: string; label?: string; provider?: string; model?: string; tool?: string; toolVersion?: string };
  };
  observedAt: string;
  evidenceAdapter: { shape: "conversation" | "agentic" | "journal"; version: 1 };
  axes: Array<{
    axisId: string;
    levelId: string;
    position: number | null;
    confidence: number | null;
    distribution: Array<{ levelId: string; probability: number }> | null;
    evidence: Array<{ path: string; sha256: string | null }>;
    note?: string;
  }>;
  usage?: { inputTokens: number; outputTokens: number };
};

export type Registry = {
  schemaVersion: 2;
  generatedAt: string;
  basePath: string;
  cuisines: Cuisine[];
  tags: string[];
  configurations: Configuration[];
  configurationRevisions?: Array<{ schemaVersion: 1; hash: string; configuration: Configuration }>;
  recipes: Recipe[];
  dishes: Dish[];
  reviews: ArtifactReview[];
  axisSets: AxisSet[];
  observations: TasteObservation[];
  recipeRevisions: RecipeRevision[];
  menus: Menu[];
  menuRevisions: MenuRevision[];
};

export type Variant = Configuration;
export type RecipeRevision = {
  recipeId: string; hash: string; version: string;
  execution: Pick<Recipe, "kind" | "harness" | "setup" | "turns" | "output" | "validation" | "presentation">;
  display: { title: string; summary: string; lineage: Recipe["origin"]; cuisines: string[] };
};
export type Menu = { id: string; title: string; summary?: string; cuisines: string[]; recipes: string[] };
export type MenuRevision = { menuId: string; hash: string; title: string; cuisines: string[]; recipes: Array<{ recipeId: string; recipeHash: string }> };
