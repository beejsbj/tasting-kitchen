import { readFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./catalog.mjs";
import { pathExists, within, writeJsonAtomic } from "./files.mjs";

/**
 * A Dish's receipts are sidecars beside dish.json. They are deliberately not
 * part of dish.json or dishHash: they let a reader see what the model received
 * (`inputs.json` plus `inputs/`) and what it ran as (`receipt.json`) without a
 * separate frozen store, and they never change an accepted manifest.
 */
export const INPUTS_DIRECTORY = "inputs";
export const INPUTS_MANIFEST = "inputs.json";
export const RECEIPT_MANIFEST = "receipt.json";

/** `fixtures` are recipe fixture declarations carrying `sha256` and, for public ones, `bytes` (a Buffer). */
export function createInputsManifest(recipe, fixtures) {
  return {
    schemaVersion: 1,
    recipe: { id: recipe.id, hash: recipe.recipeHash },
    fixtures: fixtures.map((fixture) => ({
      id: fixture.id,
      path: fixture.path,
      mountAs: fixture.mountAs,
      public: fixture.public !== false,
      editable: fixture.editable === true,
      ...(fixture.mediaType === undefined ? {} : { mediaType: fixture.mediaType }),
      sha256: fixture.sha256,
      bytes: fixture.size,
    })),
  };
}

export function createReceipt(variant, skill) {
  return {
    schemaVersion: 1,
    configuration: { ...variant, configHash: variant.configHash },
    skill: skill
      ? { id: skill.id, hash: skill.skillHash, source: skill.source, entry: skill.entry, treeHash: skill.treeHash, mountAs: skill.mountAs }
      : null,
  };
}

/** Write inputs.json, the public fixture bytes under inputs/, and receipt.json into a Dish directory. */
export async function writeDishSidecars(directory, { recipe, fixtures, receipt }) {
  const described = fixtures.map((fixture) => ({ ...fixture, size: fixture.bytes === undefined ? fixture.size : fixture.bytes.length }));
  for (const fixture of described) {
    if (fixture.public === false) continue;
    const target = within(path.join(directory, INPUTS_DIRECTORY), fixture.mountAs, `fixture mount ${fixture.id}`);
    await writeJsonOrBytes(target, fixture.bytes);
  }
  await writeJsonAtomic(path.join(directory, INPUTS_MANIFEST), createInputsManifest(recipe, described));
  await writeJsonAtomic(path.join(directory, RECEIPT_MANIFEST), receipt);
}

async function writeJsonOrBytes(target, bytes) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}

/** Read a Dish's sidecars, verifying every public input against its recorded hash. Absent sidecars return null. */
export async function readDishSidecars(directory) {
  const inputsFile = path.join(directory, INPUTS_MANIFEST);
  const inputs = await pathExists(inputsFile) ? JSON.parse(await readFile(inputsFile, "utf8")) : null;
  const receiptFile = path.join(directory, RECEIPT_MANIFEST);
  const receipt = await pathExists(receiptFile) ? JSON.parse(await readFile(receiptFile, "utf8")) : null;
  return { inputs, receipt };
}

export async function verifyInputs(directory, inputs) {
  const problems = [];
  for (const fixture of inputs.fixtures) {
    if (!fixture.public) continue;
    let bytes;
    try { bytes = await readFile(within(path.join(directory, INPUTS_DIRECTORY), fixture.mountAs, `input ${fixture.id}`)); }
    catch (error) { problems.push(`${fixture.id}: ${error.code === "ENOENT" ? "file missing" : error.message}`); continue; }
    if (sha256(bytes) !== fixture.sha256) problems.push(`${fixture.id}: bytes do not match recorded hash`);
    else if (bytes.length !== fixture.bytes) problems.push(`${fixture.id}: size does not match recorded bytes`);
  }
  return problems;
}
