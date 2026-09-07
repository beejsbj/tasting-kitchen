<script setup lang="ts">
import { provide, ref, computed, type WritableComputedRef } from "vue";

interface Props {
  defaultValue?: string;
  value?: string;
  orientation?: "horizontal" | "vertical";
  tabsPosition?: "top" | "bottom";
}

const props = withDefaults(defineProps<Props>(), {
  orientation: "horizontal",
  tabsPosition: "top",
});

const emit = defineEmits<{
  "update:value": [value: string];
}>();

// Internal state for uncontrolled mode
const internalValue = ref(props.defaultValue || "");

// Computed for current active value
const currentValue = computed({
  get: () => props.value ?? internalValue.value,
  set: (newValue: string) => {
    if (props.value !== undefined) {
      emit("update:value", newValue);
    } else {
      internalValue.value = newValue;
    }
  },
});

// Provide context to child components
provide("tabs-context", {
  value: currentValue,
  orientation: props.orientation,
  tabsPosition: props.tabsPosition,
});

export interface TabsContext {
  value: WritableComputedRef<string>;
  orientation: "horizontal" | "vertical";
  tabsPosition: "top" | "bottom";
}
</script>

<template>
  <div
    class="flex"
    :class="{
      'flex-col': orientation === 'horizontal',
      'flex-row': orientation === 'vertical',
      'flex-col-reverse':
        orientation === 'horizontal' && tabsPosition === 'bottom',
    }"
    :data-orientation="orientation"
    :data-tabs-position="tabsPosition"
  >
    <slot />
  </div>
</template>

<style scoped>
.tabs-root {
  display: flex;
  flex-direction: column;
}

.tabs-root[data-orientation="vertical"] {
  flex-direction: row;
}
</style>
