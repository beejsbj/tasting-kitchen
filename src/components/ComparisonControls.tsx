import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { AxisPicker, CookedMark, dishCountLabel, type AxisPickerAxis, type AxisPickerOption } from './AxisPicker';
import { KitchenButton } from './KitchenButton';
import { IconButton } from './ui/ViewerControls';
import { dishSkillKey, shortHash } from '../lib/registry';
import { AXIS_LABELS, axisOptions, axisValue, axisValueLabel, carryComparisonSelection, COMPARE_AXES, comparisonValues, cookedValues, defaultComparisonSelection, heldConfigLabels, MAX_PANES, showsAxis, snapshotOptions, toggleComparisonValue, type CompareAxis, type ConfigAxis } from '../lib/configuration-axes';
import { isFreeModel, makerLabel, modelMaker, type ComparisonDimension } from '../lib/configuration-label';
import type { GalleryState } from '../lib/url-state';
import { isNoDish } from '../lib/outcomes';
import type { Configuration, Plate } from '../types';

/** A skill layer this recipe offers; `changed` marks a layer pinned by an older catalog. */
export type LayerChoice = { token: string; key: string; label: string; changed?: boolean };
export type Pane = { config: Configuration; skillKey: string; dish?: Plate; repeats: Plate[] };
export type ComparisonContext = {
  configurations: Configuration[];
  /** Dishes and No Dishes: a No Dish covers its cell, so it counts as cooked. */
  recipeDishes: Plate[];
  layerChoices: LayerChoice[];
  showLayers: boolean;
};
type Patch = Partial<GalleryState>;

/** Counts this recipe's plates (Dishes and No Dishes) for a configuration, within one skill layer when given. */
export const dishCounter = (recipeDishes: Plate[], skillKey?: string) => (config: Configuration) =>
  recipeDishes.filter((dish) => dish.identity.configHash === config.configHash && (!skillKey || dishSkillKey(dish) === skillKey)).length;
/** The No Dishes among them, so a count can say "1 no dish" rather than call it a Dish. */
const noDishCounter = (recipeDishes: Plate[], skillKey?: string) => dishCounter(recipeDishes.filter(isNoDish), skillKey);

const layerToken = (context: ComparisonContext, key: string) => context.showLayers ? context.layerChoices.find((choice) => choice.key === key)?.token ?? key : '';
const layerLabel = (context: ComparisonContext, key: string) => context.layerChoices.find((choice) => choice.key === key)?.label ?? 'Without skill';
/** Compare by offers Tier only when this recipe has more than one cooked. */
const axisVaries = (context: ComparisonContext, axis: ConfigAxis) => cookedValues(context.configurations, axis, dishCounter(context.recipeDishes)).length > 1;
export const valueOf = (pane: Pick<Pane, 'config' | 'skillKey'>, axis: CompareAxis) => axis === 'skill' ? pane.skillKey : axisValue(pane.config, axis);

export type ComparisonValueView = {
  value: string; label: string; dishes: number; isolated: boolean; held: boolean;
  differs: string[]; config: Configuration; token: string;
};

/** The values "Compare by `axis`" offers from the held pane, in display order. */
export function comparisonValuesFor(context: ComparisonContext, anchor: Pick<Pane, 'config' | 'skillKey'>, axis: CompareAxis): ComparisonValueView[] {
  if (axis === 'skill') {
    const count = (key: string) => dishCounter(context.recipeDishes, key)(anchor.config);
    return context.layerChoices.filter((choice) => !choice.changed || choice.key === anchor.skillKey || count(choice.key) > 0)
      .map((choice) => ({ value: choice.key, label: choice.label, dishes: count(choice.key), isolated: true, held: choice.key === anchor.skillKey, differs: [], config: anchor.config, token: choice.token }));
  }
  const token = layerToken(context, anchor.skillKey);
  return comparisonValues(context.configurations, anchor.config, axis, dishCounter(context.recipeDishes, anchor.skillKey), dishCounter(context.recipeDishes))
    .map((item) => ({ value: item.value, label: item.label, dishes: item.dishes, isolated: item.isolated, held: item.held, differs: item.differs.map((difference) => difference.label), config: item.config, token }));
}

/** The URL patch that lays out one pane per selected value, the held pane first and kept exactly. */
export function comparisonPatch(axis: CompareAxis, values: ComparisonValueView[], selection: readonly string[], heldDish?: string): Patch {
  const panes = selection.map((value) => values.find((item) => item.value === value)).filter((item): item is ComparisonValueView => Boolean(item));
  return { compare: axis, models: panes.map((pane) => pane.config.id), skills: panes.map((pane) => pane.token), dishes: panes.map((pane) => pane.held ? heldDish ?? '' : '') };
}

