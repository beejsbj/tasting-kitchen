import { useEffect, useState } from "react";
import { artifactUrl } from "../lib/registry";
import type { Dish } from "../types";

type SessionAction = {
  event?: string;
  type?: string;
  status?: string;
  exitCode?: number;
  path?: string;
};

type SessionTurn = {
  id: string;
  role: string;
  prompt: string;
  response: string;
  usage?: unknown;
  actions: SessionAction[];
};

type SessionDocument = { schemaVersion?: number; recipeId?: string; turns: SessionTurn[] };
type SessionState =
  | { status: "loading" }
  | { status: "error"; message: string; raw?: string }
  | { status: "ready"; document: SessionDocument; raw: string };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSession(raw: string): SessionDocument {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !Array.isArray(value.turns)) throw new Error("Session JSON does not contain a turns array.");
  const turns = value.turns.map((candidate, index) => {
    if (!record(candidate) || ![candidate.id, candidate.role, candidate.prompt, candidate.response].every((item) => typeof item === "string")) {
      throw new Error(`Turn ${index + 1} is missing its id, role, prompt, or response.`);
    }
    return {
      id: candidate.id as string,
      role: candidate.role as string,
      prompt: candidate.prompt as string,
      response: candidate.response as string,
      usage: candidate.usage,
      actions: Array.isArray(candidate.actions) ? candidate.actions.filter(record) as SessionAction[] : [],
    };
  });
  return {
    schemaVersion: typeof value.schemaVersion === "number" ? value.schemaVersion : undefined,
    recipeId: typeof value.recipeId === "string" ? value.recipeId : undefined,
    turns,
  };
}

function actionText(action: SessionAction) {
  const event = action.event?.replace("item.", "");
  const type = action.type?.replaceAll("_", " ");
  return [type, event, action.status, action.path, Number.isInteger(action.exitCode) ? `exit ${action.exitCode}` : undefined].filter(Boolean).join(" · ");
}

function RawSession({ raw }: { raw: string }) {
  return <details className="session-raw"><summary>Raw session JSON</summary><pre>{raw}</pre></details>;
}

export function SessionArtifact({ dish }: { dish: Dish }) {
  const url = artifactUrl(dish);
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Session artifact returned ${response.status}.`);
      const raw = await response.text();
      try { setState({ status: "ready", document: parseSession(raw), raw }); }
      catch (error) { setState({ status: "error", message: error instanceof Error ? error.message : "Session JSON could not be parsed.", raw }); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Session artifact could not be loaded." });
    });
    return () => controller.abort();
  }, [url]);

  if (state.status === "loading") return <div className="session-state" role="status">Loading session artifact…</div>;
  if (state.status === "error") return <div className="session-state session-state--error" role="alert"><h2>Session artifact unavailable</h2><p>{state.message}</p><a href={url}>Open immutable artifact</a>{state.raw && <RawSession raw={state.raw} />}</div>;

  return (
    <article className="session-artifact">
      <header className="session-artifact__header">
        <span>Session artifact</span>
        <h2>{state.document.turns.length} {state.document.turns.length === 1 ? "turn" : "turns"}</h2>
        {state.document.recipeId && <p>{state.document.recipeId}</p>}
      </header>
      <ol className="session-turns">
        {state.document.turns.map((turn, index) => <li className="session-turn" key={`${turn.id}-${index}`}>
          <header className="session-turn__header"><b>Turn {String(index + 1).padStart(2, "0")}</b><span>{turn.role.replaceAll("-", " ")}</span><code>{turn.id}</code></header>
          <section className="session-block session-block--prompt"><h3>Prompt</h3><p>{turn.prompt}</p></section>
          <section className="session-block session-block--response"><h3>Model response</h3><p>{turn.response}</p></section>
          <section className="session-actions" aria-label={`Tool and action evidence for turn ${index + 1}`}>
            <h3>Tool &amp; action evidence</h3>
            {turn.actions.length > 0 ? <ul>{turn.actions.map((action, actionIndex) => <li key={actionIndex}>{actionText(action) || "Recorded action"}</li>)}</ul> : <p>No tool or file actions recorded.</p>}
          </section>
        </li>)}
      </ol>
      <RawSession raw={state.raw} />
    </article>
  );
}
