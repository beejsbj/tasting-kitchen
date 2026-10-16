<script setup lang="ts">
import { inject } from "vue";

interface TabsContext {
  orientation: "horizontal" | "vertical";
  tabsPosition: "top" | "bottom";
}

const tabsContext = inject<TabsContext>("tabs-context");
</script>

<template>
  <div
    class="inline-flex items-center justify-center rounded-lg backdrop-blur-sm border border-white/10 p-1"
    :class="{
      'flex-row h-auto overflow-x-auto scrollbar-none':
        tabsContext?.orientation === 'horizontal',
      'flex-col h-auto w-fit': tabsContext?.orientation === 'vertical',
      'bg-gray-800/80': true,
    }"
    role="tablist"
    :aria-orientation="tabsContext?.orientation"
  >
    <slot />
  </div>
</template>

<style scoped>
/* Hide scrollbar but keep functionality */
.scrollbar-none {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.scrollbar-none::-webkit-scrollbar {
  display: none;
}
</style>
