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
  /** Layers outermost first when the harness wraps another, such as ["t3", "claude-code"]; absent when it runs alone. */
  harnessPath?: string[];
  configHash?: string;
  historical?: boolean;
  executionProfile: {
    id: string;
    label: string;
    runtime: "linux-host";
    sandbox: string;
    approvalPolicy: string;
    nativeWeb: "disabled";
    networkPolicy: string;
    filesystemBoundary: string;
    /** Absent on configurations that predate the dimension. */
    environment?: "clean" | "snapshot" | "live";
    /** A named harness profile a snapshot copies (such as a Hermes profile). */
    harnessProfile?: string;
    /** Snapshot and live only: whether his memories load. */
    memory?: "on" | "off";
    /** Snapshot and live only: whether his MCP servers and plugins load. */
    connections?: "on" | "off";
    /** An inference route other than the provider's own, such as "openrouter"; absent means the provider's own. */
    route?: string;
    /** The OpenRouter upstream provider slug the route is pinned to, with no fallbacks. */
    upstream?: string;
  };
};

export type Skill = {
  id: string;
  label: string;
  summary: string;
  entry: string;
  delivery?: "workspace" | "prompt";
  source: { repository: string; commit: string; path: string; license: string };
  skillHash: string;
};

export type RecipeSkills = { mountAs?: string; optional: boolean; layers: string[] };

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
  visibility?: "public" | "private";
  title: string;
  summary: string;
  cuisines: string[];
  recipeHash: string;
  skills?: RecipeSkills;
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
    fixtures: Array<{ id: string; path: string; mountAs: string; public: boolean; mediaType: string; url?: string; sha256?: string }>;
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
  skill?: { id: string; hash: string };
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
    /** Which version of his setup a snapshot Dish saw; snapshot Repeats share it. */
    setupDigest?: string;
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
  /** What the model received, from the Dish's own inputs.json. Absent for a Dish published before sidecars. */
  inputs?: { fixtures: DishInput[] };
  /** Public notes recorded beside the Dish after it was cooked (catalog/dish-notes.json). */
  notes?: DishNote[];
  /** The full configuration and skill source the Dish ran as, from receipt.json. */
  receipt?: { schemaVersion: 1; configuration: Configuration; setup?: SetupReceipt; skill: (NonNullable<Dish["skill"]> & { source: Skill["source"]; entry: string; treeHash: string }) | null };
};

/** What a snapshot or live Dish's receipt says about the setup it ran with. */
export type SetupReceipt = {
  environment: "snapshot" | "live";
  harnessProfile?: string;
  memory: "on" | "off";
  connections: "on" | "off";
  digest?: string;
  digestAtStart?: string;
  entries?: Array<{ entry: string; files: number; bytes: number; digest: string }>;
  toolsets?: string;
  loaded?: { mcpServers: string[]; plugins: string[] };
};

export type DishNote = { id: string; text: string; link?: string };

/** Why a configuration could not make the Recipe. Only chef faults are ever public. */
export type ChefFaultCode = "checks-failed" | "output-contract" | "refused" | "out-of-turns";

/**
 * The public plate of a chef fault: the configuration was given the Recipe and
 * could not make it. Sits at recipe hash × configuration × skill layer like a
 * Dish and covers its cell. Kitchen faults never appear here.
 */
export type NoDish = {
  schemaVersion: 1;
  id: string;
  outcome: "no-dish";
  recipe: Dish["recipe"];
  skill?: Dish["skill"];
  executedAt: string;
  failedAt: string;
  identity: Omit<Dish["identity"], "observedModel" | "harnessVersion" | "requestedServiceTier" | "observedServiceTier"> & { observedModel: string | null; harnessVersion: string | null };
  fault: { class: "chef"; code: ChefFaultCode; stage: "execution" | "validation"; reason: string; turn?: string; checks?: string[] };
  validation: { passed: false; report: string } | null;
  publicTrace: string | null;
  artifact: { kind: Recipe["kind"]; entry?: string; treeHash: string; files: Array<{ path: string; sha256: string; bytes: number }>; partial: true } | null;
  noDishHash: string;
  artifactBase: string;
  inputs?: Dish["inputs"];
  receipt?: Dish["receipt"];
};

/** A Dish or a No Dish: what a cell of the counter holds. */
export type Plate = Dish | NoDish;

/** A judge's pass or fail beside a Dish. Burooj (owner) outranks every automated check. */
export type Verdict = {
  schemaVersion: 1;
  id: string;
  dishId: string;
  dishHash: string;
  judge: { kind: "owner"; name: string };
  verdict: "failed" | "passed";
  note: string;
  decidedAt: string;
};

export type DishInput = { id: string; path: string; mountAs: string; public: boolean; editable: boolean; mediaType?: string; sha256: string; bytes: number; url?: string };

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
  schemaVersion: 3;
  generatedAt: string;
  basePath: string;
  cuisines: Cuisine[];
  tags: string[];
  configurations: Configuration[];
  skills?: Skill[];
  recipes: Recipe[];
  dishes: Dish[];
  /** Absent in registries built before No Dishes existed. */
  noDishes?: NoDish[];
  verdicts?: Verdict[];
  reviews: ArtifactReview[];
  axisSets: AxisSet[];
  observations: TasteObservation[];
  menus: Menu[];
};

export type Variant = Configuration;
export type Menu = { id: string; title: string; summary?: string; cuisines: string[]; recipes: string[] };
