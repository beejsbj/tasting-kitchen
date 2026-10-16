<script setup lang="ts">
import { inject, computed, type WritableComputedRef } from "vue";

interface Props {
  value: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
});

interface TabsContext {
  value: WritableComputedRef<string>;
  orientation: "horizontal" | "vertical";
  tabsPosition: "top" | "bottom";
}

const tabsContext = inject<TabsContext>("tabs-context");

const isActive = computed(() => tabsContext?.value.value === props.value);

const handleClick = () => {
  if (!props.disabled && tabsContext?.value) {
    tabsContext.value.value = props.value;
  }
};
</script>

<template>
  <button
    class="inline-flex min-h-0 items-center justify-center whitespace-nowrap rounded-md border-0 bg-transparent px-2 py-1.5 text-xs font-medium transition-all duration-200 select-none"
    :class="{
      'text-white shadow-none': isActive,
      'text-gray-300 hover:text-white hover:bg-white/5 active:bg-white/10 active:scale-95':
        !isActive && !disabled,
      'opacity-40 cursor-not-allowed pointer-events-none': disabled,
    }"
    :disabled="disabled"
    :data-state="isActive ? 'active' : 'inactive'"
    :data-disabled="disabled ? '' : undefined"
    role="tab"
    :aria-selected="isActive"
    :tabindex="isActive ? 0 : -1"
    @click="handleClick"
  >
    <slot />
  </button>
</template>
