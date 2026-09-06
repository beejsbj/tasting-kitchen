import { queueView, jobView, materialsView, specimenView } from "./source/contexts.mjs";
import { estimateView } from "./source/estimate-view.mjs";
const [jobs, rates] = await Promise.all([fetch("./data/jobs.json").then(r => r.json()), fetch("./data/rates.json").then(r => r.json())]);
const content = document.querySelector("#content");
const estimates = new Map(jobs.map(job => [job.id, { lines: [], approval: null, feedback: "" }]));
function show(node) {
  content.replaceChildren(node);
  content.focus();
}
function openJob(id) {
  const job = jobs.find(candidate => candidate.id === id);
  show(jobView(job, openQueue, [estimateView(job, rates, estimates.get(id))]));
}
function openQueue() { show(queueView(jobs, openJob)); }
document.querySelector("#queue").addEventListener("click", openQueue);
document.querySelector("#materials").addEventListener("click", () => show(materialsView(rates)));
document.querySelector("#specimens").addEventListener("click", () => show(specimenView()));
openQueue();
