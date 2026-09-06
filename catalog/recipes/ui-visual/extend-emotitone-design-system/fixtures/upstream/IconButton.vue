<script setup lang="ts">
import { computed } from "vue";

type Tone = "amber" | "red" | "violet" | "cream" | "green" | "neutral";
type Size = "sm" | "md";

interface Props {
  tone?: Tone;
  size?: Size;
  type?: "button" | "submit" | "reset";
}

const props = withDefaults(defineProps<Props>(), {
  tone: "neutral",
  size: "sm",
  type: "button",
});

const toneClass = computed(
  () =>
    (
      {
        amber:
          "border-[#47433a] bg-[#151413] text-[#d4d0c7] hover:border-[#8d887d] hover:text-white",
        red:
          "border-[#433d3d] bg-[#151313] text-[#d3cccc] hover:border-[#8a8383] hover:text-white",
        violet:
          "border-[#3f4049] bg-[#141418] text-[#d1d2db] hover:border-[#878992] hover:text-white",
        cream:
          "border-[#53504a] bg-[#171615] text-[#e0ddd6] hover:border-[#9a968d] hover:text-white",
        green:
          "border-[#3c443d] bg-[#131613] text-[#d0d7d0] hover:border-[#899089] hover:text-white",
        neutral:
          "border-[#3d3d3d] bg-[#151515] text-neutral-300 hover:border-[#8a8a8a] hover:text-white",
      } as const
    )[props.tone]
);

const sizeClass = computed(
  () =>
    (
      {
        sm: "h-8 w-8 text-[9px]",
        md: "h-9 w-9 text-[10px]",
      } as const
    )[props.size]
);
</script>

<template>
  <button
    :type="type"
    class="inline-flex items-center justify-center border transition-all duration-200 [clip-path:polygon(14%_0,100%_0,86%_100%,0_100%)] disabled:pointer-events-none disabled:opacity-40"
    :class="[toneClass, sizeClass]"
  >
    <slot />
  </button>
</template>