/** What a "Compare by" layout holds still, as value labels from the held pane. */
export function heldLabels(context: ComparisonContext, anchor: Pick<Pane, 'config' | 'skillKey'>, axis: CompareAxis, differing: readonly ComparisonDimension[] = []) {
  return [...heldConfigLabels(context.configurations, anchor.config, axis, dishCounter(context.recipeDishes), differing), ...(context.showLayers && axis !== 'skill' && !differing.includes('skill layer') ? [layerLabel(context, anchor.skillKey)] : [])];
}

/** The axis chips for one pane: Model · Effort · Harness, then Environment, Tier, Skill and Snapshot where they vary. */
function paneAxes(context: ComparisonContext, pane: Pane, onConfig: (config: Configuration) => void, onLayer: (token: string) => void, except?: CompareAxis): AxisPickerAxis[] {
  const count = dishCounter(context.recipeDishes);
  const noDishes = noDishCounter(context.recipeDishes);
  const shown: ConfigAxis[] = (['model', 'effort', 'harness', 'environment', 'tier'] as const).filter((axis) => axis !== except && showsAxis(context.configurations, pane.config, axis, count));
  const axes: AxisPickerAxis[] = shown.map((axis) => ({
    id: axis, label: axis === 'tier' ? 'Tier' : AXIS_LABELS[axis], value: axisValueLabel(axis, axisValue(pane.config, axis)),
    ...(axis === 'model' && isFreeModel(pane.config) ? { badge: 'Free' } : {}),
    options: axisOptions(context.configurations, pane.config, axis, count).map((option): AxisPickerOption => ({
      key: option.value, label: option.label, status: option.status, dishes: option.dishes, noDishes: option.config ? noDishes(option.config) : 0, selected: option.selected,
      // Hundreds of models stay findable: grouped by maker, searchable by id, free ones marked.
      ...(axis === 'model' ? { group: makerLabel(modelMaker(option.value)), terms: option.value, ...(isFreeModel(option.config ?? { model: option.value }) ? { badge: 'Free' } : {}) } : {}),
      note: option.reason ?? (option.changes.length ? `also → ${option.changes.map((change) => change.label).join(' · ')}` : option.config?.historical ? 'preserved configuration' : undefined),
      onSelect: () => option.config && onConfig(option.config),
    })),
  }));
  if (context.showLayers && except !== 'skill') {
    axes.push({ id: 'skill', label: 'Skill', value: layerLabel(context, pane.skillKey), options: context.layerChoices.map((choice) => {
      const dishes = context.recipeDishes.filter((dish) => dish.identity.configHash === pane.config.configHash && dishSkillKey(dish) === choice.key).length;
      return { key: choice.key, label: choice.label, status: dishes ? 'cooked' : 'uncooked', dishes, noDishes: noDishCounter(context.recipeDishes, choice.key)(pane.config), selected: choice.key === pane.skillKey, onSelect: () => onLayer(choice.token) };
    }) });
  }
  const snapshots = snapshotOptions(context.configurations, pane.config);
  if (snapshots.length > 1) axes.push({ id: 'snapshot', label: 'Snapshot', value: pane.config.historical ? `Preserved · ${shortHash(pane.config.configHash ?? pane.config.id)}` : 'Current', options: snapshots.map((config) => {
    const dishes = count(config);
    return { key: config.id, noDishes: noDishes(config), label: config.historical ? `Preserved · ${shortHash(config.configHash ?? config.id)}` : config.id, status: dishes ? 'cooked' : 'uncooked', dishes, selected: config.id === pane.config.id, onSelect: () => onConfig(config) };
  }) });
  return axes;
}

/** One pane's axis chips, for the viewer and the style guide. */
export function PaneAxisPicker({ context, pane, label, onConfig, onLayer }: { context: ComparisonContext; pane: Pane; label: string; onConfig: (config: Configuration) => void; onLayer: (token: string) => void }) {
  return <AxisPicker label={label} axes={paneAxes(context, pane, onConfig, onLayer)} />;
}

/**
 * The body of the viewer's "Models and comparison" popover. "Compare by" holds
 * the first pane still and lays out a pane per value of one axis; without it,
 * each pane is chosen axis by axis.
 */
