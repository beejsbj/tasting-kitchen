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

export type Registry = {
  schemaVersion: 2;
  generatedAt: string;
  basePath: string;
  cuisines: Cuisine[];
  tags: string[];
  configurations: Configuration[];
  recipes: Recipe[];
  dishes: Dish[];
  reviews: ArtifactReview[];
  recipeRevisions: RecipeRevision[];
  menus: Menu[];
  menuRevisions: MenuRevision[];
};

export type Variant = Configuration;
export type RecipeRevision = {
  recipeId: string; hash: string; version: string;
  execution: Pick<Recipe, "kind" | "harness" | "setup" | "turns" | "output" | "validation">;
  display: { title: string; summary: string; lineage: Recipe["origin"]; cuisines: string[] };
};
export type Menu = { id: string; title: string; summary?: string; cuisines: string[]; recipes: string[] };
export type MenuRevision = { menuId: string; hash: string; title: string; cuisines: string[]; recipes: Array<{ recipeId: string; recipeHash: string }> };
