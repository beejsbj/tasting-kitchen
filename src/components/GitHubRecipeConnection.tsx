import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { KitchenButton } from './KitchenButton';
import { verifyGitHubAccess } from '../lib/github-recipe-save';

export const recipeBranch = import.meta.env.VITE_RECIPE_BRANCH || 'main';
export type GitHubConnection = { token: string; login: string };

export function GitHubRecipeConnection({ onConnect, onClose }: { onConnect: (connection: GitHubConnection) => void; onClose: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const account = await verifyGitHubAccess(token.trim(), recipeBranch); onConnect({ token: token.trim(), login: account.login }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'GitHub connection failed.'); }
    finally { setBusy(false); }
  }
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="recipe-connect-overlay" /><Dialog.Content className="recipe-connect-dialog"><Dialog.Title>Connect GitHub</Dialog.Title><Dialog.Description>Save recipe changes to <strong>beejsbj/tasting-kitchen</strong> on <code>{recipeBranch}</code>.</Dialog.Description><form onSubmit={connect}><label className="recipe-field">Fine-grained access token<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} required /></label><p>Create a token for this repository with <strong>Contents: Read and write</strong>. It stays in memory in this tab and is sent only to GitHub.</p><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a repository token ↗</a>{error && <p role="alert" className="recipe-connect-error">{error}</p>}<div className="recipe-connect-actions"><KitchenButton onClick={onClose}>Cancel</KitchenButton><KitchenButton tone="primary" type="submit" disabled={busy || !token.trim()}>{busy ? 'Connecting…' : 'Connect'}</KitchenButton></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
