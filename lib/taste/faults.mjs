/**
 * Every failed Run lands in exactly one class.
 *
 * - A **chef fault** is the configuration's own doing: its output failed the
 *   Recipe's required checks, it broke the output contract, it refused, or it
 *   ran past the time or turn budget the Recipe declared (budget.mjs). A chef
 *   fault becomes a public No Dish.
 * - A **kitchen fault** is anything else: login, a changed CLI or protocol,
 *   network, an unavailable provider, rate limits, identity drift caused by the
 *   route, a crash in Kitchen code. It stays private and the cell stays open
 *   for fill-missing to retry.
 *
 * A chef fault is never inferred from a message. It exists only where a throw
 * site or an adapter tags it from structured evidence (`chefFault`). Every
 * untagged failure is a kitchen fault, so an ambiguous failure never stains the
 * model. Kitchen codes are read from the message only to give a plain reason;
 * getting one wrong costs nothing, because none of them is ever public.
 */

export const FAULT_CLASSES = ["chef", "kitchen"];

// These sentences are permanent. `fault.reason` sits inside each No Dish's hash and is
// checked against this text on load, so editing one orphans every plate of that code
// (and the verdicts pinned to them). Add a new code instead of rewording an old one.
export const CHEF_FAULTS = {
  "checks-failed": "The output did not pass the Recipe's required checks.",
  "output-contract": "The output broke the Recipe's output contract.",
  refused: "The model declined the Recipe.",
  "out-of-turns": "The model ran out of turns before it finished.",
  "out-of-time": "The model ran past the Recipe's time budget before it finished.",
};

/** The chef faults that spend a Recipe's declared budget, and the budget key each spends. */
export const BUDGET_FAULTS = { "out-of-time": "seconds", "out-of-turns": "modelTurns" };

export const KITCHEN_FAULTS = {
  auth: "Kitchen could not sign in to the provider.",
  "rate-limited": "The provider rate-limited or throttled the Run.",
  network: "The network failed between Kitchen and the provider.",
  "provider-unavailable": "The provider or its route was unavailable.",
  timeout: "A Kitchen time limit ended the Run; a slow model and a hung route cannot be told apart.",
  "harness-limit": "A limit the Recipe did not declare ended the Run.",
  "identity-drift": "The route served a different model, tier or upstream than requested.",
  "harness-changed": "The harness answered in a shape Kitchen does not recognise.",
  "validator-error": "A required check could not run.",
  preparation: "Kitchen could not prepare the workspace or harness.",
  publication: "Kitchen could not publish the result safely.",
  interrupted: "The Cook was interrupted.",
  "kitchen-error": "Kitchen failed for a reason it could not attribute to the model.",
};

const KITCHEN_PATTERNS = [
  ["rate-limited", /rate.?limit|\b429\b|too many requests|quota|throttl|usage limit|free.?tier|credits?\b.*(?:exhaust|insufficient)/iu],
  ["auth", /\b401\b|\b403\b|unauthori[sz]ed|forbidden|log ?in|credential|access token|api key|OPENROUTER_API_KEY|auth source|oauth/iu],
  ["timeout", /no response within|timed? ?out|deadline|SIGKILL/iu],
  ["network", /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|socket hang up|fetch failed|network/iu],
  ["provider-unavailable", /\b5\d\d\b|overloaded|unavailable|no endpoints?|capacity|bad gateway/iu],
  ["identity-drift", /mismatch|identity|served by|requested .* served|requested .* observed|upstream pinned|changed thread|resumed .* not/iu],
  ["harness-changed", /invalid .*json|jsonl|stream contained|expected exactly|did not report a version|init event|result event|lacks|could not start|not found on path|exited with code|unexpected/iu],
];

// Kitchen's own publication refusals: its scans, not the network or the model.
const PUBLICATION_REFUSALS = /^(?:Public artifact scan failed|Web artifact has remote runtime references|Accepted dish already exists)/u;

function kitchenCode({ stage, message }) {
  if (stage === "interrupted") return "interrupted";
  if (stage === "preparation") return "preparation";
  if (PUBLICATION_REFUSALS.test(message)) return "publication";
  for (const [code, pattern] of KITCHEN_PATTERNS) if (pattern.test(message)) return code;
  if (stage === "publication") return "publication";
  return "kitchen-error";
}

/**
 * The single classifier. `chefFault` is the only way to a chef class: a code
 * from CHEF_FAULTS set by the throw site or adapter. Anything else, including an
 * unknown code, is a kitchen fault.
 */
export function classifyFailure({ stage = "execution", message = "", chefFault, kitchenFault, limit } = {}) {
  if (stage !== "interrupted" && typeof chefFault === "string" && Object.hasOwn(CHEF_FAULTS, chefFault)) {
    return { class: "chef", code: chefFault, stage, reason: CHEF_FAULTS[chefFault], retryable: false };
  }
  const code = stage !== "interrupted" && typeof kitchenFault === "string" && Object.hasOwn(KITCHEN_FAULTS, kitchenFault) ? kitchenFault : kitchenCode({ stage, message: String(message) });
  // `limit` names the harness or Kitchen limit that fired (private, like every kitchen fault).
  return { class: "kitchen", code, stage, reason: KITCHEN_FAULTS[code], retryable: true, ...(stage !== "interrupted" && typeof limit === "string" && limit ? { limit } : {}) };
}

/** Tag an error as a chef fault. Only throw sites that hold structured evidence call this. */
export function asChefFault(error, code) {
  if (!Object.hasOwn(CHEF_FAULTS, code)) throw new Error(`Unknown chef fault: ${code}`);
  error.chefFault = code;
  return error;
}

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Structured refusal evidence in one turn's events: a Claude stream whose
 * assistant message stopped for `refusal`, or a chat-completions response whose
 * message carries a `refusal` or finished for `refusal`. Never a reading of
 * the model's prose.
 */
export function refusalIn(events) {
  if (!Array.isArray(events)) return false;
  return events.some((event) => {
    // A subagent's message (it carries a parent tool use id) is another model's, never the requested one's.
    if (event?.parent_tool_use_id !== null && event?.parent_tool_use_id !== undefined) return false;
    if (event?.type === "assistant" && event.message?.stop_reason === "refusal") return true;
    if (event?.type === "result" && event.stop_reason === "refusal") return true;
    const choices = event?.type === "response" ? event.body?.choices : null;
    return Array.isArray(choices) && choices.some((choice) => choice?.finish_reason === "refusal" || hasText(choice?.message?.refusal));
  });
}

/** Whether any completed turn carries structured refusal evidence. */
export function refusalInTurns(turns) {
  return (turns ?? []).some((turn) => refusalIn(turn.events));
}
