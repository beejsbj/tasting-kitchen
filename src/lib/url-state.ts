export type GalleryState = {
  domain: string;
  recipe: string;
  models: string[];
  brief: boolean;
  styleguide: boolean;
};

export function readGalleryState(search = window.location.search): GalleryState {
  const query = new URLSearchParams(search);
  return {
    domain: query.get("domain") ?? "all",
    recipe: query.get("recipe") ?? "",
    models: (query.get("models") ?? "").split(",").filter(Boolean).slice(0, 3),
    brief: query.get("brief") === "1",
    styleguide: query.get("styleguide") === "1",
  };
}

export function writeGalleryState(state: GalleryState, mode: "push" | "replace" = "push") {
  const query = new URLSearchParams();
  if (state.domain !== "all") query.set("domain", state.domain);
  if (state.recipe) query.set("recipe", state.recipe);
  if (state.models.length) query.set("models", state.models.join(","));
  if (state.brief) query.set("brief", "1");
  if (state.styleguide) query.set("styleguide", "1");
  const url = `${window.location.pathname}${query.size ? `?${query}` : ""}`;
  window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
}
