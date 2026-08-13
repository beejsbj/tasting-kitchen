"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import {
  createRecord,
  exportRecords,
  importRecords,
  isRecordComplete,
  type KitchenRecord,
} from "./kitchen-storage.mjs";

type Turn = { id: string; kind: "prompt" | "correction" | "follow-up"; label: string; prompt: string };
type Setup = { context: string; assets: { id: string; title: string; mediaType: string; content: string }[] };
type Dish = {
  id: string; title: string; summary: string; whyItExists: string; setup: Setup; turns: Turn[];
  observationLenses: string[]; repeatVariationGuidance: string; effortEstimate: { label: string; minutes: number };
  externalCorrectnessChecks: { title: string; method: string }[];
};
type Flight = {
  id: string; title: string; family: string; summary: string; whyItExists: string; version: string;
  status: "ready" | "draft" | "retired"; setup: Setup; dishes: Dish[];
  effortEstimate: { label: string; minutes: number };
};

const flightModules = import.meta.glob<{ default: Flight }>("../library/flights/*.json", {
  eager: true,
});
const allFlights = Object.values(flightModules)
  .map((module) => module.default)
  .filter((flight) => flight?.status !== "retired")
  .sort((a, b) => a.title.localeCompare(b.title));
const STORAGE_KEY = "model-tasting-kitchen.records.v1";

function readRecords() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecordComplete) : [];
  } catch {
    return [];
  }
}

