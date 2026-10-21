<script setup lang="ts">
import { inject, computed } from "vue";

interface Props {
  value: string;
}

const props = defineProps<Props>();

interface TabsContext {
  value: { value: string };
}

const tabsContext = inject<TabsContext>("tabs-context");

const isActive = computed(() => tabsContext?.value.value === props.value);
</script>

<template>
  <div
    v-if="isActive"
    class="mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
    :data-state="isActive ? 'active' : 'inactive'"
    role="tabpanel"
    :tabindex="0"
  >
    <slot />
  </div>
</template>
