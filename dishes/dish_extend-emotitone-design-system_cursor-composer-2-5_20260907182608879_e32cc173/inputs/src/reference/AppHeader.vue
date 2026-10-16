<template>
  <header class="app-header">
    <div v-if="showMidiIndicator" class="status-row">
      <div
        class="midi-indicator"
        :class="midiIndicatorClass"
        :title="midiIndicatorLabel"
        :aria-label="midiIndicatorLabel"
      >
        <svg
          class="midi-indicator__icon"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6.5 17.5a5.5 5.5 0 1 1 11 0"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
          <circle cx="12" cy="8.4" r="1.1" fill="currentColor" />
          <circle cx="8.4" cy="10.4" r="1.05" fill="currentColor" />
          <circle cx="15.6" cy="10.4" r="1.05" fill="currentColor" />
          <circle cx="10" cy="13.4" r="1" fill="currentColor" />
          <circle cx="14" cy="13.4" r="1" fill="currentColor" />
        </svg>
      </div>
    </div>

    <h1 class="title">Emotitone</h1>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useKeyboardDrawerStore } from "@/stores/keyboardDrawer";

const keyboardDrawerStore = useKeyboardDrawerStore();

const showMidiIndicator = computed(() => keyboardDrawerStore.midi.isSupported);

const hasDetectedMidiDevice = computed(() => {
  const midi = keyboardDrawerStore.midi;
  return (
    midi.connectedInputs.length > 0
    || midi.connectedOutputs.length > 0
    || Boolean(midi.syncedOutput)
  );
});

const midiIndicatorClass = computed(() => {
  const midi = keyboardDrawerStore.midi;

  if (midi.lastError) {
    return "midi-indicator--error";
  }

  if (midi.isConnecting) {
    return "midi-indicator--connecting";
  }

  if (hasDetectedMidiDevice.value) {
    return "midi-indicator--active";
  }

  if (midi.isListening) {
    return "midi-indicator--armed";
  }

  return "midi-indicator--idle";
});

const midiIndicatorLabel = computed(() => {
  const midi = keyboardDrawerStore.midi;

  if (midi.lastError) {
    return "MIDI permission wasn’t granted";
  }

  if (midi.isConnecting) {
    return "Requesting MIDI access";
  }

  if (midi.syncedOutput) {
    return `MIDI detected. Live sync active on ${midi.syncedOutput}`;
  }

  if (hasDetectedMidiDevice.value) {
    const detectedNames = [...midi.connectedInputs, ...midi.connectedOutputs];
    return `MIDI detected: ${detectedNames.join(", ")}`;
  }

  if (midi.isListening) {
    return "MIDI ready. Connect a device anytime";
  }

  return "Browser MIDI unavailable";
});
</script>

<style scoped>
.app-header {
  padding: 0.8rem 1rem 0.5rem;
  text-align: center;
}

.status-row {
  display: flex;
  justify-content: center;
  margin-bottom: 0.3rem;
}

.title {
  margin: 0;
  color: white;
  font-size: 1rem;
  font-weight: 500;
  letter-spacing: 0.08em;
}

.midi-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 999px;
  color: rgba(148, 163, 184, 0.44);
  background: rgba(255, 255, 255, 0.015);
  transition:
    color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease,
    opacity 180ms ease;
}

.midi-indicator__icon {
  width: 0.82rem;
  height: 0.82rem;
  filter: drop-shadow(0 0 0 rgba(0, 0, 0, 0));
  transition:
    transform 180ms ease,
    filter 180ms ease,
    opacity 180ms ease;
}

.midi-indicator--idle {
  color: rgba(148, 163, 184, 0.42);
}

.midi-indicator--armed {
  color: rgba(125, 211, 252, 0.64);
}

.midi-indicator--active {
  color: rgba(124, 242, 154, 0.92);
}

.midi-indicator--active .midi-indicator__icon {
  filter: drop-shadow(0 0 6px rgba(124, 242, 154, 0.42));
}

.midi-indicator--connecting {
  color: rgba(251, 191, 36, 0.78);
}

.midi-indicator--connecting .midi-indicator__icon {
  animation: midi-pulse 1.2s ease-in-out infinite;
  filter: drop-shadow(0 0 5px rgba(251, 191, 36, 0.32));
}

.midi-indicator--error {
  color: rgba(248, 113, 113, 0.8);
}

.midi-indicator--error .midi-indicator__icon {
  filter: drop-shadow(0 0 5px rgba(248, 113, 113, 0.32));
}

@keyframes midi-pulse {
  0%,
  100% {
    transform: scale(0.92);
    opacity: 0.72;
  }

  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}
</style>
