import { effortLabel } from '../lib/effort-label';
import { KitchenButton } from './KitchenButton';
import { modelFamily, shortHash } from '../lib/registry';
import type { Configuration } from '../types';

/** Family names choose the first (most recent available) configuration in that group. */
export function ModelChoices({ configurations, selectedId, onSelect, label = 'Models' }: {
  configurations: Configuration[]; selectedId?: string; onSelect: (configuration: Configuration) => void; label?: string;
}) {
  const families = [...new Set(configurations.map((config) => modelFamily(config.model)))];
  return <div className="model-choices" aria-label={label} role="group">{families.map((family) => {
    const configs = configurations.filter((config) => modelFamily(config.model) === family);
    const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
    const efforts = [...configs].sort((a, b) => effortOrder.indexOf(a.reasoningEffort) - effortOrder.indexOf(b.reasoningEffort));
    return <div className="model-choice" key={family}>
      <KitchenButton className="model-choice__family" aria-pressed={configs.some((config) => config.id === selectedId)} onClick={() => onSelect(configs[0])}>{family}</KitchenButton>
      <div className="model-choice__efforts">{efforts.map((config) => {
        const peers = configs.filter((item) => item.reasoningEffort === config.reasoningEffort);
        const detail = peers.length > 1 ? ` · ${config.serviceTier}${peers.some((item) => item.id !== config.id && item.serviceTier === config.serviceTier) ? ` · ${config.harness} · ${shortHash(config.configHash ?? config.id)}` : ''}` : '';
        const preserved = config.historical ? ' · preserved' : '';
        return <KitchenButton key={config.id} className="model-choice__effort" aria-pressed={config.id === selectedId} aria-label={`${family} ${config.reasoningEffort} effort · ${config.serviceTier} · ${config.harness}${preserved}${peers.length > 1 ? ` · ${shortHash(config.configHash ?? config.id)}` : ''}`} title={`${config.model} · ${config.reasoningEffort} effort · ${config.harness} · ${config.serviceTier}${preserved}`} onClick={() => onSelect(config)}>{effortLabel(config.reasoningEffort)}{detail}{preserved}</KitchenButton>;
      })}</div>
    </div>;
  })}</div>;
}
