import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Pin, PinOff, ScanSearch, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { axisSetsForDish, observationDisagreements, observationsForDish, shortHash } from "../lib/registry";
import type { AxisSet, Dish, Registry, TasteObservation } from "../types";
import { IconButton } from "./ui/ViewerControls";
import "../styles/observations.css";

// The floating summary is opt-in: tasting comes first, Jev's reading second.
const SUMMARY_KEY = "kitchen.observationSummary";
function summaryPreference(): boolean {
  try { return window.localStorage.getItem(SUMMARY_KEY) === "shown"; } catch { return false; }
}
function rememberSummary(shown: boolean) {
  try { window.localStorage.setItem(SUMMARY_KEY, shown ? "shown" : "hidden"); } catch { /* Preference stays for this view only. */ }
}

function sourceLabel(observation: TasteObservation) {
  return observation.source.kind === "human" ? "Human observation" : "Jev observation";
}

function AxisResults({ observation, axisSet }: { observation: TasteObservation; axisSet?: AxisSet }) {
  return <div className="observation-axes">{observation.axes.map((result) => {
    const axis = axisSet?.axes.find((candidate) => candidate.id === result.axisId);
    const level = axis?.levels.find((candidate) => candidate.id === result.levelId);
    return <section className="observation-axis" key={result.axisId}>
      <header><h4>{axis?.label ?? result.axisId}</h4><span>{level?.label ?? result.levelId}</span></header>
      {result.distribution && <div className="observation-distribution" aria-label={`${axis?.label ?? result.axisId} level distribution`}>{result.distribution.map((item) => <div className="observation-distribution__row" data-selected={item.levelId === result.levelId} key={item.levelId}>
        <span>{axis?.levels.find((candidate) => candidate.id === item.levelId)?.label ?? item.levelId}</span>
        <span className="observation-distribution__track"><span style={{ width: `${item.probability * 100}%` }} /></span>
        <span className="observation-distribution__value">{Math.round(item.probability * 100)}%</span>
      </div>)}</div>}
      {result.note && <p className="observation-note">{result.note}</p>}
    </section>;
  })}</div>;
}

