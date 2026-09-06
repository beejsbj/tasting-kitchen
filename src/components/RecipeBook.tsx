import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Download, Pencil, Save, Search } from 'lucide-react';
import { KitchenButton } from './KitchenButton';
import { initialEdits, loadRecipeBook, saveRecipe, type RecipeBookData, type RecipeBookEntry, type RecipeEdits } from '../lib/recipe-book';
import type { Registry } from '../types';
import { GitHubRecipeConnection, recipeBranch, type GitHubConnection } from './GitHubRecipeConnection';
import { loadRecipeFromGitHub, saveRecipeViaGitHub } from '../lib/github-recipe-save';

const draftKey = (id: string) => `tasting-kitchen:recipe-draft:${id}`;
function readDraft(entry: RecipeBookEntry): RecipeEdits {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(entry.recipe.id)) ?? 'null');
    if (draft?.baseHash === entry.fileHash && draft.updates && Array.isArray(draft.updates.turns) && Array.isArray(draft.updates.fixtureEdits)) return draft.updates;
  } catch { /* A missing or invalid browser draft does not change the recipe. */ }
  return initialEdits(entry);
}

function RecipeEditor({ entry, writable, onSaved, onBack, onDishes, registry, connection, onConnect, onDisconnect }: { entry: RecipeBookEntry; writable: boolean; onSaved: (entry: RecipeBookEntry) => void; onBack: () => void; onDishes: () => void; registry: Registry; connection?: GitHubConnection; onConnect: () => void; onDisconnect: () => void }) {
  const [edits, setEdits] = useState(() => readDraft(entry));
  const [editing, setEditing] = useState(false);
  const [inputId, setInputId] = useState(entry.fixtures[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const dirty = JSON.stringify(edits) !== JSON.stringify(initialEdits(entry));
  const currentDishes = registry.dishes.filter(dish => dish.recipe.id === entry.recipe.id && dish.recipe.hash === entry.recipe.recipeHash).length;
  const input = entry.fixtures.find(item => item.id === inputId);
  const inputText = edits.fixtureEdits.find(item => item.id === inputId)?.text;
  const update = (patch: Partial<RecipeEdits>) => { setEdits(value => ({ ...value, ...patch })); setNotice(''); setError(''); };

  useEffect(() => {
    if (!dirty) return;
    try { localStorage.setItem(draftKey(entry.recipe.id), JSON.stringify({ baseHash: entry.fileHash, updates: edits })); }
    catch { /* Saving to the repository and downloading remain available. */ }
  }, [dirty, edits, entry.fileHash, entry.recipe.id]);

  async function save() {
    if (!writable && !connection) { onConnect(); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const next = writable ? await saveRecipe(entry, edits) : await saveRecipeViaGitHub({ token: connection!.token, branch: recipeBranch, entry, updates: edits });
      onSaved(next); setEdits(initialEdits(next));
      try { localStorage.removeItem(draftKey(entry.recipe.id)); } catch { /* Repository save already succeeded. */ }
      setNotice(writable ? 'Saved to the repository. Existing Dishes are unchanged.' : `Committed to ${recipeBranch} on GitHub. Existing Dishes are unchanged; the shared preview updates after its next deployment.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Save failed. Your edits are still here.'); }
    finally { setSaving(false); }
  }
  function download() {
    const blob = new Blob([JSON.stringify({ recipeId: entry.recipe.id, expectedHash: entry.fileHash, updates: edits }, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `${entry.recipe.id}-edits.json`; link.click(); URL.revokeObjectURL(url);
    setNotice('Downloaded recipe edits. The repository has not changed.');
  }
  async function reload() {
    if (!connection) return;
    setSaving(true); setError('');
    try { const next = await loadRecipeFromGitHub({ token: connection.token, branch: recipeBranch, entry }); onSaved(next); setEdits(initialEdits(next)); setNotice('Loaded the current recipe from GitHub.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Reload failed.'); }
    finally { setSaving(false); }
  }
  return <article className="recipe-editor">
    <div className="recipe-editor__toolbar">
      <KitchenButton onClick={onBack}><ArrowLeft size={16} /> All recipes</KitchenButton>
      <div className="recipe-editor__actions">
        <KitchenButton aria-pressed={editing} onClick={() => setEditing(value => !value)}><Pencil size={16} />{editing ? 'Read recipe' : 'Edit recipe'}</KitchenButton>
        {editing && <><KitchenButton tone="primary" disabled={!dirty || saving} onClick={save}><Save size={16} />{saving ? 'Saving…' : writable ? 'Save to repository' : 'Save via GitHub'}</KitchenButton>{!writable && <KitchenButton onClick={download}><Download size={16} /> Download edits</KitchenButton>}
          {dirty && <KitchenButton disabled={saving} onClick={() => { setEdits(initialEdits(entry)); localStorage.removeItem(draftKey(entry.recipe.id)); setNotice('Changes discarded.'); setError(''); }}>Discard changes</KitchenButton>}</>}
      </div>
    </div>
    <header className="recipe-editor__heading">
      <span className="recipe-book__eyebrow">Recipe · v{entry.recipe.version}</span>
      {editing ? <><label className="recipe-field">Title<input value={edits.title} maxLength={100} onChange={event => update({ title: event.target.value })} /></label><label className="recipe-field">Summary<textarea rows={3} maxLength={300} value={edits.summary} onChange={event => update({ summary: event.target.value })} /></label></> : <><h2>{edits.title}</h2><p>{edits.summary}</p></>}
      <div className="recipe-editor__metadata"><span>{currentDishes ? `${currentDishes} Dishes for this recipe version` : 'Not cooked at this version'}</span><span>{entry.recipe.origin === 'mothers' ? 'Mother’s' : entry.recipe.origin === 'hybrid' ? 'Hybrid' : 'Textbook'}</span>{dirty && <span>Local changes</span>}{entry.dishCount > 0 && <KitchenButton onClick={onDishes}>View {entry.dishCount} Dishes <ArrowUpRight size={15} /></KitchenButton>}</div>
    </header>
    {editing && <div className="recipe-editor-note">{writable ? 'Save updates the recipe and its supplied files in this checkout. Generated Dishes retain their original briefs.' : <><span>{connection ? `Connected as ${connection.login}. Saves commit to ${recipeBranch} on GitHub.` : 'Changes stay in this browser until you save. Connect GitHub to commit the recipe and its supplied files.'}</span>{connection && <div><KitchenButton onClick={reload} disabled={dirty || saving} title={dirty ? 'Download or discard local changes before reloading' : undefined}>Reload from GitHub</KitchenButton><KitchenButton onClick={onDisconnect}>Disconnect GitHub</KitchenButton></div>}</>}</div>}
    {notice && <p role="status" className="recipe-editor-note">{notice}</p>}{error && <p role="alert" className="recipe-editor-error">{error}</p>}
    <section className="recipe-editor__section"><h3>Setup</h3>{editing ? <label className="recipe-field"><span className="sr-only">Setup instructions</span><textarea rows={9} value={edits.setupInstructions} onChange={event => update({ setupInstructions: event.target.value })} /></label> : <p className="recipe-prose">{edits.setupInstructions}</p>}</section>
    {edits.turns.map((turn, index) => <section className="recipe-editor__section" key={turn.id}><h3>{edits.turns.length > 1 ? `Prompt ${index + 1}` : 'Prompt'}</h3>{editing ? <label className="recipe-field"><span className="sr-only">{`Prompt ${index + 1}`}</span><textarea rows={14} value={turn.content} onChange={event => update({ turns: edits.turns.map((item, at) => at === index ? { ...item, content: event.target.value } : item) })} /></label> : <p className="recipe-prose">{turn.content}</p>}</section>)}
    <section className="recipe-editor__section"><div className="recipe-section-heading"><h3>Supplied files</h3><span>{entry.fixtures.length} inputs</span></div>
      {entry.fixtures.length ? <div className="recipe-inputs"><nav aria-label="Recipe input files">{entry.fixtures.map(item => <button type="button" className="recipe-input-link" key={item.id} aria-current={item.id === inputId ? 'true' : undefined} onClick={() => setInputId(item.id)}><span>{item.mountAs}</span><small>{item.mediaType}</small></button>)}</nav>
        <div className="recipe-input-content"><div className="recipe-input-content__heading"><strong>{input?.mountAs}</strong><span>{input?.editable ? 'Model may edit this input' : 'Fixed during a cook'}</span></div>{inputText !== undefined ? editing ? <label className="recipe-field"><span className="sr-only">{`Contents of ${input?.mountAs}`}</span><textarea className="recipe-source-editor" spellCheck={false} rows={24} value={inputText} onChange={event => update({ fixtureEdits: edits.fixtureEdits.map(item => item.id === inputId ? { ...item, text: event.target.value } : item) })} /></label> : <textarea className="recipe-source-preview" aria-label="File contents" readOnly rows={24} value={inputText} /> : <p>This binary input is available in the source repository.</p>}</div>
      </div> : <p>No supplied files.</p>}
    </section>
    <section className="recipe-editor__section"><h3>Output & checks</h3><p>Produce <code>{entry.recipe.output.entry}</code> · {entry.recipe.kind}</p><ul className="recipe-checks">{entry.recipe.validation.checks.map(check => <li key={check.id}><span>{check.type === 'manual' ? 'Human review' : check.required ? 'Required check' : 'Advisory check'}</span>{check.description}</li>)}</ul></section>
  </article>;
}

export function RecipeBook({ selectedId, onSelect, onDishes, registry }: { selectedId: string; onSelect: (id: string) => void; onDishes: (id: string) => void; registry: Registry }) {
  const [book, setBook] = useState<RecipeBookData>();
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [connection, setConnection] = useState<GitHubConnection>();
  const [connecting, setConnecting] = useState(false);
  useEffect(() => { loadRecipeBook().then(result => { setBook(result.book); setWritable(result.writable); }).catch(reason => setError(reason.message)); }, []);
  const entries = useMemo(() => (book?.recipes ?? []).filter(entry => `${entry.recipe.title} ${entry.recipe.summary}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'uncooked' && !entry.dishCount || filter === 'systems' && entry.recipe.tags.includes('design-system'))), [book, query, filter]);
  if (!book) return <p role={error ? 'alert' : 'status'}>{error || 'Opening the recipe book…'}</p>;
  const selected = book.recipes.find(entry => entry.recipe.id === selectedId);
  if (selectedId && !selected) return <div className="empty-state"><h2>This recipe is not in the active book.</h2><KitchenButton onClick={() => onSelect('')}>All recipes</KitchenButton></div>;
  if (selected) return <><RecipeEditor key={selected.recipe.id} entry={selected} writable={writable} registry={registry} connection={connection} onConnect={() => setConnecting(true)} onDisconnect={() => setConnection(undefined)} onBack={() => onSelect('')} onDishes={() => onDishes(selected.recipe.id)} onSaved={entry => setBook({ ...book, recipes: book.recipes.map(item => item.recipe.id === entry.recipe.id ? entry : item) })} />{connecting && <GitHubRecipeConnection onClose={() => setConnecting(false)} onConnect={account => { setConnection(account); setConnecting(false); }} />}</>;
  return <section className="recipe-book">
    <header className="section-heading"><div><h2>Recipes</h2><p className="recipe-book__intro">Read and edit the prompts and supplied files.</p></div><span>{book.recipes.length} in the book</span></header>
    <div className="recipe-book__filters"><label className="recipe-search"><Search size={17} /><span className="sr-only">Search recipe book</span><input placeholder="Find a recipe" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="recipe-book__segments" role="group" aria-label="Filter recipe book">{[['all', 'All recipes'], ['uncooked', 'Not cooked'], ['systems', 'Design systems']].map(([id, label]) => <KitchenButton key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</KitchenButton>)}</div></div>
    <div className="recipe-book__grid">{entries.map(entry => <button type="button" className="recipe-book-card" key={entry.recipe.id} onClick={() => onSelect(entry.recipe.id)}><span className="recipe-book-card__top"><BookOpen size={20} /><span>{entry.dishCount ? `${entry.dishCount} Dishes` : 'Not cooked'}</span></span><h3>{entry.recipe.title}</h3><p>{entry.recipe.summary}</p><span className="recipe-book-card__bottom"><span>{entry.recipe.tags.includes('design-system') ? 'Design-system extension' : registry.cuisines.find(cuisine => entry.recipe.cuisines.includes(cuisine.id))?.label}</span><ArrowUpRight size={18} /></span></button>)}</div>
    {!entries.length && <p>No recipes match these filters.</p>}
  </section>;
}
