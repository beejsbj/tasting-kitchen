"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import {
  assetDownloadDetails, comparisonEligibility, createRecord, exportRecords, importRecords, isRecordComplete,
} from "./kitchen-storage.mjs";

type TurnKind = "prompt" | "correction" | "follow-up" | "mode-transition";
type KitchenRecord = {
  format: "model-tasting-kitchen.run.v1" | "model-tasting-kitchen.run.v2"; id: string; createdAt: string; updatedAt: string;
  flightId: string; flightTitle: string; family?: string; flightVersion?: string; dishId: string; dishTitle: string; dishVersion?: string;
  modelLabel: string; configuration: string; reflection: string; turns: { turnId: string; label: string; kind: TurnKind; prompt: string; response: string; note: string; stage?: string }[];
  activityMode?: string; claimBoundary?: string; harness?: { mode: string; mechanics: string[]; separationNote: string };
};
type Asset = { id: string; title: string; kind: "inline-text" | "reference-image-description" | "interaction-fixture" | "public-fixture"; content: string; path?: string; usage?: string; altText?: string };
type EvidenceBasis = { grade: string; types: string[]; evidenceIds: string[]; provenanceCaution: string; claimBoundary: string };
type Harness = { mode: "none" | "simulated"; mechanics: string[]; separationNote: string };
type Turn = { id: string; kind: TurnKind; stage: string; label: string; prompt: string };
type Setup = { context: string; assets: Asset[] };
type Check = { kind: "deterministic" | "human"; title: string; method: string };
type Dish = {
  id: string; title: string; summary: string; activityMode: string; whyItExists: string; evidenceBasis: EvidenceBasis; setup: Setup; harness: Harness;
  turns: Turn[]; observationLenses: string[]; repeatVariationGuidance: string; effortEstimate: { label: string; minutes: number };
  externalCorrectnessChecks: Check[]; interactionRequirements: { visualOrInteraction: boolean; reducedMotionCheck: "required" | "not-applicable" }; humanJudgmentRequired: boolean; version: string;
};
type Flight = {
  id: string; title: string; family: string; summary: string; whyItExists: string; version: string; formatVersion: string;
  status: "ready" | "draft" | "retired"; setup: Setup; dishes: Dish[]; effortEstimate: { label: string; minutes: number }; evidenceBasis: EvidenceBasis;
};

const flightModules = import.meta.glob<{ default: Flight }>("../library/flights/*.json", { eager: true });
const allFlights = Object.values(flightModules).map((module) => module.default).filter((flight) => flight?.status !== "retired").sort((a, b) => a.title.localeCompare(b.title));
const STORAGE_KEY = "model-tasting-kitchen.records.v2";

function readRecords(): KitchenRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem("model-tasting-kitchen.records.v1");
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecordComplete) : [];
  } catch { return []; }
}

function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }

function triggerDownload(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}
function publicFixtureUrl(path: string) { return `/${path.replace(/^public\/?/, "")}`; }

