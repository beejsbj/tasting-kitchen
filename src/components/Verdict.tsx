import { useEffect, useState } from 'react';
import { KitchenButton } from './KitchenButton';
import { GitHubRecipeConnection, recipeBranch, type GitHubConnection } from './GitHubRecipeConnection';
import { saveVerdictViaGitHub } from '../lib/github-recipe-save';
import { createVerdict, localVerdictsWritable, NOTE_LIMIT, noteProblem, saveVerdictLocally } from '../lib/verdicts';
import { isNoDish } from '../lib/outcomes';
import type { Plate, Verdict } from '../types';

const VERDICT_LABEL: Record<Verdict['verdict'], string> = { failed: 'Failed by Burooj', passed: 'Passed by Burooj' };

/**
 * Burooj's verdict, shown above the artifact. It outranks the automated checks
 * in what the gallery leads with, and says so: the checks' own result stays in
 * view beside it.
 */
export function VerdictMark({ verdict, checksFailed = false }: { verdict?: Verdict; checksFailed?: boolean }) {
  if (!verdict) return null;
  return <aside className="verdict-mark" data-verdict={verdict.verdict} aria-label={`${VERDICT_LABEL[verdict.verdict]}: ${verdict.note}`}>
    <b>{VERDICT_LABEL[verdict.verdict]}</b>
    <span className="verdict-mark__note">{verdict.note}</span>
    <span className="verdict-mark__checks">{checksFailed ? 'Checks failed' : 'Automated checks passed'}</span>
  </aside>;
}

/**
 * The owner's verdict form. In local development it writes through the dev
 * server; anywhere else it commits `verdicts/<id>.json` with the same GitHub
 * token flow the Recipe Book uses. `taste verdict` writes the identical file.
 */
export function VerdictControl({ plate, standing, onSaved }: { plate: Plate; standing?: Verdict; onSaved: (verdict: Verdict) => void }) {
  // A No Dish has nothing to fail: Burooj can only overrule the checks that failed it.
  const noDish = isNoDish(plate);
  const [choice, setChoice] = useState<Verdict['verdict']>(noDish || standing?.verdict === 'passed' ? 'passed' : 'failed');
  const [note, setNote] = useState('');
  const [writable, setWritable] = useState(false);
  const [connection, setConnection] = useState<GitHubConnection>();
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { void localVerdictsWritable().then(setWritable); }, []);
  const problem = note ? noteProblem(note) : '';
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!writable && !connection) { setConnecting(true); return; }
    setBusy(true); setMessage('');
    try {
      const verdict = writable ? await saveVerdictLocally({ plateId: plate.id, verdict: choice, note }) : createVerdict(plate, choice, note);
      if (!writable) await saveVerdictViaGitHub({ token: connection!.token, branch: recipeBranch, verdict });
      onSaved(verdict);
      setNote('');
      setMessage(writable ? `Saved beside the ${noDish ? 'No Dish' : 'Dish'}. The ${noDish ? 'No Dish' : 'Dish'} itself is unchanged.` : `Committed to ${recipeBranch}. The shared gallery shows it after its next deployment.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'The verdict could not be saved.');
    } finally { setBusy(false); }
  }
  return <div className="verdict-control">
    <h2 className="mb-1 text-base font-semibold">Your verdict</h2>
    {standing ? <p className="text-xs text-slate-600"><b>{VERDICT_LABEL[standing.verdict]}</b> · {new Date(standing.decidedAt).toLocaleDateString()} · {standing.note}</p> : <p className="text-xs text-slate-600">No verdict yet. {noDish ? (plate.fault.code === 'checks-failed' ? 'The checks failed this No Dish; your pass would overrule them.' : `This No Dish is the model's own outcome (${plate.fault.code}); your pass would overrule it.`) : 'The automated checks passed this Dish.'}</p>}
    <form onSubmit={save} className="mt-3 flex flex-col gap-2">
      <div role="radiogroup" aria-label="Verdict" className="flex gap-1">
        {(noDish ? ['passed'] as const : ['failed', 'passed'] as const).map((value) => <label key={value} className="verdict-choice" data-choice={value}><input type="radio" name="verdict" value={value} checked={choice === value} onChange={() => setChoice(value)} />{value === 'failed' ? 'Failed' : 'Passed'}</label>)}
      </div>
      <label className="recipe-field">Note<textarea value={note} maxLength={NOTE_LIMIT} rows={3} onChange={(event) => setNote(event.target.value)} placeholder="What you saw" required /></label>
      {problem && <p role="alert" className="text-xs text-[var(--danger)]">{problem}</p>}
      <KitchenButton tone="primary" type="submit" disabled={busy || !note.trim() || Boolean(problem)}>{busy ? 'Saving…' : writable ? 'Save verdict' : connection ? 'Commit verdict via GitHub' : 'Connect GitHub to save'}</KitchenButton>
      {message && <p role="status" className="text-xs text-slate-600">{message}</p>}
      <p className="text-xs text-slate-500">A newer verdict replaces this one; each is kept. From a terminal: <code>taste verdict --dish {plate.id} --{choice} --note &hellip;</code></p>
    </form>
    {connecting && <GitHubRecipeConnection purpose="verdicts" onClose={() => setConnecting(false)} onConnect={(account) => { setConnection(account); setConnecting(false); }} />}
  </div>;
}
