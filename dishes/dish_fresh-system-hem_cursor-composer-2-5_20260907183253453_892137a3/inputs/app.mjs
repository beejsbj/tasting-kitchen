import { queueView, jobView, materialsView, specimenView } from "./source/contexts.mjs";
const [jobs, rates] = await Promise.all([fetch("./data/jobs.json").then(r => r.json()), fetch("./data/rates.json").then(r => r.json())]);
const content = document.querySelector("#content");
function show(node) {
  content.replaceChildren(node);
  content.focus();
}
function openJob(id) { show(jobView(jobs.find(job => job.id === id), openQueue)); }
function openQueue() { show(queueView(jobs, openJob)); }
document.querySelector("#queue").addEventListener("click", openQueue);
document.querySelector("#materials").addEventListener("click", () => show(materialsView(rates)));
document.querySelector("#specimens").addEventListener("click", () => show(specimenView()));
openQueue();
