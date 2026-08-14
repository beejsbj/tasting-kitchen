export function summarize(events) {
  const completed = events.filter((event) => event.status === "completed");
  const pending = events.filter((event) => event.status !== "completed");
  return {
    completed: completed.map((event) => event.title),
    canceled: [],
    unresolved: pending.map((event) => event.title),
    next: pending[0]?.title ?? null
  };
}