export default function Home() {
  const [flightId, setFlightId] = useState("");
  const activeFlight = allFlights.find((flight) => flight.id === flightId) ?? allFlights[0];
  const [dishId, setDishId] = useState("");
  const activeDish = activeFlight?.dishes.find((dish) => dish.id === dishId) ?? activeFlight?.dishes[0];
  const [modelLabel, setModelLabel] = useState("");
  const [configuration, setConfiguration] = useState("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reflection, setReflection] = useState("");
  const [turnIndex, setTurnIndex] = useState(0);
  const [copiedItem, setCopiedItem] = useState("");
  const [records, setRecords] = useState<KitchenRecord[]>(() => typeof window === "undefined" ? [] : readRecords());
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const currentTurn = activeDish?.turns[turnIndex];
  const comparedRecords = useMemo(() => selectedForCompare.map((id) => records.find((record) => record.id === id)).filter((record): record is KitchenRecord => Boolean(record)), [records, selectedForCompare]);

  function persist(next: KitchenRecord[]) {
    setRecords(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  function resetDish() { setResponses({}); setNotes({}); setReflection(""); setTurnIndex(0); setCopiedItem(""); }
  function chooseFlight(nextId: string) {
    const nextFlight = allFlights.find((flight) => flight.id === nextId);
    setFlightId(nextId); setDishId(nextFlight?.dishes[0]?.id ?? ""); resetDish();
  }
  function chooseDish(nextId: string) { setDishId(nextId); resetDish(); }
  async function copyText(content: string, itemId: string, message: string) {
    try { await navigator.clipboard.writeText(content); setCopiedItem(itemId); setNotice(message); }
    catch { setNotice("Copy was unavailable. Select the text and copy it manually."); }
  }
  function downloadRecords() { triggerDownload(exportRecords(records), `model-tasting-kitchen-records-${new Date().toISOString().slice(0, 10)}.json`, "application/json"); }
  function downloadAsset(asset: Asset) { const details = assetDownloadDetails(asset); triggerDownload(asset.content, details.filename, details.type); setNotice(`Downloaded ${details.filename}.`); }
  function saveRun() {
    if (!activeFlight || !activeDish) return;
    if (!modelLabel.trim()) { setNotice("Add a model label before saving so this run remains identifiable."); return; }
    persist([createRecord({ flight: activeFlight, dish: activeDish, modelLabel, configuration, responses, notes, reflection }) as KitchenRecord, ...records]);
    setNotice("Saved locally on this browser. The kitchen records your encounter; it never executes a model.");
  }
  function chooseForComparison(id: string) {
    setSelectedForCompare((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length === 2) { setNotice("Comparison is intentionally limited to two runs. Remove one to choose another."); return current; }
      const candidate = records.find((record) => record.id === id);
      const eligibility = candidate ? comparisonEligibility([...current.map((selected) => records.find((record) => record.id === selected)).filter((record): record is KitchenRecord => Boolean(record)), candidate]) : { allowed: false, reason: "That saved run could not be found." };
      if (!eligibility.allowed) { setNotice(eligibility.reason); return current; }
      return [...current, id];
    });
  }
  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try {
      const result = importRecords(await file.text(), records);
      if (!result.accepted) { setNotice("That file was not imported: it does not contain valid kitchen records. Your saved runs were left unchanged."); return; }
      persist(result.records);
      setNotice(`Imported ${result.imported} new record${result.imported === 1 ? "" : "s"}; ${result.skipped} duplicate or invalid entr${result.skipped === 1 ? "y" : "ies"} skipped.`);
    } catch { setNotice("That file could not be read as JSON. Your saved runs were left unchanged."); }
  }

  if (!activeFlight || !activeDish || !currentTurn) return <main className="empty-kitchen"><p className="eyebrow">Model Tasting Kitchen</p><h1>The kitchen is waiting for its first flight.</h1><p>Add schema-valid flight files to <code>library/flights</code>, then reload this page.</p></main>;
  const assets = [...activeFlight.setup.assets, ...activeDish.setup.assets];

  return <main>
    <header className="site-header"><div><p className="eyebrow">A private field notebook for model encounters</p><h1>Model Tasting Kitchen</h1></div><p className="header-note">Manual prompts. Your notes. No scores.</p></header>
    <section className="orientation" aria-labelledby="start-heading"><div><p className="section-kicker">Start a tasting</p><h2 id="start-heading">Choose a flight, then keep the encounter intact.</h2></div><p>The kitchen does not call a model or simulate a response. Copy each staged prompt into the model yourself, paste its reply here, then preserve what you noticed.</p></section>
    <section className="selector-grid two-columns" aria-label="Choose a flight and dish">
      <label><span>Flight</span><select value={activeFlight.id} onChange={(event) => chooseFlight(event.target.value)}>{allFlights.map((flight) => <option key={flight.id} value={flight.id}>{flight.title} · {flight.effortEstimate.minutes} min</option>)}</select></label>
      <label><span>Dish</span><select value={activeDish.id} onChange={(event) => chooseDish(event.target.value)}>{activeFlight.dishes.map((dish) => <option key={dish.id} value={dish.id}>{dish.title} · {dish.effortEstimate.minutes} min</option>)}</select></label>
    </section>
    <section className="dish-intro" aria-labelledby="dish-heading"><div><p className="section-kicker">{activeFlight.family} · v{activeFlight.version} · {activeDish.activityMode}</p><h2 id="dish-heading">{activeDish.title}</h2><p>{activeDish.summary}</p></div><details><summary>Context, boundaries &amp; materials</summary><p>{activeFlight.setup.context}</p><p>{activeDish.setup.context}</p><p><strong>Claim boundary:</strong> {activeDish.evidenceBasis.claimBoundary}. {activeDish.evidenceBasis.provenanceCaution}</p><p><strong>Harness:</strong> {activeDish.harness.mode === "simulated" ? `Simulated (${activeDish.harness.mechanics.join(", ") || "closed fixture"}).` : "None."} {activeDish.harness.separationNote}</p>{assets.map((asset) => { const fixtureUrl = asset.kind === "public-fixture" && asset.path ? publicFixtureUrl(asset.path) : ""; return <article className="asset" key={asset.id}><div className="asset-heading"><div><p className="asset-kind">{asset.kind.replaceAll("-", " ")}</p><h3>{asset.title}</h3></div><div className="asset-actions">{fixtureUrl ? <><a className="quiet-button" href={fixtureUrl} target="_blank" rel="noreferrer">Open fixture</a><a className="quiet-button" href={fixtureUrl} download>Download fixture</a><button className="quiet-button" onClick={() => copyText(fixtureUrl, `asset-${asset.id}`, "Fixture URL copied. Open it in the browser; the kitchen does not execute it.")}>{copiedItem === `asset-${asset.id}` ? "Copied" : "Copy URL"}</button></> : <><button className="quiet-button" onClick={() => copyText(asset.content, `asset-${asset.id}`, "Asset copied. It is a supplied fixture, not an executable integration.")}>{copiedItem === `asset-${asset.id}` ? "Copied" : "Copy asset"}</button><button className="quiet-button" onClick={() => downloadAsset(asset)}>Download</button></>}</div></div>{asset.altText && <p className="muted">{asset.altText}</p>}{fixtureUrl ? <><p className="fixture-path"><strong>Fixture:</strong> {fixtureUrl}</p><p><strong>Use it:</strong> {asset.usage ?? asset.content}</p></> : <pre>{asset.content}</pre>}</article>; })}</details></section>
    <section className="run-details" aria-label="Run details"><label><span>Model label <b aria-hidden="true">*</b></span><input value={modelLabel} onChange={(event) => setModelLabel(event.target.value)} placeholder="e.g. model name / version" required /></label><label><span>Configuration <i>(optional)</i></span><input value={configuration} onChange={(event) => setConfiguration(event.target.value)} placeholder="Mode, context, or conditions" /></label></section>
    <section className="stage" aria-labelledby="stage-heading"><div className="stage-topline"><div><p className="section-kicker">Work through the turns</p><h2 id="stage-heading">{turnIndex + 1} of {activeDish.turns.length} · {currentTurn.label}</h2></div><div className="turn-signals"><span className={`kind kind-${currentTurn.kind}`}>{currentTurn.kind.replaceAll("-", " ")}</span><span className="stage-label">{currentTurn.stage}</span></div></div><div className="turn-tabs" role="tablist" aria-label="Turns">{activeDish.turns.map((turn, index) => <button key={turn.id} role="tab" aria-selected={index === turnIndex} className={index === turnIndex ? "active" : ""} onClick={() => setTurnIndex(index)}>{index + 1}<span className="sr-only">: {turn.label}</span></button>)}</div><article className={`prompt-card ${currentTurn.kind === "mode-transition" ? "mode-transition-card" : ""}`}><div className="prompt-heading"><div><h3>{currentTurn.label}</h3>{currentTurn.kind === "mode-transition" && <p className="transition-note">Mode transition: the requested way of working has changed. Carry the prior exchange forward, but follow this new instruction.</p>}</div><button className="quiet-button" onClick={() => copyText(currentTurn.prompt, `turn-${currentTurn.id}`, "Prompt copied. Paste it into the model yourself, then bring the response back here.")}>{copiedItem === `turn-${currentTurn.id}` ? "Copied" : "Copy prompt"}</button></div><pre>{currentTurn.prompt}</pre></article><div className="response-grid"><label><span>Response from the model</span><textarea value={responses[currentTurn.id] ?? ""} onChange={(event) => setResponses({ ...responses, [currentTurn.id]: event.target.value })} placeholder="Paste the response here. Long responses are welcome." /></label><label><span>Your note for this turn</span><textarea className="note-area" value={notes[currentTurn.id] ?? ""} onChange={(event) => setNotes({ ...notes, [currentTurn.id]: event.target.value })} placeholder="What did you notice, correct, or want to revisit?" /></label></div><div className="stage-actions"><button className="quiet-button" disabled={turnIndex === 0} onClick={() => setTurnIndex(turnIndex - 1)}>Previous turn</button><button className="primary-button" disabled={turnIndex === activeDish.turns.length - 1} onClick={() => setTurnIndex(turnIndex + 1)}>Next turn</button></div></section>
    <section className="reflection" aria-labelledby="reflection-heading"><div><p className="section-kicker">Close the run</p><h2 id="reflection-heading">Overall reflection or corrections</h2><p>Leave one note about the whole encounter: what shifted, what held up, or what you would change next time.</p></div><textarea value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="A free-form reflection, not a score." /><button className="primary-button" onClick={saveRun}>Save this run locally</button></section>
    {notice && <p className="notice" role="status">{notice}</p>}
    <section className="notes-section" aria-labelledby="lenses-heading"><div><p className="section-kicker">Keep an eye on</p><h2 id="lenses-heading">Observation lenses</h2></div><ul>{activeDish.observationLenses.map((lens) => <li key={lens}>{lens}</li>)}</ul><details><summary>Repeat and external checks</summary><p>{activeDish.repeatVariationGuidance}</p><p><strong>Human judgment:</strong> {activeDish.humanJudgmentRequired ? "Required for this dish; no automated check can settle it." : "Not required by this fixture."}</p><p><strong>Interaction:</strong> {activeDish.interactionRequirements.visualOrInteraction ? `Visual or interaction behavior is part of the fixture; reduced-motion check is ${activeDish.interactionRequirements.reducedMotionCheck}.` : "No visual or interaction behavior is being assessed."}</p>{activeDish.externalCorrectnessChecks.map((check) => <p key={check.title}><strong>{check.kind === "human" ? "Human review" : "Deterministic check"} — {check.title}:</strong> {check.method}</p>)}</details></section>
    <section className="records" aria-labelledby="records-heading"><div className="records-heading"><div><p className="section-kicker">Your browser-local notebook</p><h2 id="records-heading">Saved runs</h2><p>{records.length ? `${records.length} saved run${records.length === 1 ? "" : "s"}. Compare only two runs of the same dish and version.` : "Nothing saved yet. Your first record will appear here."}</p></div><div className="record-actions"><button className="quiet-button" onClick={downloadRecords} disabled={!records.length}>Export JSON</button><button className="quiet-button" onClick={() => fileInput.current?.click()}>Import JSON</button><input ref={fileInput} type="file" accept="application/json,.json" onChange={handleImport} hidden /></div></div>{records.length > 0 && <div className="record-list">{records.map((record) => <article className="record-row" key={record.id}><label className="compare-check"><input type="checkbox" checked={selectedForCompare.includes(record.id)} onChange={() => chooseForComparison(record.id)} aria-label={`Choose ${record.modelLabel} run for comparison`} /><span>Compare</span></label><div><h3>{record.modelLabel}</h3><p>{record.flightTitle} / {record.dishTitle} {record.format.endsWith("v1") && <em>· legacy record</em>}</p></div><time dateTime={record.updatedAt}>{formatDate(record.updatedAt)}</time></article>)}</div>}</section>
    {comparedRecords.length > 0 && <section className="comparison" aria-labelledby="compare-heading"><div><p className="section-kicker">Two-run view</p><h2 id="compare-heading">Compare without collapsing the details.</h2></div><div className={`comparison-grid count-${comparedRecords.length}`}>{comparedRecords.map((record) => <article className="comparison-column" key={record.id}><header><p className="section-kicker">{record.flightTitle}</p><h3>{record.modelLabel}</h3>{record.configuration && <p className="muted">{record.configuration}</p>}{record.activityMode && <p className="muted">{record.activityMode} · {record.claimBoundary}</p>}</header>{record.turns.map((turn, index) => <section className="saved-turn" key={`${turn.turnId}-${index}`}><p className="turn-label">Turn {index + 1} · {turn.label}{turn.stage ? ` · ${turn.stage}` : ""}</p><h4>Prompt</h4><pre>{turn.prompt}</pre><h4>Response</h4><p className="preserved">{turn.response || "No response saved."}</p><h4>Note</h4><p className="preserved">{turn.note || "No note saved."}</p></section>)}<section className="saved-turn"><h4>Overall reflection</h4><p className="preserved">{record.reflection || "No overall reflection saved."}</p></section></article>)}</div></section>}
    <footer><p>Made for manual encounters. Records stay in this browser unless you export them; the kitchen does not execute prompts or create model outputs.</p></footer>
  </main>;
}
