import { readFile, writeFile } from "node:fs/promises";

const command = process.argv[2];
const id = process.argv[3];
const statePath = new URL("./state.json", import.meta.url);
const eventsPath = new URL("./events.json", import.meta.url);
const state = JSON.parse(await readFile(statePath, "utf8"));

if (command === "list") {
  console.log(JSON.stringify(state.reminders, null, 2));
} else if (command === "retire") {
  const events = JSON.parse(await readFile(eventsPath, "utf8"));
  const reminder = state.reminders.find((item) => item.id === id);
  const completed = events.events.some((event) => event.type === "completed" && event.reminderId === id);
  if (!reminder) throw new Error(`unknown reminder: ${id}`);
  if (!completed) throw new Error(`no completion evidence for: ${id}`);
  reminder.status = "retired";
  reminder.retiredReason = "completed-early";
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`retired ${id}`);
} else if (command === "due") {
  const active = state.reminders.filter((item) => item.status === "active");
  console.log(JSON.stringify(active, null, 2));
} else {
  console.error("usage: node reminders.mjs list|retire <id>|due");
  process.exitCode = 2;
}
