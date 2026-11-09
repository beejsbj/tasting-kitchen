import type { Plate, Verdict } from "../types";
import { plateHashOf } from "./outcomes.ts";
import { publicTextFindings } from "../../lib/taste/public-text.mjs";

export const NOTE_LIMIT = 500;
export const OWNER: Verdict["judge"] = { kind: "owner", name: "Burooj" };

function stamp(date: Date) {
  return date.toISOString().replace(/[-:.TZ]/g, "");
}

/** Why a note cannot be published, or "" when it can. The registry build applies the same rules. */
export function noteProblem(note: string): string {
  const trimmed = note.trim();
  if (!trimmed) return "Add a short note.";
  if (trimmed.length > NOTE_LIMIT) return `Keep the note under ${NOTE_LIMIT} characters.`;
  const findings = publicTextFindings(trimmed) as string[];
  return findings.length ? `The note can't be public as written (${[...new Set(findings)].join(", ")}).` : "";
}

/** Burooj's verdict on one Dish or No Dish, shaped exactly as `taste verdict` writes it. */
export function createVerdict(plate: Plate, verdict: Verdict["verdict"], note: string, now = new Date()): Verdict {
  const problem = noteProblem(note);
  if (problem) throw new Error(problem);
  if (plate.id.startsWith("nodish_") && verdict !== "passed") throw new Error("A No Dish takes only a pass: there is nothing to fail.");
  return {
    schemaVersion: 1,
    id: `verdict_${plate.id}_${stamp(now)}`,
    plateId: plate.id,
    plateHash: plateHashOf(plate),
    judge: OWNER,
    verdict,
    note: note.trim(),
    decidedAt: now.toISOString(),
  };
}

/** Local development writes through the dev server, like Recipe Book saves; elsewhere a GitHub commit is the path. */
export async function localVerdictsWritable(fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!import.meta.env?.DEV) return false;
  try {
    const response = await fetcher("/api/verdicts", { cache: "no-store" });
    return response.ok && (await response.json() as { writable?: unknown }).writable === true;
  } catch { return false; }
}

export async function saveVerdictLocally(input: { plateId: string; verdict: Verdict["verdict"]; note: string }, fetcher: typeof fetch = fetch): Promise<Verdict> {
  const response = await fetcher("/api/verdicts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const result = await response.json() as { verdict?: Verdict; error?: { message?: string } };
  if (!response.ok || !result.verdict) throw new Error(result.error?.message ?? "The verdict could not be saved.");
  return result.verdict;
}
