/**
 * A Recipe's budget: how long, and how many model turns, any configuration
 * gets to cook it. Kitchen applies the same budget to every configuration and
 * skill layer, so running past it is a fair answer to "can this model do this
 * at all?": a chef fault (`out-of-time`, `out-of-turns`) published as a No Dish.
 * A Recipe that declares no budget leaves every limit Kitchen's, and hitting one
 * stays a kitchen fault.
 *
 * - `seconds` is wall-clock time in the execution phase only: the harness and
 *   model running the Recipe's turns. Preparation, login, identity checks,
 *   validation and publication do not count. Waits the harness itself reports
 *   (a rate-limit or retry delay, a request that got no response) are credited
 *   back, so a throttled or hung route does not spend the model's time.
 * - `modelTurns` is the number of model turns (one model response, usually one
 *   tool round trip) each prompt turn of the Recipe may take. It is per prompt
 *   turn because that is the unit every harness that can hold it counts in.
 *
 * Both join the recipe hash, so changing a budget makes a new cell.
 */
export const BUDGET_KEYS = ["seconds", "modelTurns"];
export const BUDGET_LIMITS = { seconds: { minimum: 30, maximum: 86_400 }, modelTurns: { minimum: 1, maximum: 10_000 } };

/** The Recipe's declared budget, or null. Throws on a malformed one. */
export function recipeBudget(recipe) {
  const budget = recipe?.budget;
  if (budget === undefined) return null;
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) throw new Error("Recipe budget must be an object");
  const keys = Object.keys(budget);
  if (keys.length === 0) throw new Error(`Recipe budget must declare at least one of ${BUDGET_KEYS.join(", ")}`);
  for (const key of keys) {
    if (!BUDGET_KEYS.includes(key)) throw new Error(`Recipe budget has an unknown key ${key}`);
    const { minimum, maximum } = BUDGET_LIMITS[key];
    if (!Number.isInteger(budget[key]) || budget[key] < minimum || budget[key] > maximum) throw new Error(`Recipe budget.${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return { ...budget };
}

/** Why the budget clock aborted a harness: the reason its signal carries. */
export class BudgetExpired extends Error {
  constructor(seconds) {
    super(`The Recipe's time budget of ${seconds} s ran out`);
    this.name = "BudgetExpired";
    this.seconds = seconds;
  }
}

/**
 * The execution-phase clock. Its `signal` aborts when the declared seconds,
 * plus every credited wait, have passed; with no time budget it never aborts.
 * Adapters kill their harness on the signal and credit the waits their harness
 * reports. `stop()` freezes it and returns the private record of what was spent.
 */
export function startBudgetClock({ seconds, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const controller = new AbortController();
  const startedAt = now();
  let creditedMs = 0;
  let stoppedAt = null;
  let timer = null;
  const deadline = () => startedAt + seconds * 1000 + creditedMs;
  const arm = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (seconds === undefined || stoppedAt !== null || controller.signal.aborted) return;
    timer = setTimer(() => {
      timer = null;
      // A credit may have moved the deadline after this timer was set.
      if (now() >= deadline()) controller.abort(new BudgetExpired(seconds));
      else arm();
    }, Math.max(0, deadline() - now()));
    timer?.unref?.();
  };
  arm();
  return {
    seconds,
    signal: controller.signal,
    get expired() { return controller.signal.aborted; },
    /** Give back time the harness reports it spent waiting on the provider, not running the model. */
    credit(ms) {
      if (!(Number.isFinite(ms) && ms > 0) || stoppedAt !== null || controller.signal.aborted) return;
      creditedMs += ms;
      arm();
    },
    stop() {
      if (stoppedAt === null) stoppedAt = now();
      if (timer !== null) clearTimer(timer);
      timer = null;
      return { ...(seconds !== undefined ? { seconds } : {}), elapsedMs: stoppedAt - startedAt, creditedMs: Math.round(creditedMs), expired: controller.signal.aborted };
    },
  };
}

/** A clock that never runs out: what an adapter gets when the runner gives it none (tests, direct calls). */
export const NO_BUDGET_CLOCK = Object.freeze({ seconds: undefined, signal: new AbortController().signal, expired: false, credit() {}, stop() { return { elapsedMs: 0, creditedMs: 0, expired: false }; } });

/**
 * Kill a spawned harness when the clock runs out. A detached child is killed
 * with its whole process group, so the tools it started go with it. Returns
 * the disposer, and a getter for whether the budget was what killed it.
 */
export function killOnBudget(child, clock, { group = false } = {}) {
  const signal = clock?.signal;
  let killed = false;
  if (!signal) return { dispose() {}, get killed() { return killed; } };
  const kill = () => {
    killed = true;
    if (group && child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); return; }
      catch { /* fall through to the child itself */ }
    }
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  };
  if (signal.aborted) kill();
  else signal.addEventListener("abort", kill, { once: true });
  return { dispose: () => signal.removeEventListener("abort", kill), get killed() { return killed; } };
}

/**
 * The wait Claude Code reports in one `system/api_retry` event: the delay
 * before its retry, plus how long a request went without any response.
 * Neither is the model's time.
 */
export function claudeReportedWaitMs(event) {
  if (event?.type !== "system" || event.subtype !== "api_retry") return 0;
  const delay = Number(event.retry_delay_ms);
  const waited = Number(event.no_response?.waited_ms);
  return (Number.isFinite(delay) && delay > 0 ? delay : 0) + (Number.isFinite(waited) && waited > 0 ? waited : 0);
}

/** Calls `onLine` with every complete line a stream writes. */
export function lineReader(onLine) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  };
}
