import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { galleryBrowserFixture } from "./gallery-browser-fixture.mjs";

const base = process.env.TASTE_BROWSER_URL ?? "http://127.0.0.1:5177";
const chromePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const screenshotDir = process.env.TASTE_BROWSER_SCREENSHOTS;
if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath, args: ["--no-sandbox"] });
const context = await browser.newContext();
let cleanupFixture = async () => {};
const errors = [];
const settle = page => page.waitForTimeout(500);
const save = async (page, name) => { if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${name}.png`, fullPage: true }); };
const recordErrors = (page, label) => { page.on("pageerror", error => errors.push({ label, kind: "page", text: error.message })); page.on("console", message => { if (message.type() === "error") errors.push({ label, kind: "console", text: message.text() }); }); };
const latest = dishes => [...dishes].sort((a, b) => b.executedAt.localeCompare(a.executedAt) || b.id.localeCompare(a.id))[0];
const configFor = (registry, dish) => registry.configurations.find(config => config.configHash === dish.identity.configHash);

try {
  const live = await browser.newPage();
  await live.goto(`${base}/`, { waitUntil: 'networkidle' });
  assert.equal(await live.locator('.dish-card').count(), 20, 'the live gallery exposes both Dishes for every active Recipe');
  assert.equal(await live.getByRole('heading', { name: 'No dishes yet.', exact: true }).count(), 0);
  await live.goto(`${base}/?view=recipes`, { waitUntil: 'networkidle' });
  await live.locator('.recipe-book-card').first().waitFor();
  assert.equal(await live.locator('.recipe-book-card').count(), 10);
  await save(live, 'active-recipe-book'); await live.close();
  cleanupFixture = await galleryBrowserFixture(context);
  const page = await context.newPage(); await page.setViewportSize({ width: 1280, height: 900 }); recordErrors(page, "gallery");
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.keyboard.press('Tab');
  await page.getByRole('link', { name: 'Skip to the dishes' }).press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'counter-content', 'skip link should move keyboard focus to recipes');
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const registry = await page.evaluate(async () => fetch("/data/registry.json").then(response => response.json()));
  const acceptedRecipes = registry.recipes.filter(recipe => registry.dishes.some(dish => dish.recipe.id === recipe.id));
  assert.equal(await page.locator(".dish-card").count(), registry.dishes.length, "every individual Dish has a card");
  assert.equal(await page.locator('.dish-grid').count(), 1, 'all Dishes share one grid');
  assert.equal(await page.locator('.dish-group').count(), 0, 'Recipes do not split the Dish grid into sections');
  assert.equal(await page.locator('.dish-card__recipe-tag').count(), registry.dishes.length, 'each Dish presents its Recipe as a tag');
  assert.equal(await page.locator('.dish-card__recipe-tag-label').getByText('Recipe', { exact: true }).count(), registry.dishes.length, 'Recipe tags identify their role');
  assert.equal(await page.locator('.dish-card .model-choices').count(), 0, 'cards have no model/effort selector');
  assert.equal(await page.locator('.dish-card').getByText('Iteration 2', { exact: true }).count(), 1, 'a Repeat is independently visible');
  for (const recipe of acceptedRecipes) {
    const recipeCards = page.locator(`.dish-card[data-recipe-id="${recipe.id}"]`);
    assert.equal(await recipeCards.count(), registry.dishes.filter(dish => dish.recipe.id === recipe.id).length);
    assert.equal(await recipeCards.getByText(recipe.title, { exact: true }).count(), await recipeCards.count(), 'each card names its Recipe');
  }
  assert.equal(await page.getByRole("group", { name: "Filter by model" }).count(), 1, "model filtering belongs on the counter");
  assert.equal(await page.locator('select[aria-label="Harness"], select[aria-label="Service tier"]').count(), 0, "counter should not expose disconnected configuration dropdowns");
  for (let i = 0; i < await page.locator(".recipe-card").count(); i++) { await page.locator(".recipe-card").nth(i).scrollIntoViewIfNeeded(); await page.waitForTimeout(250); }
  await settle(page); await page.evaluate(() => window.scrollTo(0, 0)); await save(page, "counter-desktop");

  const cardsBeforeFilter = await page.locator('.recipe-grid').first().boundingBox();
  await page.getByRole('button', { name: 'Cuisine and lineage filters' }).click();
  const cardsAfterFilter = await page.locator('.recipe-grid').first().boundingBox();
  assert.equal(cardsAfterFilter.y, cardsBeforeFilter.y, 'opening filters must not shift the recipe grid');
  const cuisine = registry.cuisines.find(item => acceptedRecipes.some(recipe => recipe.cuisines.includes(item.id)));
  await page.getByRole('group', { name: 'Cuisine', exact: true }).getByRole('button', { name: cuisine.label, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: `Remove ${cuisine.label} filter`, exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.has('cuisine'), false, 'removing a chip clears its URL filter');
  const target = acceptedRecipes.find(recipe => recipe.kind === "web" && registry.dishes.filter(dish => dish.recipe.id === recipe.id).length > 1)
    ?? acceptedRecipes.find(recipe => recipe.kind === "web")
    ?? acceptedRecipes[0];
  assert.ok(target, "registry should contain an accepted recipe");
  const targetDishes = registry.dishes.filter(dish => dish.recipe.id === target.id);
  const targetLatest = latest(targetDishes);
  const filterConfig = configFor(registry, targetLatest);
  assert.ok(filterConfig, "latest Dish should have a public configuration");
  const familyMatch = filterConfig.model.match(/(?:^|-)(astra|sol|terra|luna|fable)(?:-|$)/i);
  if (familyMatch) {
    const family = familyMatch[1][0].toUpperCase() + familyMatch[1].slice(1).toLowerCase();
    await page.getByRole("group", { name: "Filter by model" }).getByRole("button", { name: family, exact: true }).click(); await settle(page);
    assert.equal(new URL(page.url()).searchParams.get("family"), family, "counter family filter should be URL-addressable");
    assert.ok(await page.locator(".recipe-card").count() > 0, "family filter should leave matching Recipes on the counter");
  }
  await page.goto(`${base}/`, { waitUntil: "networkidle" });

  const historyBefore = await page.evaluate(() => history.length);
  await page.locator(`[data-dish-id="${targetLatest.id}"] button`).click(); await settle(page);
  assert.equal(await page.evaluate(() => history.length), historyBefore + 1, "opening a Recipe should add one history entry");
  let url = new URL(page.url());
  assert.equal(url.searchParams.get("recipe"), target.id);
  assert.equal(url.searchParams.get("revision"), targetLatest.recipe.hash, "card opens latest immutable Recipe Revision");
  assert.deepEqual(url.searchParams.get("models")?.split(","), [filterConfig.id], "card opens the exact latest configuration");
  assert.deepEqual(url.searchParams.get("dishes")?.split(","), [targetLatest.id], "card opens the latest Dish by time then ID");
  assert.equal(await page.locator(".comparison-slot").count(), 1, "a Recipe opens as a one-pane Dish viewer");
  const artifact = page.locator(".comparison-slot iframe"); const artifactBox = await artifact.boundingBox();
  assert.ok(artifactBox && artifactBox.y === 0 && artifactBox.height >= 899, "one-pane artifact should fill the viewport from its top edge");
  const dock = page.getByRole("navigation", { name: "Artifact controls" }); const dockBox = await dock.boundingBox();
  assert.ok(dockBox && dockBox.x > 1000 && dockBox.y < 40, "viewer toolbar should float at the top-right over the artifact");
  await save(page, "viewer-before-controls");
  assert.equal(await page.getByRole("group", { name: "Configuration 1", exact: true }).count(), 0, "model choices stay hidden until the toolbar opens");
  assert.equal(await page.locator(".receipt").count(), 0, "receipts do not push the artifact down");
  assert.equal(await page.locator(".tasting-room select").count(), 0, "current Recipe viewer has no configuration, Repeat, or revision select");
  await page.getByRole("button", { name: "Models and comparison" }).click(); await settle(page);
  assert.equal(await page.getByRole("group", { name: "Configuration 1", exact: true }).count(), 1, "Models popover contains the configuration pill group");
  await page.keyboard.press("Escape"); await settle(page);
  assert.equal(await page.getByRole("button", { name: "Models and comparison" }).evaluate(node => node === document.activeElement), true, "Escape should return focus to the Models trigger");
  assert.equal(await page.locator(".comparison-slot").count(), 1, "closing a popover must not close the Recipe viewer");
  await page.getByRole("button", { name: "Configuration receipts" }).click(); await settle(page);
  assert.equal(await page.getByText("Configuration receipts", { exact: true }).count(), 1, "receipt details are behind their toolbar control");
  await page.keyboard.press("Escape"); await settle(page);
  await page.getByRole("button", { name: "Read the recipe" }).click(); await settle(page);
  const brief = page.locator('[role="dialog"]'); assert.equal(await brief.count(), 1, "Recipe brief is an accessible dialog sheet");
  const briefBox = await brief.boundingBox(); assert.ok(briefBox && Math.abs((briefBox.x + briefBox.width) - 1280) < 1, "Recipe brief should slide in from the right edge");
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  assert.equal(await brief.evaluate(node => node.contains(document.activeElement)), true, "focus should remain trapped in the recipe sheet");
  await page.keyboard.press("Escape"); await settle(page); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-brief-control")), "true", "Escape should return focus to the brief trigger");
  const onePaneUrl = page.url();
  await page.getByRole("button", { name: "Compare another" }).click(); await settle(page);
  assert.equal(await page.locator(".comparison-slot").count(), 2, "Compare should add a second pane");
  await page.getByRole("button", { name: "Models and comparison" }).click(); await settle(page);
  await page.getByRole("button", { name: "Remove configuration 2" }).click(); await settle(page);
  assert.equal(await page.locator(".comparison-slot").count(), 1, "remove should return to one pane");
  await page.goBack(); await settle(page);
  assert.equal(await page.locator(".comparison-slot").count(), 2, "Back restores the removed comparison pane");
  await page.goBack(); await settle(page);
  assert.equal(page.url(), onePaneUrl, "Back restores the original exact-Dish URL");
  await save(page, "recipe-desktop");

  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const earlier = targetDishes.find(dish => dish.id !== targetLatest.id);
  await page.locator(`[data-dish-id="${earlier.id}"] button`).click(); await settle(page);
  assert.equal(new URL(page.url()).searchParams.get('dishes'), earlier.id, 'an earlier iteration opens its own exact artifact');

  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${base}/`, { waitUntil: "networkidle" });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile counter should not overflow horizontally");
  await page.locator(`[data-dish-id="${targetLatest.id}"] button`).scrollIntoViewIfNeeded(); await page.locator(`[data-dish-id="${targetLatest.id}"] button`).click(); await settle(page);
  assert.equal(await page.evaluate(() => window.scrollY), 0, "opening a Recipe should reset phone scroll");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile Recipe card and viewer should not overflow horizontally");
  await save(page, "recipe-phone");

  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(`${base}/?view=menus`, { waitUntil: "networkidle" }); assert.equal(await page.locator(".menu-card").count(), registry.menus.length, "menu card count should follow registry"); assert.equal(registry.menus.length, 3, "the cooked catalog should expose all three complete Menus"); assert.match(await page.locator("body").innerText(), /3 public menus/); await save(page, "menus-desktop");

  const menuRecipes = acceptedRecipes.filter(recipe => recipe.kind === "web").slice(0, 2);
  if (menuRecipes.length === 2) {
    const firstDish = registry.dishes.find(dish => dish.recipe.id === menuRecipes[0].id); const missingConfig = firstDish.identity.configHash;
    const menuRevision = { menuId: "browser-pair", hash: "sha256:browser-pair", title: "Browser pair", cuisines: [], recipes: menuRecipes.map(recipe => ({ recipeId: recipe.id, recipeHash: recipe.recipeHash })) };
    const menuRegistry = { ...registry, menus: [{ id: "browser-pair", title: "Browser pair", summary: "Intercepted browser coverage", cuisines: [], recipes: menuRecipes.map(recipe => recipe.id) }], menuRevisions: [menuRevision], dishes: registry.dishes.filter(dish => dish.id !== "dish_browser_extra" && !(dish.recipe.id === menuRecipes[1].id && dish.identity.configHash === missingConfig)) };
    const menuPage = await context.newPage(); await menuPage.setViewportSize({ width: 1280, height: 900 }); recordErrors(menuPage, "menu"); await menuPage.route("**/data/registry.json", route => route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(menuRegistry) })); await menuPage.goto(`${base}/?view=menus`, { waitUntil: "networkidle" }); await menuPage.getByRole("button", { name: /Browser pair/i }).click(); await settle(menuPage); assert.match(await menuPage.locator("body").innerText(), /1\/2 represented/); assert.match(await menuPage.locator("body").innerText(), /Not cooked/); await menuPage.getByRole("button", { name: /1 dish/ }).first().click(); await settle(menuPage); assert.equal(new URL(menuPage.url()).searchParams.get("revision"), menuRecipes[0].recipeHash, "menu cell should open exact revision");
    const repeat = { ...menuRegistry.dishes.find(dish => dish.recipe.id === menuRecipes[0].id && dish.identity.configHash === missingConfig), id: "dish_browser_repeat", executedAt: "2099-01-01T00:00:00.000Z", dishHash: "sha256:browser-repeat" }; const repeatRegistry = { ...menuRegistry, dishes: [...menuRegistry.dishes, repeat] }; await menuPage.unroute("**/data/registry.json"); await menuPage.route("**/data/registry.json", route => route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(repeatRegistry) })); await menuPage.goto(`${base}/?view=menus`, { waitUntil: "networkidle" }); await menuPage.getByRole("button", { name: /Browser pair/i }).click(); await settle(menuPage); await menuPage.getByRole("button", { name: /2 dishes/ }).first().click(); await settle(menuPage); assert.equal(await menuPage.getByRole("group", { name: "Dishes for configuration 1" }).count(), 1, "Repeats should be direct Dish pills"); await menuPage.getByRole("button", { name: "Repeat 2 for configuration 1" }).click(); await settle(menuPage); assert.equal(new URL(menuPage.url()).searchParams.get("dishes"), "dish_browser_repeat"); await menuPage.close();
  }

  await page.goto(`${base}/?recipe=${target.id}`, { waitUntil: "networkidle" }); await page.route("**/data/fixtures/**", route => route.abort()); await page.getByRole("button", { name: "Read the recipe" }).click(); await settle(page); if (await page.locator('[role="dialog"] .fixture summary').count()) await page.locator('[role="dialog"] .fixture summary').first().click(); await page.waitForTimeout(900); assert.match(await page.locator('[role="dialog"]').innerText(), /Failed to fetch|Input could not be loaded/); await page.unroute("**/data/fixtures/**");
  await page.goto(`${base}/`, { waitUntil: "networkidle" }); await page.getByRole("button", { name: /Visual system/i }).click(); await settle(page); assert.match(await page.locator("body").innerText(), /Back to the Kitchen/); await save(page, "styleguide-desktop");

  await page.goto(`${base}/?view=recipes`, { waitUntil: "networkidle" });
  const book = await page.evaluate(async () => fetch("/data/recipe-book.json").then(response => response.json()));
  assert.equal(await page.locator(".recipe-book-card").count(), book.recipes.length, "Recipe Book includes all active definitions");
  const uncooked = book.recipes.filter(entry => !entry.dishCount);
  assert.equal(uncooked.length, 0, "all ten active recipes should have a published Dish");
  await page.getByRole("button", { name: "Not cooked", exact: true }).click();
  assert.equal(await page.locator(".recipe-book-card").count(), 0);
  await page.getByRole("button", { name: "Design systems", exact: true }).click();
  const systems = book.recipes.filter(entry => entry.recipe.tags.includes("design-system"));
  assert.equal(await page.locator(".recipe-book-card").count(), systems.length);
  const candidate = systems[0];
  await page.getByRole("button").filter({ has: page.getByRole("heading", { name: candidate.recipe.title, exact: true }) }).click();
  assert.equal(new URL(page.url()).searchParams.get("edit"), candidate.recipe.id);
  assert.equal(await page.evaluate(() => scrollY), 0, "opening the authored recipe resets scroll");
  assert.equal(await page.getByRole("textbox", { name: "File contents", exact: true }).inputValue(), candidate.fixtures[0].text);
  await page.getByRole("button", { name: "Edit recipe", exact: true }).click();
  const draftTitle = `${candidate.recipe.title} draft`;
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(draftTitle);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.getByRole("heading", { name: draftTitle, exact: true }).count(), 1, "browser draft survives reload without a repository write");
  await page.getByRole("button", { name: "Edit recipe", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Title", exact: true }).inputValue(), candidate.recipe.title);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Recipe editor fits a phone");
  await save(page, "recipe-book-phone");

  const sandbox = await browser.newPage(); await sandbox.route("http://scratch.test/sandbox/index.html", route => route.fulfill({ status: 200, headers: { "content-type": "text/html", "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self'", "access-control-allow-origin": "*" }, body: '<p id="status">loading</p><script type="module" src="/sandbox/module.js"></script>' })); await sandbox.route("http://scratch.test/sandbox/module.js", route => route.fulfill({ status: 200, headers: { "content-type": "text/javascript", "access-control-allow-origin": "*" }, body: "const data = await fetch('/sandbox/data.json').then(response => response.json()); document.querySelector('#status').textContent = data.ok ? 'module-fetch-passed' : 'failed';" })); await sandbox.route("http://scratch.test/sandbox/data.json", route => route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: '{"ok":true}' })); await sandbox.setContent('<iframe id="frame" sandbox="allow-scripts" src="http://scratch.test/sandbox/index.html"></iframe>'); await sandbox.waitForTimeout(1000); assert.equal(await sandbox.frames()[1].locator("#status").innerText(), "module-fetch-passed"); assert.equal(await sandbox.locator("#frame").evaluate(frame => frame.contentDocument === null), true, "sandbox frame should be unreadable by parent"); await sandbox.close();
  assert.deepEqual(errors.filter(error => !error.text.includes("ERR_FAILED")), [], "gallery should have no uninduced browser errors"); console.log("gallery browser verification passed");
} finally { await browser.close(); await cleanupFixture(); }
