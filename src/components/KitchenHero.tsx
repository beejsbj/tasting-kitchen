/** The enamel sign and tiled backsplash anchor the Kitchen's material language. */
export function KitchenHero({ recipes, dishes, models }: { recipes: number; dishes: number; models: number }) {
  return <section className="counter-hero"><div className="enamel-sign"><p className="eyebrow">Model tasting, à la carte</p><h1>Tasting Kitchen</h1><p>One recipe. Different models.</p></div><div className="counter-inventory"><span>{recipes} cooked recipes</span><span>{dishes} dishes</span><span>{models} models</span></div></section>;
}
