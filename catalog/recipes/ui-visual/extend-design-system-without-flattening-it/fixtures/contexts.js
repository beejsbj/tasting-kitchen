import { Surface, ActionButton, LabeledValue } from './components.js';
import { SignalPanel } from './signal-panel.js';

// Existing product compositions: status markup is repeated at the call sites.
export function Overview({ devices }) {
  const panel = Surface({ title: 'Equipment overview', description: 'Current device states' });
  for (const device of devices) {
    const row = document.createElement('p');
    row.append(`${device.name} `);
    const status = document.createElement('span');
    status.className = 'status';
    status.textContent = device.state;
    row.append(status);
    panel.append(row);
  }
  return panel;
}

export function Setup() {
  const panel = Surface({ title: 'Pair a device', description: 'Connect a local sample device.' });
  const status = document.createElement('span');
  status.className = 'status';
  status.textContent = 'unpaired';
  panel.append(status, ActionButton({ label: 'Pair device' }), ActionButton({ label: 'Cancel', quiet: true }));
  // Extension brief adds pair/cancel behavior to these existing controls.
  return panel;
}

export function Inspection() {
  const panel = SignalPanel();
  const status = document.createElement('span');
  status.className = 'status';
  status.textContent = 'online';
  panel.append(status, LabeledValue({ label: 'Sample interval', value: '5 seconds' }));
  return panel;
}
