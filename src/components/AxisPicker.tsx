import { Fragment, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { groupOptions, SEARCH_THRESHOLD, searchOptions } from '../lib/option-search';

export type AxisPickerOption = {
  key: string;
  label: string;
  status: 'cooked' | 'uncooked' | 'impossible';
  dishes: number;
  selected: boolean;
  /** What else moves when this value is chosen, or why it cannot be. */
  note?: string;
  /** A heading the option sits under, such as the model's maker. */
  group?: string;
  /** A short mark beside the label, such as "Free". */
  badge?: string;
  /** Words search also matches, such as the raw model id. */
  terms?: string;
  onSelect: () => void;
};
export type AxisPickerAxis = { id: string; label: string; value: string; badge?: string; options: AxisPickerOption[] };

/** Filled: a Dish exists. Ring: reachable, not cooked. Dash: no such configuration. */
export function CookedMark({ status }: { status: AxisPickerOption['status'] }) {
  return <span aria-hidden="true" data-status={status} className="cooked-mark" />;
}

export function dishCountLabel(option: Pick<AxisPickerOption, 'status' | 'dishes'>) {
  if (option.status === 'impossible') return 'unavailable';
  return option.dishes ? `${option.dishes} ${option.dishes === 1 ? 'dish' : 'dishes'}` : 'not cooked';
}

/**
 * One pane's configuration as a compact row of axis chips. A chip opens its
 * values inline beneath the row, so the picker works inside a popover, on a
 * phone, and from the keyboard (arrows move, Escape returns to the chip). A
 * value no configuration offers stays focusable with aria-disabled, so its
 * reason can be read. A long list (hundreds of models) opens with a search
 * field and groups its values under their headings, such as the maker.
 */
export function AxisPicker({ label, axes }: { label: string; axes: AxisPickerAxis[] }) {
  const [open, setOpen] = useState<string>();
  const [query, setQuery] = useState('');
  const chips = useRef(new Map<string, HTMLButtonElement>());
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const openAxis = axes.find((axis) => axis.id === open);
  const searchable = (openAxis?.options.length ?? 0) > SEARCH_THRESHOLD;
  const shown = openAxis ? searchOptions(openAxis.options, searchable ? query : '') : [];
  const groups = groupOptions(shown);
  const headed = searchable && groups.length > 1;
  const focusCurrent = () => requestAnimationFrame(() => (search.current ?? list.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? list.current?.querySelector<HTMLButtonElement>('button'))?.focus());
  const toggle = (axisId: string) => { setQuery(''); if (open === axisId) setOpen(undefined); else { setOpen(axisId); focusCurrent(); } };
  const close = (focus = true) => { if (focus && open) chips.current.get(open)?.focus(); setOpen(undefined); setQuery(''); };
  const buttons = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
  const onListKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const all = buttons();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    // Up from the first option returns to the search field.
    if (search.current && event.key === 'ArrowUp' && index === 0) { event.preventDefault(); search.current.focus(); return; }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
    event.preventDefault(); all[next]?.focus();
  };
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (query) setQuery(''); else close(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons()[0]?.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); if (query) buttons().find((button) => button.getAttribute('aria-disabled') !== 'true')?.click(); }
  };
  const optionButton = (option: AxisPickerOption) => <button key={option.key} type="button" className="axis-option" aria-pressed={option.selected} aria-disabled={option.status === 'impossible' || undefined}
    aria-label={`${option.label}${option.badge ? ` · ${option.badge}` : ''} · ${dishCountLabel(option)}${option.note ? ` · ${option.note}` : ''}`}
    onKeyDown={onListKey} onClick={() => { if (option.status === 'impossible') return; if (!option.selected) option.onSelect(); close(); }}>
    <CookedMark status={option.status} />
    <span className="axis-option__label"><span className="axis-option__name">{option.label}{option.badge && <span className="axis-option__badge">{option.badge}</span>}</span>{option.note && <small>{option.note}</small>}</span>
    <span className="axis-option__count">{dishCountLabel(option)}</span>
  </button>;
  return <div role="group" aria-label={label} className="axis-picker">
    <div className="flex flex-wrap gap-1">{axes.map((axis) => <button key={axis.id} type="button" ref={(node) => { if (node) chips.current.set(axis.id, node); else chips.current.delete(axis.id); }}
      className="axis-chip" aria-expanded={open === axis.id} aria-controls={open === axis.id ? `${id}-options` : undefined} aria-label={`${axis.label}: ${axis.value}${axis.badge ? ` · ${axis.badge}` : ''}`}
      onClick={() => toggle(axis.id)}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' && open !== axis.id) { event.preventDefault(); toggle(axis.id); } }}>
      <span className="axis-chip__axis">{axis.label}</span><span className="axis-chip__value">{axis.value}{axis.badge && <span className="axis-option__badge">{axis.badge}</span>}<ChevronDown size={13} aria-hidden="true" /></span>
    </button>)}</div>
    {openAxis && <div ref={list} id={`${id}-options`} role="group" aria-label={`${openAxis.label} options`} className="axis-options" data-closes-on-escape>
      {searchable && <label className="axis-search"><Search size={14} aria-hidden="true" /><span className="sr-only">{`Search ${openAxis.label.toLowerCase()} options`}</span>
        <input ref={search} type="search" placeholder={`Search ${openAxis.options.length} ${openAxis.label.toLowerCase()} values`} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKey} />
      </label>}
      {searchable && <p className="sr-only" aria-live="polite">{`${shown.length} of ${openAxis.options.length} shown`}</p>}
      {groups.map(({ group, options }) => headed && group
        ? <div key={group} role="group" aria-label={group} className="axis-options__group"><p aria-hidden="true">{group}</p>{options.map(optionButton)}</div>
        : <Fragment key={group ?? ''}>{options.map(optionButton)}</Fragment>)}
      {searchable && !shown.length && <p className="axis-options__empty">{`No ${openAxis.label.toLowerCase()} matches “${query}”`}</p>}
    </div>}
  </div>;
}
