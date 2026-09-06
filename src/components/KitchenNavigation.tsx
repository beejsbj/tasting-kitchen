import { KitchenButton } from './KitchenButton';
import { Mark } from './Mark';

export function KitchenNavigation({ active, onNavigate }: { active: 'dishes' | 'recipes' | 'menus'; onNavigate: (view: 'dishes' | 'recipes' | 'menus') => void }) {
  return <header className="kitchen-header"><KitchenButton className="brand-button" aria-label="Tasting Kitchen home" onClick={() => onNavigate('dishes')}><Mark /></KitchenButton><nav aria-label="Browse the Kitchen">{(['dishes', 'recipes', 'menus'] as const).map(view => <KitchenButton key={view} aria-current={active === view ? 'page' : undefined} onClick={() => onNavigate(view)}>{view === 'dishes' ? 'Dishes' : view === 'recipes' ? 'Recipes' : 'Menus'}</KitchenButton>)}</nav></header>;
}
