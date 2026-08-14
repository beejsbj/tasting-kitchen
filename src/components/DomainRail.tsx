import type { Domain, Recipe } from "../types";

export function DomainRail({ domains, recipes, active, onSelect }: { domains: Domain[]; recipes: Recipe[]; active: string; onSelect: (id: string) => void }) {
  const ready = recipes.filter((recipe) => recipe.status !== "hidden");
  return (
    <nav className="domain-rail" aria-label="Use areas">
      <button className="domain-rail__all" aria-current={active === "all"} onClick={() => onSelect("all")}>
        <span>All recipes</span><b>{ready.length}</b>
      </button>
      <ol>
        {domains.map((domain, index) => {
          const count = ready.filter((recipe) => recipe.domain === domain.id).length;
          return <li key={domain.id}><button aria-current={active === domain.id} onClick={() => onSelect(domain.id)}><i>{String(index + 1).padStart(2, "0")}</i><span>{domain.label}</span><b>{count}</b></button></li>;
        })}
      </ol>
    </nav>
  );
}