function downloadRecords(records: KitchenRecord[]) {
  const blob = new Blob([exportRecords(records)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `model-tasting-kitchen-records-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function Home() {
  const [family, setFamily] = useState("all");
  const visibleFlights = useMemo(
    () => allFlights.filter((flight) => family === "all" || flight.family === family),
    [family],
  );
  const [flightId, setFlightId] = useState("");
  const activeFlight = allFlights.find((flight) => flight.id === flightId) ?? visibleFlights[0] ?? allFlights[0];
  const [dishId, setDishId] = useState("");
  const activeDish = activeFlight?.dishes.find((dish) => dish.id === dishId) ?? activeFlight?.dishes[0];
  const [modelLabel, setModelLabel] = useState("");
  const [configuration, setConfiguration] = useState("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reflection, setReflection] = useState("");
  const [turnIndex, setTurnIndex] = useState(0);
  const [copiedTurn, setCopiedTurn] = useState("");
  const [records, setRecords] = useState<KitchenRecord[]>(() => typeof window === "undefined" ? [] : readRecords());
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const families = useMemo(() => [...new Set(allFlights.map((flight) => flight.family))].sort(), []);
  const currentTurn = activeDish?.turns[turnIndex];
  const comparedRecords = selectedForCompare
    .map((id) => records.find((record) => record.id === id))
    .filter((record): record is KitchenRecord => Boolean(record));

  function persist(next: KitchenRecord[]) {
    setRecords(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function resetDish() {
    setResponses({});
    setNotes({});
    setReflection("");
    setTurnIndex(0);
    setCopiedTurn("");
  }

  function chooseFamily(nextFamily: string) {
    const nextFlights = allFlights.filter((flight) => nextFamily === "all" || flight.family === nextFamily);
    const nextFlight = nextFlights[0];
    setFamily(nextFamily);
    setFlightId(nextFlight?.id ?? "");
    setDishId(nextFlight?.dishes[0]?.id ?? "");
    resetDish();
  }

  function chooseFlight(nextId: string) {
    const nextFlight = allFlights.find((flight) => flight.id === nextId);
    setFlightId(nextId);
    setDishId(nextFlight?.dishes[0]?.id ?? "");
    resetDish();
  }

  function chooseDish(nextId: string) {
    setDishId(nextId);
    resetDish();
  }

  async function copyPrompt(prompt: string, turnId: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedTurn(turnId);
      setNotice("Prompt copied. Paste it into the model yourself, then bring the response back here.");
    } catch {
      setNotice("Copy was unavailable. Select the prompt text and copy it manually.");
    }
  }

  function saveRun() {
    if (!activeFlight || !activeDish) return;
    if (!modelLabel.trim()) {
      setNotice("Add a model label before saving so this run remains identifiable.");
      return;
    }
    const record = createRecord({
      flight: activeFlight, dish: activeDish, modelLabel, configuration, responses, notes, reflection,
    });
    persist([record, ...records]);
    setNotice("Saved locally on this browser. Nothing was sent anywhere.");
  }

  function chooseForComparison(id: string) {
    setSelectedForCompare((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length === 2) {
        setNotice("Comparison is intentionally limited to two runs. Remove one to choose another.");
        return current;
      }
      return [...current, id];
    });
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const result = importRecords(await file.text(), records);
      if (!result.accepted) {
        setNotice("That file was not imported: it does not contain valid kitchen records. Your saved runs were left unchanged.");
        return;
      }
      persist(result.records);
      setNotice(`Imported ${result.imported} new record${result.imported === 1 ? "" : "s"}; ${result.skipped} duplicate or invalid entr${result.skipped === 1 ? "y" : "ies"} skipped.`);
    } catch {
      setNotice("That file could not be read as JSON. Your saved runs were left unchanged.");
    }
  }

  if (!activeFlight || !activeDish || !currentTurn) {
    return <main className="empty-kitchen"><p className="eyebrow">Model Tasting Kitchen</p><h1>The kitchen is waiting for its first flight.</h1><p>Add schema-valid flight files to <code>library/flights</code>, then reload this page.</p></main>;
  }

  return (
    <main>
      <header className="site-header">
        <div><p className="eyebrow">A private field notebook for model encounters</p><h1>Model Tasting Kitchen</h1></div>
        <p className="header-note">Manual prompts. Your notes. No scores.</p>
      </header>

      <section className="orientation" aria-labelledby="start-heading">
        <div><p className="section-kicker">Start a tasting</p><h2 id="start-heading">Choose a flight, then keep the encounter intact.</h2></div>
        <p>Each dish is a small staged conversation. Copy its prompts in order, paste what comes back, and leave the kind of note you would want to find later.</p>
      </section>

      <section className="selector-grid" aria-label="Choose a flight and dish">
        <label><span>Family</span><select value={family} onChange={(event) => chooseFamily(event.target.value)}><option value="all">All families</option>{families.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label><span>Flight</span><select value={activeFlight.id} onChange={(event) => chooseFlight(event.target.value)}>{visibleFlights.map((flight) => <option key={flight.id} value={flight.id}>{flight.title} · {flight.effortEstimate.minutes} min</option>)}</select></label>
        <label><span>Dish</span><select value={activeDish.id} onChange={(event) => chooseDish(event.target.value)}>{activeFlight.dishes.map((dish) => <option key={dish.id} value={dish.id}>{dish.title} · {dish.effortEstimate.minutes} min</option>)}</select></label>
      </section>

      <section className="dish-intro" aria-labelledby="dish-heading">
        <div><p className="section-kicker">{activeFlight.family} · v{activeFlight.version}</p><h2 id="dish-heading">{activeDish.title}</h2><p>{activeDish.summary}</p></div>
        <details><summary>Context &amp; materials</summary><p>{activeFlight.setup.context}</p><p>{activeDish.setup.context}</p>{[...activeFlight.setup.assets, ...activeDish.setup.assets].map((asset) => <article className="asset" key={asset.id}><h3>{asset.title}</h3><pre>{asset.content}</pre></article>)}</details>
      </section>

      <section className="run-details" aria-label="Run details">
        <label><span>Model label <b aria-hidden="true">*</b></span><input value={modelLabel} onChange={(event) => setModelLabel(event.target.value)} placeholder="e.g. model name / version" required /></label>
        <label><span>Configuration <i>(optional)</i></span><input value={configuration} onChange={(event) => setConfiguration(event.target.value)} placeholder="Mode, context, or conditions" /></label>
      </section>

      <section className="stage" aria-labelledby="stage-heading">
        <div className="stage-topline"><div><p className="section-kicker">Work through the turns</p><h2 id="stage-heading">{turnIndex + 1} of {activeDish.turns.length} · {currentTurn.label}</h2></div><span className={`kind kind-${currentTurn.kind}`}>{currentTurn.kind}</span></div>
        <div className="turn-tabs" role="tablist" aria-label="Turns">{activeDish.turns.map((turn, index) => <button key={turn.id} role="tab" aria-selected={index === turnIndex} className={index === turnIndex ? "active" : ""} onClick={() => setTurnIndex(index)}>{index + 1}<span className="sr-only">: {turn.label}</span></button>)}</div>
        <article className="prompt-card"><div className="prompt-heading"><h3>{currentTurn.label}</h3><button className="quiet-button" onClick={() => copyPrompt(currentTurn.prompt, currentTurn.id)}>{copiedTurn === currentTurn.id ? "Copied" : "Copy prompt"}</button></div><pre>{currentTurn.prompt}</pre></article>
        <div className="response-grid"><label><span>Response from the model</span><textarea value={responses[currentTurn.id] ?? ""} onChange={(event) => setResponses({ ...responses, [currentTurn.id]: event.target.value })} placeholder="Paste the response here. Long responses are welcome." /></label><label><span>Your note for this turn</span><textarea className="note-area" value={notes[currentTurn.id] ?? ""} onChange={(event) => setNotes({ ...notes, [currentTurn.id]: event.target.value })} placeholder="What did you notice, correct, or want to revisit?" /></label></div>
        <div className="stage-actions"><button className="quiet-button" disabled={turnIndex === 0} onClick={() => setTurnIndex(turnIndex - 1)}>Previous turn</button><button className="primary-button" disabled={turnIndex === activeDish.turns.length - 1} onClick={() => setTurnIndex(turnIndex + 1)}>Next turn</button></div>
      </section>

      <section className="reflection" aria-labelledby="reflection-heading"><div><p className="section-kicker">Close the run</p><h2 id="reflection-heading">Overall reflection or corrections</h2><p>Leave one note about the whole encounter: what shifted, what held up, or what you would change next time.</p></div><textarea value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="A free-form reflection, not a score." /><button className="primary-button" onClick={saveRun}>Save this run locally</button></section>
      {notice && <p className="notice" role="status">{notice}</p>}

      <section className="notes-section" aria-labelledby="lenses-heading"><div><p className="section-kicker">Keep an eye on</p><h2 id="lenses-heading">Observation lenses</h2></div><ul>{activeDish.observationLenses.map((lens) => <li key={lens}>{lens}</li>)}</ul><details><summary>Repeat and external checks</summary><p>{activeDish.repeatVariationGuidance}</p>{activeDish.externalCorrectnessChecks.map((check) => <p key={check.title}><strong>{check.title}:</strong> {check.method}</p>)}</details></section>

      <section className="records" aria-labelledby="records-heading"><div className="records-heading"><div><p className="section-kicker">Your browser-local notebook</p><h2 id="records-heading">Saved runs</h2><p>{records.length ? `${records.length} saved run${records.length === 1 ? "" : "s"}. Choose up to two to compare.` : "Nothing saved yet. Your first record will appear here."}</p></div><div className="record-actions"><button className="quiet-button" onClick={() => downloadRecords(records)} disabled={!records.length}>Export JSON</button><button className="quiet-button" onClick={() => fileInput.current?.click()}>Import JSON</button><input ref={fileInput} type="file" accept="application/json,.json" onChange={handleImport} hidden /></div></div>
        {records.length > 0 && <div className="record-list">{records.map((record) => <article className="record-row" key={record.id}><label className="compare-check"><input type="checkbox" checked={selectedForCompare.includes(record.id)} onChange={() => chooseForComparison(record.id)} aria-label={`Choose ${record.modelLabel} run for comparison`} /><span>Compare</span></label><div><h3>{record.modelLabel}</h3><p>{record.flightTitle} / {record.dishTitle}</p></div><time dateTime={record.updatedAt}>{formatDate(record.updatedAt)}</time></article>)}</div>}
      </section>

      {comparedRecords.length > 0 && <section className="comparison" aria-labelledby="compare-heading"><div><p className="section-kicker">Two-run view</p><h2 id="compare-heading">Compare without collapsing the details.</h2></div><div className={`comparison-grid count-${comparedRecords.length}`}>{comparedRecords.map((record) => <article className="comparison-column" key={record.id}><header><p className="section-kicker">{record.flightTitle}</p><h3>{record.modelLabel}</h3>{record.configuration && <p className="muted">{record.configuration}</p>}</header>{record.turns.map((turn, index) => <section className="saved-turn" key={`${turn.turnId}-${index}`}><p className="turn-label">Turn {index + 1} · {turn.label}</p><h4>Prompt</h4><pre>{turn.prompt}</pre><h4>Response</h4><p className="preserved">{turn.response || "No response saved."}</p><h4>Note</h4><p className="preserved">{turn.note || "No note saved."}</p></section>)}<section className="saved-turn"><h4>Overall reflection</h4><p className="preserved">{record.reflection || "No overall reflection saved."}</p></section></article>)}</div></section>}

      <footer><p>Made for manual encounters. Records stay in this browser unless you export them.</p></footer>
    </main>
  );
}
