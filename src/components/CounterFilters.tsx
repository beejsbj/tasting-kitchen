import { useRef, useState } from 'react';
import { effortLabel } from '../lib/effort-label';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { dishSkillKey, modelFamily, NO_SKILL } from '../lib/registry';
import { configurationFacets, environmentKeyLabel, harnessLabel } from '../lib/configuration-label';
import { familyOptions } from '../lib/model-facets';
import { groupOptions, SEARCH_THRESHOLD, searchOptions } from '../lib/option-search';
import type { GalleryState } from '../lib/url-state';
import { OUTCOMES, outcomeOf, platesOf } from '../lib/outcomes';
import type { Configuration, Registry } from '../types';

/**
 * The model facet. A short list stays a row of segments; past the search
 * threshold it becomes one button that opens a searchable list grouped by
 * maker, so hundreds of models do not become hundreds of buttons.
 */
function ModelFacet({ configurations, family, segment, choose }: { configurations: readonly Configuration[]; family: string; segment: string; choose: (family: string) => void }) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const options = familyOptions(configurations);
  if (options.length <= SEARCH_THRESHOLD) {
    return <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/60 p-1" role="group" aria-label="Filter by model"><button className={segment} aria-pressed={family === 'all'} onClick={() => choose('all')}>All models</button>{options.map(option => <button key={option.id} className={segment} aria-pressed={family === option.id} onClick={() => choose(option.id)}>{option.label}</button>)}</div>;
  }
  const shown = searchOptions(options, query);
  const current = options.find(option => option.id === family);
  const row = 'flex min-h-10 w-full items-center justify-between gap-3 rounded-md border-0 bg-transparent px-2 py-2 text-left text-sm leading-snug text-slate-700 hover:bg-slate-100 aria-pressed:bg-blue-50 aria-pressed:text-blue-800';
  return <div role="group" aria-label="Filter by model"><Popover.Root onOpenChange={open => { if (!open) setQuery(''); }}><Popover.Trigger asChild><button className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" aria-label={`Filter by model: ${current?.label ?? 'All models'}`}>{current?.label ?? `All ${options.length} models`}<ChevronDown size={14} aria-hidden="true" /></button></Popover.Trigger><Popover.Portal><Popover.Content side="bottom" align="start" sideOffset={8} collisionPadding={12} aria-label="Filter by model" onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus(); }} className="z-40 max-h-[75dvh] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-xl focus:outline-none">
    <label className="mb-2 flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-2"><Search size={14} className="shrink-0 text-slate-400" /><span className="sr-only">Search models</span><input ref={search} className="min-h-0 w-full min-w-0 border-0 bg-transparent text-sm outline-none" type="search" placeholder={`Search ${options.length} models or makers`} value={query} onChange={event => setQuery(event.target.value)} /></label>
    <p className="sr-only" aria-live="polite">{`${shown.length} of ${options.length} models shown`}</p>
    <Popover.Close asChild><button className={row} aria-pressed={family === 'all'} onClick={() => choose('all')}>All models{family === 'all' && <Check size={16} className="shrink-0" />}</button></Popover.Close>
    {groupOptions(shown).map(({ group, options: members }) => <div key={group} role="group" aria-label={group} className="border-t border-slate-100 pt-1 mt-1"><p className="mb-1 mt-2 px-2 text-xs font-semibold text-slate-500">{group}</p>{members.map(option => <Popover.Close asChild key={option.id}><button className={row} aria-pressed={family === option.id} onClick={() => choose(option.id)}><span className="inline-flex items-center gap-2">{option.label}{option.badge && <span className="axis-option__badge">{option.badge}</span>}</span>{family === option.id && <Check size={16} className="shrink-0" />}</button></Popover.Close>)}</div>)}
    {!shown.length && <p className="px-2 py-3 text-sm text-slate-500">{`No model matches “${query}”`}</p>}
  </Popover.Content></Popover.Portal></Popover.Root></div>;
}

