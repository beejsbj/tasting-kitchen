import type { Dish } from "../types";

/** "#35" for an issue URL; the URL itself otherwise. */
export function issueLabel(url: string) {
  const match = /\/issues\/(\d+)$/u.exec(url);
  return match ? `#${match[1]}` : url;
}

/** Public notes recorded beside a Dish after it was cooked. The Dish itself never changes. */
export function DishNotes({ dish }: { dish: Pick<Dish, "notes"> }) {
  if (!dish.notes?.length) return null;
  return <>{dish.notes.map((note) => <p key={note.id} role="note" className="dish-note mt-3 text-xs">{note.text}{note.link && <> <a href={note.link} target="_blank" rel="noreferrer">{issueLabel(note.link)} ↗</a></>}</p>)}</>;
}
