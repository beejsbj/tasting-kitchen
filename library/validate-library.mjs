import { readFile, readdir } from "node:fs/promises";
import Ajv2020 from "../node_modules/schema-utils/node_modules/ajv/dist/2020.js";

const libraryDirectory = new URL(".", import.meta.url);
const readJson = async (relativePath) => JSON.parse(await readFile(new URL(relativePath, libraryDirectory), "utf8"));
const schema = await readJson("flight.schema.json");
const menu = await readJson("menu.json");
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateFlight = ajv.compile(schema);
const flightFiles = (await readdir(new URL("flights/", libraryDirectory))).filter((file) => file.endsWith(".json")).sort();
const flights = await Promise.all(flightFiles.map(async (file) => ({ file, flight: await readJson(`flights/${file}`) })));
const problems = [];

for (const { file, flight } of flights) {
  if (!validateFlight(flight)) problems.push(`${file}: ${ajv.errorsText(validateFlight.errors, { separator: "; " })}`);
  if (file !== `${flight.id}.json`) problems.push(`${file}: filename must match flight id`);
  const dishIds = flight.dishes.map((dish) => dish.id);
  if (new Set(dishIds).size !== dishIds.length) problems.push(`${file}: dish ids must be unique within a flight`);
}

const flightIds = flights.map(({ flight }) => flight.id);
if (flightIds.length !== 8) problems.push(`expected exactly 8 flight files; found ${flightIds.length}`);
if (new Set(flightIds).size !== flightIds.length) problems.push("flight ids must be unique");
const dishCount = flights.reduce((total, { flight }) => total + flight.dishes.length, 0);
if (dishCount < 24 || dishCount > 32) problems.push(`expected 24–32 dishes; found ${dishCount}`);
const recoveryDishes = flights.flatMap(({ flight }) => flight.dishes.filter((dish) => dish.turns.some((turn) => turn.kind === "correction")).map((dish) => `${flight.id}/${dish.id}`));
if (recoveryDishes.length < 2) problems.push(`expected at least 2 correction/recovery dishes; found ${recoveryDishes.length}`);

const menuIds = menu.flights.map((flight) => flight.id);
if (new Set(menuIds).size !== menuIds.length) problems.push("menu flight ids must be unique");
if (menuIds.length !== 8 || menuIds.some((id) => !flightIds.includes(id)) || flightIds.some((id) => !menuIds.includes(id))) problems.push("menu flights must exactly index flight files");
for (const menuFlight of menu.flights) {
  const actual = flights.find(({ flight }) => flight.id === menuFlight.id)?.flight;
  if (!actual) continue;
  if (menuFlight.dishCount !== actual.dishes.length) problems.push(`${menuFlight.id}: menu dish count does not match flight`);
  if (menuFlight.file !== `flights/${actual.id}.json`) problems.push(`${menuFlight.id}: menu file must match flight id`);
}
const familyIds = menu.families.flatMap((family) => family.flightIds);
if (new Set(familyIds).size !== familyIds.length || familyIds.length !== 8 || familyIds.some((id) => !flightIds.includes(id))) problems.push("menu families must index each flight exactly once");

if (problems.length) {
  console.error(`Library validation failed:\n- ${problems.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Library valid: ${flights.length} flights, ${dishCount} dishes, ${recoveryDishes.length} correction/recovery dishes.`);
}