export function CounterFilters({ registry, state, update }: { registry: Registry; state: GalleryState; update: (patch: Partial<GalleryState>, mode?: 'push' | 'replace') => void }) {
  const cuisines = registry.cuisines.filter(cuisine => registry.recipes.some(recipe => recipe.cuisines.includes(cuisine.id)));
  const lineages = [{ id: 'all', label: 'All lineages' }, { id: 'textbook', label: 'Textbook' }, { id: 'mothers', label: 'Mother’s' }, { id: 'hybrid', label: 'Hybrid' }];
  const count = Number(state.cuisine !== 'all') + Number(state.origin !== 'all');
  const skillsWithDishes = (registry.skills ?? []).filter(skill => platesOf(registry).some(dish => dish.skill?.hash === skill.skillHash));
  const hasUnskilled = platesOf(registry).some(dish => dishSkillKey(dish) === NO_SKILL);
  const showSkills = skillsWithDishes.length > 0;
  const facets = configurationFacets(registry.configurations);
  // Outcome appears once there is more than one: a No Dish, or a Dish Burooj failed.
  const outcomes = OUTCOMES.filter(option => platesOf(registry).some(plate => outcomeOf(registry, plate) === option.id));
  const facetRows = ([{ key: 'harness', title: 'Harness', all: 'All harnesses', options: facets.harnesses }, { key: 'environment', title: 'Environment', all: 'All environments', options: facets.environments }] as const).filter(row => row.options.length > 1);
  const chips = [
    ...(['cuisine', 'origin'] as const).filter(key => state[key] !== 'all').map(key => ({ key, label: key === 'cuisine' ? cuisines.find(item => item.id === state[key])?.label ?? state[key] : lineages.find(item => item.id === state[key])?.label ?? state[key] })),
    ...(state.harness !== 'all' ? [{ key: 'harness' as const, label: `Harness: ${harnessLabel(state.harness)}` }] : []),
    ...(state.environment !== 'all' ? [{ key: 'environment' as const, label: `Environment: ${environmentKeyLabel(state.environment)}` }] : []),
    ...(state.tier !== 'all' ? [{ key: 'tier' as const, label: `Service tier: ${state.tier}` }] : []),
    ...(state.outcome !== 'all' ? [{ key: 'outcome' as const, label: `Outcome: ${OUTCOMES.find(option => option.id === state.outcome)?.label ?? state.outcome}` }] : []),
  ];
  const segment = 'min-h-9 rounded-md border-0 bg-transparent px-2 text-sm font-medium text-slate-600 hover:bg-white aria-pressed:bg-white aria-pressed:text-blue-800 aria-pressed:shadow-sm';
  return <div className="counter-controls">
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex h-11 min-w-48 flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 lg:max-w-sm"><Search size={16} className="shrink-0 text-slate-400" /><span className="sr-only">Search recipes</span><input className="min-h-0 w-full min-w-0 border-0 bg-transparent text-sm text-slate-800 outline-none" type="search" placeholder="Search recipes" value={state.query} onChange={event => update({ query: event.target.value }, 'replace')} /></label>
      <ModelFacet configurations={registry.configurations} family={state.family} segment={segment} choose={family => update({ family, effort: 'all' })} />
      <Popover.Root><Popover.Trigger asChild><button className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" aria-label="Cuisine and lineage filters"><SlidersHorizontal size={16} />Filters{count > 0 && <span className="rounded bg-blue-50 px-1.5 text-xs text-blue-800">{count}</span>}</button></Popover.Trigger><Popover.Portal><Popover.Content side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-label="Cuisine and lineage filters" className="z-40 max-h-[75dvh] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-xl focus:outline-none">
        {([{ key: 'cuisine', title: 'Cuisine', options: [{ id: 'all', label: 'All cuisines' }, ...cuisines] }, { key: 'origin', title: 'Lineage', options: lineages }] as const).map(group => <div key={group.key} role="group" aria-label={group.title} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0"><p className="mb-1 mt-2 px-2 text-xs font-semibold text-slate-500">{group.title}</p>{group.options.map(option => <button key={option.id} aria-pressed={state[group.key] === option.id} onClick={() => update({ [group.key]: option.id })} className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md border-0 bg-transparent px-2 py-2 text-left text-sm leading-snug text-slate-700 hover:bg-slate-100 aria-pressed:bg-blue-50 aria-pressed:text-blue-800">{option.label}{state[group.key] === option.id && <Check size={16} className="shrink-0" />}</button>)}</div>)}
      </Popover.Content></Popover.Portal></Popover.Root>
    </div>
    {state.family !== 'all' && <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label="Filter by thinking effort"><span className="mr-2 text-xs text-slate-500">Thinking</span><button className={segment} aria-pressed={state.effort === 'all'} onClick={() => update({ effort: 'all' })}>All efforts</button>{[...new Set(registry.configurations.filter(config => modelFamily(config.model) === state.family).map(config => config.reasoningEffort))].map(effort => <button key={effort} title={`${effort} reasoning effort`} aria-label={`${effort} reasoning effort`} className={segment} aria-pressed={state.effort === effort} onClick={() => update({ effort })}>{effortLabel(effort)}</button>)}</div>}
    {showSkills && <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label="Filter by skill layer"><span className="mr-2 text-xs text-slate-500">Skill</span><button className={segment} aria-pressed={state.skill === 'all'} onClick={() => update({ skill: 'all' })}>All layers</button>{hasUnskilled && <button className={segment} aria-pressed={state.skill === NO_SKILL} onClick={() => update({ skill: NO_SKILL })}>Without skill</button>}{skillsWithDishes.map(skill => <button key={skill.id} className={segment} title={skill.summary} aria-pressed={state.skill === skill.id} onClick={() => update({ skill: skill.id })}>{skill.label}</button>)}</div>}
    {(outcomes.length > 1 || state.outcome !== 'all') && <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label="Filter by outcome"><span className="mr-2 text-xs text-slate-500">Outcome</span><button className={segment} aria-pressed={state.outcome === 'all'} onClick={() => update({ outcome: 'all' })}>All outcomes</button>{OUTCOMES.map(option => <button key={option.id} className={segment} title={option.title} aria-pressed={state.outcome === option.id} onClick={() => update({ outcome: option.id })}>{option.label}</button>)}</div>}
    {facetRows.map(row => <div key={row.key} className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label={`Filter by ${row.title.toLowerCase()}`}><span className="mr-2 text-xs text-slate-500">{row.title}</span><button className={segment} aria-pressed={state[row.key] === 'all'} onClick={() => update({ [row.key]: 'all' })}>{row.all}</button>{row.options.map(option => <button key={option.id} className={segment} aria-pressed={state[row.key] === option.id} onClick={() => update({ [row.key]: option.id })}>{option.label}</button>)}</div>)}
    {chips.length > 0 && <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Active filters">{chips.map(chip => <button key={chip.key} aria-label={`Remove ${chip.label} filter`} onClick={() => update({ [chip.key]: 'all' })} className="inline-flex min-h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600">{chip.label}<X size={12} /></button>)}</div>}
  </div>;
}