export function ComparisonControls({ context, title, panes, compare, comparisonNote, update }: {
  context: ComparisonContext; title: string; panes: Pane[]; compare: CompareAxis | ''; comparisonNote: string;
  update: (patch: Patch) => void;
}) {
  // Removing a pane or leaving "Compare by" unmounts the focused control; focus moves on once the new layout renders.
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef<{ panes: number; compare: CompareAxis | ''; index: number } | undefined>(undefined);
  useEffect(() => {
    const wanted = pending.current;
    if (!wanted || wanted.panes !== panes.length || wanted.compare !== compare) return;
    pending.current = undefined;
    (root.current?.querySelector<HTMLElement>(`[data-pane="${Math.min(wanted.index, panes.length - 1)}"] .axis-chip`) ?? root.current?.querySelector<HTMLElement>('.compare-axis'))?.focus();
  });
  const anchor = panes[0];
  if (!anchor) return null;
  const tokens = panes.map((pane) => layerToken(context, pane.skillKey));
  const current = (overrides: Partial<Record<'models' | 'skills' | 'dishes', string[]>> = {}): Patch => ({ models: panes.map((pane) => pane.config.id), skills: tokens, dishes: panes.map((pane) => pane.dish?.id ?? ''), ...overrides });
  const offers = COMPARE_AXES.filter((axis) => axis === 'skill' ? context.showLayers : axis === 'tier' ? axisVaries(context, 'tier') : true)
    .map((axis) => ({ axis, values: comparisonValuesFor(context, anchor, axis) }));
  const startComparing = (axis: CompareAxis) => {
    const values = comparisonValuesFor(context, anchor, axis);
    update(comparisonPatch(axis, values, defaultComparisonSelection(values), anchor.dish?.id));
  };
  const chooseConfig = (index: number, config: Configuration) => {
    const keepsLayer = context.recipeDishes.some((dish) => dish.identity.configHash === config.configHash && dishSkillKey(dish) === panes[index].skillKey);
    const models = panes.map((pane) => pane.config.id); models[index] = config.id;
    const skills = [...tokens]; skills[index] = keepsLayer ? tokens[index] : '';
    const dishes = panes.map((pane) => pane.dish?.id ?? ''); dishes[index] = '';
    update({ compare: '', models, skills, dishes });
  };
  const chooseLayer = (index: number, token: string) => {
    const skills = [...tokens]; skills[index] = token;
    const dishes = panes.map((pane) => pane.dish?.id ?? ''); dishes[index] = '';
    update({ ...current({ skills, dishes }), compare: '' });
  };
  const remove = (index: number) => {
    // The next pane's first chip now sits at this index; when the last pane went, the one before it is nearest.
    pending.current = { panes: panes.length - 1, compare: '', index };
    update({ compare: '', models: panes.filter((_, i) => i !== index).map((pane) => pane.config.id), skills: tokens.filter((_, i) => i !== index), dishes: panes.filter((_, i) => i !== index).map((pane) => pane.dish?.id ?? '') });
  };

  const repeatGroups = panes.length > 1 && panes.some((pane) => pane.repeats.length > 1) && <div className="mt-4 border-t border-slate-100 pt-3">
    <p className="mb-1 text-xs font-medium text-slate-500">Repeats</p>
    {panes.map(({ repeats, dish }, index) => repeats.length > 1 && <div key={index} className="mt-1 flex flex-wrap items-center gap-1" role="group" aria-label={`Dishes for configuration ${index + 1}`}><span className="mr-1 w-14 text-xs text-slate-500">Pane {index + 1}</span>{repeats.map((repeat, i) => <IconButton key={repeat.id} aria-label={`Repeat ${i + 1} for configuration ${index + 1}`} aria-pressed={dish?.id === repeat.id} onClick={() => { const dishes = panes.map((pane) => pane.dish?.id ?? ''); dishes[index] = repeat.id; update({ skills: tokens, dishes }); }}>{i + 1}</IconButton>)}</div>)}
  </div>;

  const compareBy = <div className="mb-4" role="group" aria-label="Compare by">
    <p className="mb-1 text-xs font-medium text-slate-500">Compare by</p>
    <div className="flex flex-wrap gap-1">{offers.map(({ axis, values }) => {
      // The count is how many values hold everything else still and have a Dish.
      const cooked = values.filter((item) => item.isolated && item.dishes > 0).length;
      const label = AXIS_LABELS[axis].toLowerCase();
      // A comparison needs a second value that holds everything else; otherwise it would open on the held pane alone.
      const unavailable = defaultComparisonSelection(values).length < 2;
      const why = values.length < 2 ? `only one ${label} for this pane` : `no other ${label} cooked with the rest held`;
      return <KitchenButton key={axis} className="compare-axis" aria-pressed={compare === axis} aria-disabled={unavailable || undefined}
        aria-label={`Compare by ${label} · ${unavailable ? why : `${cooked} cooked with the rest held`}`}
        title={unavailable ? `Needs a second ${label} that holds everything else; ${why}` : `${cooked} of ${values.length} have a Dish with everything else held`}
        onClick={() => compare === axis || unavailable ? undefined : startComparing(axis)}>{AXIS_LABELS[axis]}<span className="compare-axis__count">{cooked}</span></KitchenButton>;
    })}</div>
  </div>;

  if (compare) {
    const values = comparisonValuesFor(context, anchor, compare);
    const selection = panes.map((pane) => valueOf(pane, compare));
    const order = values.map((item) => item.value);
    const held = values.find((item) => item.held)?.value ?? selection[0];
    const rehold = (config: Configuration, skillKey: string) => {
      const next = comparisonValuesFor(context, { config, skillKey }, compare);
      update(comparisonPatch(compare, next, carryComparisonSelection(selection, next), undefined));
    };
    const full = selection.length >= MAX_PANES;
    return <div ref={root}>
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {compareBy}
      <section className="mb-4" aria-label="Held still">
        <p className="mb-1 text-xs font-medium text-slate-500">Held still · pane 1</p>
        <AxisPicker label="Held configuration" axes={paneAxes(context, anchor, (config) => rehold(config, anchor.skillKey), (token) => rehold(anchor.config, context.layerChoices.find((choice) => choice.token === token)?.key ?? token), compare)} />
      </section>
      <section aria-label={`${AXIS_LABELS[compare]} values`}>
        <p className="mb-1 flex justify-between text-xs font-medium text-slate-500"><span>{AXIS_LABELS[compare]} · one pane each</span><span>{selection.length} of {values.length}</span></p>
        <ul className="compare-values">{values.map((item) => {
          const checked = selection.includes(item.value);
          const disabled = item.held || (!checked && full);
          const status = item.dishes ? 'cooked' : 'uncooked';
          return <li key={item.value}><label className="compare-value" data-checked={checked} data-disabled={disabled}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={() => update(comparisonPatch(compare, values, toggleComparisonValue(selection, item.value, held, order), panes[0].dish?.id))} />
            <CookedMark status={status} />
            <span className="compare-value__label">{item.label}{item.held ? <small>held pane</small> : !item.isolated ? <small>also differs · {item.differs.join(' · ')}</small> : null}</span>
            <span className="axis-option__count">{dishCountLabel({ status, dishes: item.dishes, noDishes: noDishCounter(context.recipeDishes, compare === 'skill' ? item.value : panes[0].skillKey)(item.config) })}</span>
          </label></li>;
        })}</ul>
        {full && values.length > selection.length && <p className="mt-1 text-xs text-slate-500">Six panes is the most; clear one to add another.</p>}
      </section>
      {repeatGroups}
      <p className="mb-0 mt-4 text-xs leading-relaxed text-slate-500">{comparisonNote}</p>
      <div className="mt-3 flex justify-end"><KitchenButton onClick={() => { pending.current = { panes: panes.length, compare: '', index: 0 }; update({ compare: '' }); }}>Choose panes one by one</KitchenButton></div>
    </div>;
  }

  return <div ref={root}>
    <h2 className="mb-4 text-base font-semibold">{title}</h2>
    {compareBy}
    <div>{panes.map((pane, index) => <section key={index} data-pane={index} className="mb-3 border-b border-slate-100 pb-3 last:mb-0 last:border-0 last:pb-0" aria-label={panes.length > 1 ? `Pane ${index + 1}` : 'This pane'}>
      <div className="mb-1 flex min-h-8 items-center justify-between"><span className="text-xs font-medium text-slate-500">{panes.length > 1 ? `Pane ${index + 1}` : 'This pane'}</span>{panes.length > 1 && <button className="inline-flex min-h-8 items-center gap-1 rounded-md border-0 bg-transparent px-2 text-xs text-slate-500 hover:bg-slate-100" aria-label={`Remove configuration ${index + 1}`} onClick={() => remove(index)}>Remove<X size={12} aria-hidden="true" /></button>}</div>
      <AxisPicker label={`Configuration ${index + 1}`} axes={paneAxes(context, pane, (config) => chooseConfig(index, config), (token) => chooseLayer(index, token))} />
    </section>)}</div>
    {repeatGroups}
    {panes.length > 1 && <p className="mb-0 mt-4 text-xs leading-relaxed text-slate-500">{comparisonNote}</p>}
  </div>;
}
