import { readFile, readdir } from "node:fs/promises";
import Ajv2020 from "../node_modules/schema-utils/node_modules/ajv/dist/2020.js";

const here = new URL(".", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, here), "utf8"));
const schema = await readJson("flight.schema.json");
const menu = await readJson("menu.json");
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
const files = (await readdir(new URL("flights/", here))).filter((file) => file.endsWith(".json")).sort();
const loaded = await Promise.all(files.map(async (file) => ({ file, flight: await readJson(`flights/${file}`) })));
const problems = [];
const expectedFlightCount = 9;
const expectedDishCount = 27;
const riskyContent = /(?:\/home\/|private\/|api[_ -]?key|secret(?:s)?\s*[:=]|password\s*[:=]|bearer\s+[a-z0-9._-]+|-----begin)/i;
const inspectStrings = (value, location) => {
  if (typeof value === "string" && riskyContent.test(value)) problems.push(`${location}: unsafe or non-public content marker`);
  if (Array.isArray(value)) value.forEach((item, index) => inspectStrings(item, `${location}[${index}]`));
  if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => inspectStrings(item, `${location}.${key}`));
};

for (const { file, flight } of loaded) {
  if (!validate(flight)) problems.push(`${file}: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
  if (file !== `${flight.id}.json`) problems.push(`${file}: filename must match flight id`);
  inspectStrings(flight, file);
  const dishIds = flight.dishes.map((dish) => dish.id);
  if (new Set(dishIds).size !== dishIds.length) problems.push(`${file}: dish ids must be unique`);
  for (const dish of flight.dishes) {
    const turns = dish.turns.map((turn) => turn.id);
    if (new Set(turns).size !== turns.length) problems.push(`${file}/${dish.id}: turn ids must be unique`);
    if (dish.harness.mode === "simulated" && dish.harness.mechanics.length === 0) problems.push(`${file}/${dish.id}: simulated harness needs mechanics`);
    if (dish.harness.mode === "none" && dish.harness.mechanics.length > 0) problems.push(`${file}/${dish.id}: non-simulated dish cannot list harness mechanics`);
    if (dish.humanJudgmentRequired && !dish.externalCorrectnessChecks.some((check) => check.kind === "human")) problems.push(`${file}/${dish.id}: human judgment needs a human check`);
    if (dish.interactionRequirements.visualOrInteraction) {
      if (dish.interactionRequirements.reducedMotionCheck !== "required") problems.push(`${file}/${dish.id}: visual/interaction dish needs reduced-motion check`);
      if (!dish.setup.assets.length) problems.push(`${file}/${dish.id}: visual/interaction dish needs a safe fixture asset`);
      if (!dish.externalCorrectnessChecks.some((check) => /reduced-motion/i.test(check.title))) problems.push(`${file}/${dish.id}: missing reduced-motion external check`);
    }
  }
}

const flightIds = loaded.map(({ flight }) => flight.id);
const dishes = loaded.flatMap(({ flight }) => flight.dishes.map((dish) => ({ flight, dish })));
if (loaded.length !== expectedFlightCount) problems.push(`expected ${expectedFlightCount} flights; found ${loaded.length}`);
if (dishes.length !== expectedDishCount) problems.push(`expected ${expectedDishCount} dishes; found ${dishes.length}`);
if (new Set(flightIds).size !== flightIds.length) problems.push("flight ids must be unique");
const menuIds = menu.flights.map((flight) => flight.id);
if (menu.formatVersion !== "2.0.0" || menu.recordCompatibility?.minimumReadableRecordFormat !== "1.0.0") problems.push("menu must declare v2 format and v1 record readability");
if (menuIds.length !== expectedFlightCount || new Set(menuIds).size !== menuIds.length || menuIds.some((id) => !flightIds.includes(id)) || flightIds.some((id) => !menuIds.includes(id))) problems.push("menu must index exactly the flight files");
for (const entry of menu.flights) {
  const actual = loaded.find(({ flight }) => flight.id === entry.id)?.flight;
  if (!actual) continue;
  if (entry.file !== `flights/${actual.id}.json`) problems.push(`${entry.id}: menu file does not match`);
  if (entry.dishCount !== actual.dishes.length) problems.push(`${entry.id}: menu dish count does not match`);
}
const familyIds = menu.families.flatMap((family) => family.flightIds);
if (familyIds.length !== expectedFlightCount || new Set(familyIds).size !== familyIds.length || familyIds.some((id) => !flightIds.includes(id))) problems.push("families must index each flight exactly once");
const corrections = dishes.filter(({ dish }) => dish.turns.some((turn) => turn.kind === "correction"));
if (corrections.length < 15) problems.push(`expected at least 15 staged correction dishes; found ${corrections.length}`);
if (loaded.some(({ flight }) => !flight.dishes.some((dish) => dish.turns.some((turn) => turn.kind === "correction" || turn.kind === "mode-transition")))) problems.push("each flight needs a staged correction or mode transition");
const simulated = dishes.filter(({ dish }) => dish.harness.mode === "simulated");
const visual = dishes.filter(({ dish }) => dish.interactionRequirements.visualOrInteraction);
const human = dishes.filter(({ dish }) => dish.humanJudgmentRequired);
if (simulated.length < 6) problems.push(`expected at least 6 simulated-harness dishes; found ${simulated.length}`);
if (visual.length < 6) problems.push(`expected at least 6 visual/interaction dishes; found ${visual.length}`);
if (human.length < 9) problems.push(`expected at least 9 human-judgment dishes; found ${human.length}`);
if (problems.length) {
  console.error(`Library validation failed:\n- ${problems.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Library valid: ${loaded.length} flights, ${dishes.length} dishes, ${corrections.length} staged correction dishes, ${simulated.length} simulated-harness dishes, ${human.length} human-judgment dishes, ${visual.length} visual/interaction dishes.`);
}
