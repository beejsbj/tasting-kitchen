import { readFile } from "node:fs/promises";
import path from "node:path";

import { assertPublicTextSafe } from "./files.mjs";

/**
 * Public notes beside Dishes. A Dish is immutable, so a later finding about how
 * it was cooked (what the harness could see, a known defect in the run) is
 * recorded here and shown in its receipt. Each note pins the exact Dish hash.
 */
export const DISH_NOTES_FILE = "catalog/dish-notes.json";

const NOTE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DISH_ID = /^dish_[a-zA-Z0-9_-]+$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const LINK = /^https:\/\/github\.com\/beejsbj\/tasting-kitchen\/issues\/[1-9][0-9]*$/u;

function invalid(message) {
  return new Error(`Invalid ${DISH_NOTES_FILE}: ${message}`);
}

function onlyKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${label} must be an object`);
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw invalid(`${label} has unknown keys: ${extra.join(", ")}`);
}

/** Validate a parsed notes document against the known Dishes. Returns notes keyed by Dish id. */
export function indexDishNotes(document, dishes) {
  onlyKeys(document, ["schemaVersion", "notes"], "document");
  if (document.schemaVersion !== 1) throw invalid("schemaVersion must be 1");
  if (!Array.isArray(document.notes)) throw invalid("notes must be an array");
  const dishById = new Map(dishes.map((dish) => [dish.id, dish]));
  const byDish = new Map();
  const ids = new Set();
  for (const [index, note] of document.notes.entries()) {
    const label = `notes[${index}]`;
    onlyKeys(note, ["id", "text", "link", "dishes"], label);
    if (typeof note.id !== "string" || !NOTE_ID.test(note.id)) throw invalid(`${label}.id must be a kebab-case id`);
    if (ids.has(note.id)) throw invalid(`duplicate note id ${note.id}`);
    ids.add(note.id);
    if (typeof note.text !== "string" || note.text.trim() === "" || note.text.length > 500) throw invalid(`${label}.text must be 1-500 characters`);
    assertPublicTextSafe(note.text, `dish note ${note.id}`);
    if (note.link !== undefined && (typeof note.link !== "string" || !LINK.test(note.link))) throw invalid(`${label}.link must be a Tasting Kitchen issue URL`);
    if (!Array.isArray(note.dishes) || note.dishes.length === 0) throw invalid(`${label}.dishes must list at least one Dish`);
    for (const [position, reference] of note.dishes.entries()) {
      const item = `${label}.dishes[${position}]`;
      onlyKeys(reference, ["id", "dishHash"], item);
      if (typeof reference.id !== "string" || !DISH_ID.test(reference.id)) throw invalid(`${item}.id must be a Dish id`);
      if (typeof reference.dishHash !== "string" || !SHA256.test(reference.dishHash)) throw invalid(`${item}.dishHash must be a sha256 hash`);
      const dish = dishById.get(reference.id);
      if (!dish) throw invalid(`${item} references unknown Dish ${reference.id}`);
      if (dish.dishHash !== reference.dishHash) throw invalid(`${item} does not match the immutable hash of ${reference.id}`);
      const notes = byDish.get(reference.id) ?? [];
      if (notes.some((existing) => existing.id === note.id)) throw invalid(`${label} lists ${reference.id} twice`);
      notes.push({ id: note.id, text: note.text, ...(note.link ? { link: note.link } : {}) });
      byDish.set(reference.id, notes);
    }
  }
  return byDish;
}

/** Notes keyed by Dish id; an absent file means no notes. */
export async function loadDishNotes(repoRoot, { dishes }) {
  let text;
  try { text = await readFile(path.join(repoRoot, DISH_NOTES_FILE), "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
  let document;
  try { document = JSON.parse(text); }
  catch (error) { throw invalid(error.message); }
  return indexDishNotes(document, dishes);
}
