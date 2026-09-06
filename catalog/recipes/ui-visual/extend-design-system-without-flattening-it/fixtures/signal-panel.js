import { Surface } from './components.js';

// This feature owns sample selection and reading geometry; values are local samples.
export function SignalArc({ value = 64 } = {}) {
  const root = document.createElement('div');
  root.className = 'signal-arc';
  const track = document.createElement('span');
  track.className = 'signal-arc__track';
  track.setAttribute('aria-hidden', 'true');
  const reading = document.createElement('output');
  const label = document.createElement('label');
  label.textContent = 'Signal confidence sample ';
  const selector = document.createElement('input');
  selector.type = 'range';
  selector.min = '0';
  selector.max = '100';
  selector.value = String(value);
  label.append(selector);
  const update = () => {
    root.dataset.value = selector.value;
    root.style.setProperty('--signal-angle', `${Number(selector.value) * 3.6}deg`);
    reading.textContent = `${selector.value}% signal confidence`;
    selector.setAttribute('aria-valuetext', `${selector.value}% signal confidence`);
  };
  selector.addEventListener('input', update);
  update();
  root.append(track, reading, label);
  return root;
}

export function SignalPanel() {
  const panel = Surface({ title: 'Signal inspection', description: 'A local diagnostic sample; no live equipment is connected.' });
  panel.append(SignalArc());
  return panel;
}
