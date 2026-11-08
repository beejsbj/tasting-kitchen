import { effortLabel } from '../lib/effort-label';
import { KitchenButton } from './KitchenButton';
import { modelFamily, shortHash } from '../lib/registry';
import { environmentLabel, harnessLabel } from '../lib/configuration-label';
import type { Configuration } from '../types';

const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/**
 * Family names choose the first (most recent available) configuration in that group.
 * A family reached through several harnesses or environments splits its efforts into
 * one captioned row per setup; a single-setup family stays as compact as before.
 */
export function ModelChoices({ configurations, selectedId, onSelect, label = 'Models' }: {
  configurations: Configuration[]; selectedId?: string; onSelect: (configuration: Configuration) => void; label?: string;
}) {
  const families = [...new Set(configurations.map((config) => modelFamily(config.model)))];
  return <div className="model-choices" aria-label={label} role="group">{families.map((family) => {
    const configs = configurations.filter((config) => modelFamily(config.model) === family);
    const setupName = (config: Configuration) => [harnessLabel(config.harness), environmentLabel(config)].filter(Boolean).join(' · ');
    // A stable order, so a setup keeps its place however the viewer sorts configurations.
    const setups = [...new Set(configs.map(setupName))].sort((a, b) => a.localeCompare(b)).map((name) => configs.filter((config) => setupName(config) === name));
    return <div className="model-choice" key={family}>
      <KitchenButton className="model-choice__family" aria-pressed={configs.some((config) => config.id === selectedId)} onClick={() => onSelect(configs[0])}>{family}</KitchenButton>
      {setups.map((setup) => {
        const efforts = [...setup].sort((a, b) => effortOrder.indexOf(a.reasoningEffort) - effortOrder.indexOf(b.reasoningEffort));
        const setupLabel = setupName(setup[0]);
        return <div className="model-choice__setup" key={setupLabel} role={setups.length > 1 ? 'group' : undefined} aria-label={setups.length > 1 ? `${family} · ${setupLabel}` : undefined}>
          {setups.length > 1 && <span className="model-choice__caption">{setupLabel}</span>}
          <div className="model-choice__efforts">{efforts.map((config) => {
            const peers = setup.filter((item) => item.reasoningEffort === config.reasoningEffort);
            const detail = peers.length > 1 ? ` · ${config.serviceTier}${peers.some((item) => item.id !== config.id && item.serviceTier === config.serviceTier) ? ` · ${shortHash(config.configHash ?? config.id)}` : ''}` : '';
            const preserved = config.historical ? ' · preserved' : '';
            return <KitchenButton key={config.id} className="model-choice__effort" aria-pressed={config.id === selectedId} aria-label={`${family} ${config.reasoningEffort} effort · ${config.serviceTier} · ${setupLabel}${preserved}${peers.length > 1 ? ` · ${shortHash(config.configHash ?? config.id)}` : ''}`} title={`${config.model} · ${config.reasoningEffort} effort · ${setupLabel} · ${config.serviceTier}${preserved}`} onClick={() => onSelect(config)}>{effortLabel(config.reasoningEffort)}{detail}{preserved}</KitchenButton>;
          })}</div>
        </div>;
      })}
    </div>;
  })}</div>;
}
