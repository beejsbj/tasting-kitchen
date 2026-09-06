<script setup lang="ts">
interface Props {
  width?: string;
  height?: string;
  maxHeight?: string;
  bodyClass?: string;
}

withDefaults(defineProps<Props>(), {
  width: "min(22rem, calc(100vw - 1rem))",
  height: "",
  maxHeight: "min(72vh, 34rem)",
  bodyClass: "",
});
</script>

<template>
  <section
    data-testid="overlay-panel-shell"
    class="relative overflow-hidden border border-[#464646]/85 bg-[#090909]/97 text-white shadow-[0_18px_44px_rgba(0,0,0,0.45)] backdrop-blur-md [clip-path:polygon(0_16px,16px_0,calc(100%-16px)_0,100%_16px,100%_calc(100%-16px),calc(100%-16px)_100%,16px_100%,0_calc(100%-16px))]"
    :style="{ width, height: height || undefined, maxHeight }"
  >
    <div
      class="pointer-events-none absolute inset-[1px] border border-[#1d1d1d]/75 [clip-path:polygon(0_15px,15px_0,calc(100%-15px)_0,100%_15px,100%_calc(100%-15px),calc(100%-15px)_100%,15px_100%,0_calc(100%-15px))]"
    />
    <div
      class="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),transparent_22%),linear-gradient(90deg,rgba(255,255,255,0.05),transparent_16%,transparent_84%,rgba(255,255,255,0.04))]"
    />
    <div class="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/16" />
    <div class="pointer-events-none absolute left-4 top-3 flex gap-1">
      <span class="h-2 w-7 [clip-path:polygon(12%_0,100%_0,88%_100%,0_100%)] bg-[#d4d4d4]" />
      <span class="h-2 w-5 [clip-path:polygon(12%_0,100%_0,88%_100%,0_100%)] bg-[#9d9d9d]" />
      <span class="h-2 w-6 [clip-path:polygon(12%_0,100%_0,88%_100%,0_100%)] bg-[#6d6d6d]" />
    </div>
    <div class="pointer-events-none absolute right-4 top-3 h-px w-10 bg-white/12" />

    <div
      class="pointer-events-none absolute inset-y-0 right-0 w-px bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.08),transparent)]"
    />

    <div class="relative flex h-full max-h-full min-h-0 flex-col">
      <header
        v-if="$slots.header"
        data-testid="overlay-panel-shell-header"
        class="shrink-0 border-b border-[#2d2d2d] bg-[#0c0c0c]/90 px-3.5 py-2.5"
      >
        <slot name="header" />
      </header>

      <div
        v-if="$slots.toolbar"
        data-testid="overlay-panel-shell-toolbar"
        class="shrink-0 border-b border-[#252525] bg-[#121212]/88 px-3.5 py-2"
      >
        <slot name="toolbar" />
      </div>

      <div
        data-testid="overlay-panel-shell-body"
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-3 touch-pan-y"
        :class="bodyClass"
        :style="{ WebkitOverflowScrolling: 'touch' }"
      >
        <slot />
      </div>

      <footer
        v-if="$slots.footer"
        data-testid="overlay-panel-shell-footer"
        class="shrink-0 border-t border-[#2d2d2d] bg-[#0c0c0c]/92 px-3.5 py-2.5"
      >
        <slot name="footer" />
      </footer>
    </div>
  </section>
</template>
