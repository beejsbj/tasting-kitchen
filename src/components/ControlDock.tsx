import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { ModelSelect } from "./ModelSelect";
import type { Recipe, Variant } from "../types";

export function ControlDock({ recipe, variants, selected, onExit, onBrief, onModel, onAdd, onPrevious, onNext }: { recipe: Recipe; variants: Variant[]; selected: Variant[]; onExit: () => void; onBrief: () => void; onModel: (slot: number, id: string) => void; onAdd: () => void; onPrevious: () => void; onNext: () => void }) {
  return (
    <div className="control-dock">
      <div className="control-dock__tools"><IconButton label="Back to recipes" onClick={onExit}><Icon name="grid" /></IconButton><IconButton label="View recipe" data-brief-control onClick={onBrief}><Icon name="brief" /></IconButton></div>
      <div className="control-dock__models">
        {selected.map((variant, slot) => <ModelSelect compact key={`${slot}-${variant.id}`} label={`Model slot ${slot + 1}`} variant={variant} variants={variants.filter((candidate) => selected.every((item, selectedSlot) => selectedSlot === slot || item.id !== candidate.id))} onChange={(id) => onModel(slot, id)} />)}
        {selected.length < 3 && <IconButton label="Add comparison model" className="control-dock__add" onClick={onAdd}><Icon name="plus" /></IconButton>}
      </div>
      <div className="control-dock__pager"><IconButton label="Previous recipe" onClick={onPrevious}><Icon name="arrow-left" /></IconButton><span><b>{recipe.title}</b><i>{recipe.id}</i></span><IconButton label="Next recipe" onClick={onNext}><Icon name="arrow-right" /></IconButton></div>
    </div>
  );
}
