import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';

export type AxisPickerOption = {
  key: string;
  label: string;
  status: 'cooked' | 'uncooked' | 'impossible';
  dishes: number;
  selected: boolean;
  /** What else moves when this value is chosen, or why it cannot be. */
  note?: string;
  onSelect: () => void;
};
export type AxisPickerAxis = { id: string; label: string; value: string; options: AxisPickerOption[] };

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
 * reason can be read.
 */
export function AxisPicker({ label, axes }: { label: string; axes: AxisPickerAxis[] }) {
  const [open, setOpen] = useState<string>();
  const chips = useRef(new Map<string, HTMLButtonElement>());
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const openAxis = axes.find((axis) => axis.id === open);
  const focusCurrent = () => requestAnimationFrame(() => (list.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? list.current?.querySelector<HTMLButtonElement>('button'))?.focus());
  const toggle = (axisId: string) => { if (open === axisId) setOpen(undefined); else { setOpen(axisId); focusCurrent(); } };
  const close = (focus = true) => { if (focus && open) chips.current.get(open)?.focus(); setOpen(undefined); };
  const onListKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus();
  };
  return <div role="group" aria-label={label} className="axis-picker">
    <div className="flex flex-wrap gap-1">{axes.map((axis) => <button key={axis.id} type="button" ref={(node) => { if (node) chips.current.set(axis.id, node); else chips.current.delete(axis.id); }}
      className="axis-chip" aria-expanded={open === axis.id} aria-controls={open === axis.id ? `${id}-options` : undefined} aria-label={`${axis.label}: ${axis.value}`}
      onClick={() => toggle(axis.id)}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' && open !== axis.id) { event.preventDefault(); toggle(axis.id); } }}>
      <span className="axis-chip__axis">{axis.label}</span><span className="axis-chip__value">{axis.value}<ChevronDown size={13} aria-hidden="true" /></span>
    </button>)}</div>
    {openAxis && <div ref={list} id={`${id}-options`} role="group" aria-label={`${openAxis.label} options`} className="axis-options" data-closes-on-escape>
      {openAxis.options.map((option) => <button key={option.key} type="button" className="axis-option" aria-pressed={option.selected} aria-disabled={option.status === 'impossible' || undefined}
        aria-label={`${option.label} · ${dishCountLabel(option)}${option.note ? ` · ${option.note}` : ''}`}
        onKeyDown={onListKey} onClick={() => { if (option.status === 'impossible') return; if (!option.selected) option.onSelect(); close(); }}>
        <CookedMark status={option.status} />
        <span className="axis-option__label">{option.label}{option.note && <small>{option.note}</small>}</span>
        <span className="axis-option__count">{dishCountLabel(option)}</span>
      </button>)}
    </div>}
  </div>;
}
