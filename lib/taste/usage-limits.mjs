import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Skipping a configuration across Cooks while its provider usage limit holds.
 *
 * A provider usage limit is Kitchen's `usage-limit` fault (faults.mjs). When the
 * harness stated when it lifts, the fault carries `resetsAt` in the provider's
 * own words, with no zone: "Nov 21st, 2026", "3:05 PM". Kitchen reads it in the
 * host's local time zone, which is where the CLI that wrote it ran:
 *
 * - a date ("Nov 21st, 2026") holds until the end of that local day;
 * - a time ("3:05 PM", "15:05") holds until the first such local time after the
 *   fault's own `failedAt`, less five minutes: the provider prints the reset to
 *   the minute and Kitchen records the fault a little after the provider spoke,
 *   so "3:05 PM" said at 15:05:40 is today's, not tomorrow's;
 * - a date and a time ("Nov 21st, 2026 3:05 PM") hold until that local moment;
 * - anything else, or no `resetsAt` at all, holds nothing: plan says it could
 *   not read the time and does not skip.
 *
 * The hold comes from the configuration's latest `usage-limit` attempt, and an
 * attempt of the same configuration that started after that fault and that the
 * provider served (a Dish or a No Dish) lifts it early. It is per configuration, like the within-Cook stop.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE = String.raw`([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`;
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?`;
const TIME_24 = String.raw`(\d{1,2}):(\d{2})`;
const DATE_ONLY = new RegExp(`^${DATE}$`, "iu");
const TIME_ONLY = new RegExp(`^(?:${TIME}|${TIME_24})$`, "iu");
// How long after the provider spoke Kitchen may record the fault, for a time-only reset.
const TIME_ONLY_GRACE_MS = 5 * 60_000;
const DATE_TIME = new RegExp(`^${DATE},?\\s+(?:at\\s+)?(?:${TIME}|${TIME_24})$`, "iu");

function month(name) {
  const lower = name.toLowerCase();
  // A three-letter abbreviation, "Sept", or the full name; "Novem" is not a month.
  const index = MONTHS.findIndex((full) => lower === full || lower === full.slice(0, 3) || (lower === "sept" && full === "september"));
  return index < 0 ? null : index;
}

function hourMinute(hour12, minute12, meridiem, hour24, minute24) {
  if (hour24 !== undefined) {
    const hour = Number(hour24);
    const minute = Number(minute24);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
  }
  const hour = Number(hour12);
  const minute = minute12 === undefined ? 0 : Number(minute12);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return { hour: (hour % 12) + (meridiem.toLowerCase() === "p" ? 12 : 0), minute };
}

function localDate(year, monthName, day) {
  const index = month(monthName);
  if (index === null) return null;
  const date = new Date(Number(year), index, Number(day));
  // A day the month does not have ("Feb 30th") rolls over: that is not a date the provider meant.
  return date.getFullYear() === Number(year) && date.getMonth() === index && date.getDate() === Number(day) ? date : null;
}

/**
 * When a usage limit lifts, as a Date in the host's local time zone, or null
 * when `resetsAt` is not a form Kitchen reads. `faultAt` anchors a time-only form.
 */
export function usageLimitResetsAt(resetsAt, { faultAt } = {}) {
  if (typeof resetsAt !== "string") return null;
  const text = resetsAt.trim().replace(/\s+/gu, " ");
  let match = DATE_ONLY.exec(text);
  if (match) {
    const day = localDate(match[3], match[1], match[2]);
    if (!day) return null;
    // The end of that local day: the last millisecond before the next one starts.
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0, -1);
  }
  match = DATE_TIME.exec(text);
  if (match) {
    const day = localDate(match[3], match[1], match[2]);
    const time = hourMinute(match[4], match[5], match[6], match[7], match[8]);
    if (!day || !time) return null;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hour, time.minute);
  }
  match = TIME_ONLY.exec(text);
  if (match) {
    const time = hourMinute(match[1], match[2], match[3], match[4], match[5]);
    const anchor = faultAt instanceof Date ? faultAt : new Date(faultAt ?? Number.NaN);
    if (!time || Number.isNaN(anchor.getTime())) return null;
    // The first such local time after the fault (less the grace): later the same day, or else the next day.
    const after = new Date(anchor.getTime() - TIME_ONLY_GRACE_MS);
    for (let days = -1; days <= 2; days += 1) {
      const candidate = new Date(after.getFullYear(), after.getMonth(), after.getDate() + days, time.hour, time.minute);
      if (candidate > after) return candidate;
    }
    return null;
  }
  return null;
}

/** A local time as Kitchen prints it: "2026-11-21 23:59 -05:00". */
export function formatLocalTime(date) {
  const pad = (value) => String(Math.abs(value)).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} ${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch { return null; }
}

/**
 * The configuration's latest usage-limit attempt still standing, or null: its
 * attempt id, `failedAt` and the provider's `resetsAt`. Reads only the
 * attempts whose id names the configuration (runner.mjs builds the id from
 * it), and of those only `requested.json` and `state.json`.
 */
export async function latestUsageLimit(repoRoot, configurationId) {
  const attempts = path.join(repoRoot, "private", "runtime", "attempts");
  const marker = `_${safeId(configurationId)}_`;
  const names = (await readdir(attempts).catch(() => [])).filter((name) => name.startsWith("attempt_") && name.includes(marker));
  const records = await Promise.all(names.map(async (name) => {
    const [requested, state] = await Promise.all([readJson(path.join(attempts, name, "requested.json")), readJson(path.join(attempts, name, "state.json"))]);
    if (requested?.identity?.variantId !== configurationId || !state) return null;
    // When it ended (a fault's own time), and when it started: a served attempt lifts a limit only if it began after it.
    const at = Date.parse(state.failedAt ?? state.finalizedAt ?? "");
    const startedAt = Date.parse(requested.startedAt ?? state.executedAt ?? "");
    return Number.isNaN(at) ? null : { attemptId: name, at, startedAt, state };
  }));
  const known = records.filter(Boolean);
  const limited = known.filter(({ state }) => state.status === "failed" && state.fault?.code === "usage-limit").sort((left, right) => right.at - left.at)[0];
  if (!limited) return null;
  // The provider served this configuration again after the limit (a Dish, or a No Dish it earned): the limit lifted.
  // Started after the fault, not merely finished after it: a Run that began before the limit says nothing about it.
  if (known.some(({ startedAt, state }) => startedAt > limited.at && (state.status === "accepted" || state.fault?.class === "chef"))) return null;
  return { attemptId: limited.attemptId, failedAt: limited.state.failedAt, ...(limited.state.fault.resetsAt ? { resetsAt: limited.state.fault.resetsAt } : {}) };
}

/**
 * Hold a plan's cells back while the configuration's usage limit holds. Returns
 * the plan with held cells moved from `supported` to `usageLimited`, and a
 * `usageLimit` record whenever a standing limit was found: `holding` (cells
 * held until `until`), `ignored` (`ignoreUsageLimit`), or `unreadable` (the
 * reset time is missing or not a form Kitchen reads, so nothing is held). A
 * limit whose reset has passed adds nothing.
 */
export async function holdForUsageLimit(repoRoot, plan, { now = new Date(), ignoreUsageLimit = false } = {}) {
  const configurationId = plan.variant?.id;
  if (!configurationId || plan.supported.length === 0) return plan;
  const limit = await latestUsageLimit(repoRoot, configurationId);
  if (!limit) return plan;
  const until = usageLimitResetsAt(limit.resetsAt, { faultAt: limit.failedAt });
  const blockedBy = { attemptId: limit.attemptId, fault: "usage-limit", failedAt: limit.failedAt, ...(limit.resetsAt ? { resetsAt: limit.resetsAt } : {}) };
  if (!until) {
    const stated = limit.resetsAt ? `the provider's reset time "${limit.resetsAt}" is not a form Kitchen reads` : "the provider gave no reset time";
    return { ...plan, usageLimit: { status: "unreadable", ...blockedBy, note: `${limit.attemptId} hit the provider's usage limit, but ${stated}, so this configuration is not skipped` } };
  }
  if (until <= now) return plan;
  const reason = `skipped until ${formatLocalTime(until)}: usage limit`;
  if (ignoreUsageLimit) return { ...plan, usageLimit: { status: "ignored", ...blockedBy, until: until.toISOString(), note: `${reason} (overridden by --ignore-usage-limit)` } };
  return {
    ...plan,
    supported: [],
    usageLimited: plan.supported.map((item) => ({ recipeId: item.recipeId, recipeHash: item.recipeHash, status: "skipped", reason, until: until.toISOString(), blockedBy })),
    usageLimit: { status: "holding", ...blockedBy, until: until.toISOString(), note: `${reason}; ${limit.attemptId} hit it. --ignore-usage-limit cooks anyway` },
  };
}
