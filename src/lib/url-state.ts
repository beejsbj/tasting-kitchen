export type GalleryState = {
  view: "recipes" | "menus" | "models";
  cuisine: string; origin: string; query: string; family: string; effort: string;
  recipe: string; revision: string; menu: string; menuRevision: string;
  models: string[]; dishes: string[]; brief: boolean; styleguide: boolean;
};
export function readGalleryState(search = window.location.search): GalleryState {
  const query = new URLSearchParams(search);
  const view = query.get("view");
  return {
    view: view === "menus" || view === "models" ? view : "recipes",
    cuisine: query.get("cuisine") ?? query.get("domain") ?? "all",
    origin: query.get("origin") ?? "all", query: query.get("q") ?? "", family: query.get("family") ?? "all", effort: query.get("effort") ?? "all",
    recipe: query.get("recipe") ?? "", revision: query.get("revision") ?? "", menu: query.get("menu") ?? "", menuRevision: query.get("menuRevision") ?? "",
    models: (query.get("models") ?? "").split(",").filter(Boolean).slice(0, 3), dishes: (query.get("dishes") ?? "").split(",").slice(0, 3),
    brief: query.get("brief") === "1", styleguide: query.get("styleguide") === "1",
  };
}
export function writeGalleryState(state: GalleryState, mode: "push" | "replace" = "push") {
  const query = new URLSearchParams();
  if (state.view !== "recipes") query.set("view", state.view);
  for (const key of ["cuisine", "origin", "family", "effort"] as const) if (state[key] !== "all") query.set(key, state[key]);
  for (const key of ["recipe", "revision", "menu", "menuRevision"] as const) if (state[key]) query.set(key, state[key]);
  if (state.query) query.set("q", state.query);
  if (state.models.length) query.set("models", state.models.join(","));
  if (state.dishes.some(Boolean)) query.set("dishes", state.dishes.join(","));
  if (state.brief) query.set("brief", "1");
  if (state.styleguide) query.set("styleguide", "1");
  const url = `${window.location.pathname}${query.size ? `?${query}` : ""}`;
  window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
}