export function TasteObservations({ registry, dish }: { registry: Registry; dish: Dish }) {
  const observations = observationsForDish(registry.observations, dish);
  // Include Menu rubrics used by this Dish as well as its Recipe's available rubrics.
  const selectable = registry.axisSets.filter((set) => axisSetsForDish([set], dish).length || observations.some((item) => item.axisSet.hash === set.rubricHash));
  const latest = [...observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.id.localeCompare(a.id))[0];
  const [selectedHash, setSelectedHash] = useState(latest?.axisSet.hash ?? selectable[0]?.rubricHash ?? "");
  const [open, setOpen] = useState(false);
  const [summaryVisible, setSummaryVisibleState] = useState(summaryPreference);
  const setSummaryVisible = (shown: boolean) => { rememberSummary(shown); setSummaryVisibleState(shown); };
  const selected = selectable.find((set) => set.rubricHash === selectedHash) ?? selectable[0];
  const shown = observations.filter((item) => item.axisSet.hash === selected?.rubricHash);
  const disagreements = observationDisagreements(observations);
  const latestSet = registry.axisSets.find((set) => set.rubricHash === latest?.axisSet.hash);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><IconButton aria-label="Taste observations" title="Taste observations"><ScanSearch size={19} /></IconButton></Dialog.Trigger>
    {latest && summaryVisible && createPortal(<aside className="observation-float" aria-label="Observation summary">
      <button className="observation-float__dismiss" type="button" aria-label="Hide observation summary" onClick={() => setSummaryVisible(false)}><X size={13} /></button>
      <button className="observation-float__body" type="button" aria-label="Open observation details" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span className="observation-float__heading"><ScanSearch size={14} />Observations<span>{latest.source.kind === "human" ? "Human" : "Jev"}</span></span>
        <span className="observation-float__axes">{latest.axes.map((result) => {
          const axis = latestSet?.axes.find((item) => item.id === result.axisId);
          return <span className="observation-float__axis" key={result.axisId}><span>{axis?.label ?? result.axisId}</span><strong>{axis?.levels.find((level) => level.id === result.levelId)?.label ?? result.levelId}</strong></span>;
        })}</span>
        <span className="observation-float__footer">{disagreements.length ? "Human & Jev disagree" : observations.length > 1 ? `${observations.length} observations · latest shown` : `Rubric v${latest.axisSet.version}`}<span>Details <ArrowUpRight size={12} /></span></span>
      </button>
    </aside>, document.body)}
    <Dialog.Portal>
      <Dialog.Overlay className="observation-overlay" />
      <Dialog.Content className="observation-panel" onEscapeKeyDown={(event) => event.stopPropagation()}>
        <header className="observation-panel__header">
          <div><Dialog.Title>Taste observations</Dialog.Title><Dialog.Description>{selected?.title ?? "Observations for this Dish"}</Dialog.Description></div>
          <div className="observation-panel__actions">
            {latest && <button className="observation-pin" type="button" aria-pressed={summaryVisible} aria-label={summaryVisible ? "Hide summary on Dishes" : "Show summary on Dishes"} title={summaryVisible ? "Hide summary on Dishes" : "Show summary on Dishes"} onClick={() => setSummaryVisible(!summaryVisible)}>{summaryVisible ? <PinOff size={16} /> : <Pin size={16} />}</button>}
            <Dialog.Close asChild><button className="observation-close" type="button" aria-label="Close observations"><X size={18} /></button></Dialog.Close>
          </div>
        </header>
        <div className="observation-panel__body">
          {selectable.length > 0 && <div className="observation-versions" role="group" aria-label="Rubric version">{selectable.map((set) => <button type="button" key={set.rubricHash} aria-pressed={set.rubricHash === selected?.rubricHash} onClick={() => setSelectedHash(set.rubricHash)}>
            {set.id !== selected?.id && `${set.title} · `}v{set.version}{set.status === "candidate" && <span>Candidate</span>}
          </button>)}</div>}
          {disagreements.length > 0 && <p className="observation-disagreement" role="status">Disagreement preserved. {disagreements.map((item) => `${item.axisId}: human ${item.human}, Jev ${item.jev}`).join("; ")}</p>}
          {shown.map((observation) => <article className="observation-record" key={observation.id}>
            <header className="observation-record__header"><h3>{sourceLabel(observation)}</h3><time dateTime={observation.observedAt}>{new Date(observation.observedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time></header>
            <AxisResults observation={observation} axisSet={selected} />
            <details className="observation-disclosure"><summary>Evaluator & evidence</summary>
              <dl><dt>Evaluator</dt><dd>{observation.source.evaluator.label ?? observation.source.evaluator.model ?? observation.source.evaluator.id}</dd><dt>Context</dt><dd>{observation.context.kind} · {observation.context.id}</dd><dt>Observed</dt><dd>{new Date(observation.observedAt).toLocaleString()}</dd><dt>Dish</dt><dd>{shortHash(observation.dishHash)}</dd></dl>
              {observation.axes.map((axis) => <p key={axis.axisId}>{selected?.axes.find((item) => item.id === axis.axisId)?.label ?? axis.axisId}: {axis.evidence.map((ref) => ref.path).join(", ")}</p>)}
            </details>
          </article>)}
          {!shown.length && <p className="observation-empty">No observations with this rubric yet.</p>}
          {selected && <details className="observation-disclosure"><summary>About this rubric</summary><p>{selected.purpose}</p>{selected.revisionNote && <p>{selected.revisionNote}</p>}{selected.axes.map((axis) => <section key={axis.id}><h4>{axis.label}</h4><p>{axis.question}</p><dl>{axis.levels.map((level) => <div key={level.id}><dt>{level.label}</dt><dd>{level.description}</dd></div>)}</dl></section>)}<p>Rubric {shortHash(selected.rubricHash)}</p></details>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
