/**
 * A Recipe's budget: how long, and how many model turns, any configuration
 * gets to cook it. Kitchen applies the same budget to every configuration and
 * skill layer, so running past it is a fair answer to "can this model do this
 * at all?": a chef fault (`out-of-time`, `out-of-turns`) published as a No Dish.
 * A Recipe that declares no budget leaves every limit Kitchen's, and hitting one
 * stays a kitchen fault.
 *
 * - `seconds` is wall-clock time summed across the Recipe's turns, counted
 *   only while a harness process or model request runs (`startBudgetClock`).
 *   Preparation, login, version probes, Kitchen's work between turns, identity
 *   checks, validation and publication do not count. Waits the harness itself reports
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
 * The execution-phase clock. It runs only between `resume()` and `pause()`:
 * adapters resume it when a harness process or model request starts and pause
 * it when that ends, so harness startup probes, Kitchen's work between turns,
 * preparation and validation are never the model's time. Its `signal` aborts
 * once the running time passes the declared seconds plus every credited wait;
 * with no time budget it never aborts. Adapters kill their harness on the
 * signal and credit the waits their harness reports. `stop()` freezes it and
 * returns the private record of what was spent.
 */
export function startBudgetClock({ seconds, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const controller = new AbortController();
  let spentMs = 0;
  let runningSince = null;
  let creditedMs = 0;
  let stopped = false;
  let timer = null;
  const spent = () => spentMs + (runningSince === null ? 0 : now() - runningSince);
  const remaining = () => seconds * 1000 + creditedMs - spent();
  const disarm = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const arm = () => {
    disarm();
    if (seconds === undefined || runningSince === null || stopped || controller.signal.aborted) return;
    timer = setTimer(() => {
      timer = null;
      // A credit may have moved the deadline after this timer was set.
      if (remaining() <= 0) controller.abort(new BudgetExpired(seconds));
      else arm();
    }, Math.max(0, remaining()));
    timer?.unref?.();
  };
  const pause = () => {
    if (runningSince === null) return;
    spentMs += now() - runningSince;
    runningSince = null;
    disarm();
  };
  return {
    seconds,
    signal: controller.signal,
    get expired() { return controller.signal.aborted; },
    /** A harness process or model request started: the model's time runs. */
    resume() {
      if (runningSince !== null || stopped || controller.signal.aborted) return;
      runningSince = now();
      arm();
    },
    /** It ended: Kitchen's own work that follows is not the model's time. */
    pause,
    /** Give back time the harness reports it spent waiting on the provider, not running the model. */
    credit(ms) {
      if (!(Number.isFinite(ms) && ms > 0) || stopped || controller.signal.aborted) return;
      creditedMs += ms;
      arm();
    },
    stop() {
      pause();
      stopped = true;
      return { ...(seconds !== undefined ? { seconds } : {}), elapsedMs: spentMs, creditedMs: Math.round(creditedMs), expired: controller.signal.aborted };
    },
  };
}

/**
 * Run the clock while a spawned harness runs, and kill it when the clock runs
 * out. A detached child is killed with its whole process group, so the tools
 * it started go with it. Returns the disposer (which pauses the clock), and a
 * getter for whether the budget was what killed it.
 */
export function killOnBudget(child, clock, { group = false } = {}) {
  const signal = clock?.signal;
  let killed = false;
  if (!signal) return { dispose() {}, get killed() { return killed; } };
  // The model's time runs while this harness does.
  clock.resume?.();
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
  return {
    dispose() {
      signal.removeEventListener("abort", kill);
      clock.pause?.();
    },
    get killed() { return killed; },
  };
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
