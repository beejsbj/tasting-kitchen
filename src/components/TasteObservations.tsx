import { useMemo, useState } from "react";

import { axisSetsForDish, observationDisagreements, observationsForDish, shortHash } from "../lib/registry";
import type { AxisSet, Dish, Registry, TasteObservation } from "../types";

function sourceLabel(observation: TasteObservation) {
  return observation.source.kind === "human" ? "Human observation" : "Jev observation";
}

function AxisResult({ observation, axisSet }: { observation: TasteObservation; axisSet?: AxisSet }) {
  return <div className="border-t border-slate-100 py-3 first:border-0">
    {observation.axes.map((result) => {
      const axis = axisSet?.axes.find((candidate) => candidate.id === result.axisId);
      const level = axis?.levels.find((candidate) => candidate.id === result.levelId);
      return <section className="mb-3 last:mb-0" key={result.axisId}>
        <div className="flex items-baseline justify-between gap-3"><h4 className="m-0 text-xs font-semibold text-slate-700">{axis?.label ?? result.axisId}</h4><span className="text-xs text-slate-500">{level?.label ?? result.levelId}</span></div>
        {result.distribution && <div className="mt-2 space-y-1" aria-label={`${axis?.label ?? result.axisId} level distribution`}>{result.distribution.map((item) => {
          const itemLevel = axis?.levels.find((candidate) => candidate.id === item.levelId);
          return <div className="grid grid-cols-[minmax(5rem,1fr)_4fr_3rem] items-center gap-2 text-[11px] text-slate-500" key={item.levelId}><span>{itemLevel?.label ?? item.levelId}</span><span className="h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${Math.round(item.probability * 100)}%` }} /></span><span className="text-right tabular-nums">{Math.round(item.probability * 100)}%</span></div>;
        })}</div>}
        <p className="mb-0 mt-2 text-[11px] text-slate-400">Evidence: {result.evidence.map((reference) => reference.path).join(", ")}</p>
      </section>;
    })}
  </div>;
}

export function TasteObservations({ registry, dish }: { registry: Registry; dish: Dish }) {
  const selectable = useMemo(() => axisSetsForDish(registry.axisSets, dish), [registry.axisSets, dish]);
  const observations = useMemo(() => observationsForDish(registry.observations, dish), [registry.observations, dish]);
  const [selectedHash, setSelectedHash] = useState(() => selectable.find((axisSet) => axisSet.status === "active")?.rubricHash ?? selectable[0]?.rubricHash ?? "");
  const selected = selectable.find((axisSet) => axisSet.rubricHash === selectedHash) ?? selectable[0];
  const disagreements = observationDisagreements(observations);
  return <div className="w-full">
    <h2 className="mb-1 text-base font-semibold">Taste observations</h2>
    <p className="mt-0 text-xs leading-relaxed text-slate-500">Observations sit beside this immutable Dish. They do not alter its artifact, Repeat group, or Menu coverage.</p>
    {selectable.length > 0 && <section className="mt-4 rounded-lg border border-slate-200 p-3">
      <label className="text-xs font-medium text-slate-600">Inspectable axis set
        <select className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" value={selected?.rubricHash} onChange={(event) => setSelectedHash(event.target.value)}>{selectable.map((axisSet) => <option value={axisSet.rubricHash} key={axisSet.rubricHash}>{axisSet.title} · v{axisSet.version} · {axisSet.status}</option>)}</select>
      </label>
      {selected && <><p className="mb-2 text-xs text-slate-500">{selected.purpose}</p><ul className="m-0 space-y-2 pl-4 text-xs text-slate-600">{selected.axes.map((axis) => <li key={axis.id}><strong>{axis.label}</strong> — {axis.question}</li>)}</ul><p className="mb-0 mt-2 text-[11px] text-slate-400">Rubric {shortHash(selected.rubricHash)}. Evaluation requires choosing this exact version.</p></>}
    </section>}
    {disagreements.length > 0 && <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" role="status"><strong>Disagreement preserved.</strong> {disagreements.map((item) => `${item.axisId}: human ${item.human}, Jev ${item.jev}`).join("; ")}</div>}
    <div className="mt-4 space-y-3">{observations.map((observation) => {
      const axisSet = registry.axisSets.find((candidate) => candidate.rubricHash === observation.axisSet.hash);
      return <article className="rounded-lg border border-slate-200 p-3" key={observation.id}>
        <header className="flex items-start justify-between gap-3"><div><h3 className="m-0 text-sm font-semibold">{sourceLabel(observation)}</h3><p className="m-0 text-xs text-slate-500">{observation.source.evaluator.label ?? observation.source.evaluator.model ?? observation.source.evaluator.id}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-600">v{observation.axisSet.version}</span></header>
        <p className="mb-0 mt-2 text-[11px] text-slate-400">{observation.context.kind} · {observation.context.id} · {new Date(observation.observedAt).toLocaleString()}</p>
        <AxisResult observation={observation} axisSet={axisSet} />
      </article>;
    })}</div>
    {!observations.length && <p className="mt-4 text-sm text-slate-500">No observations are attached to this Dish yet.</p>}
  </div>;
}
