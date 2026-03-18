<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  status: "verified" | "failed" | "unknown";
}>();

const label = computed(() => {
  if (props.status === "verified") {
    return "Verified";
  }

  if (props.status === "failed") {
    return "Failed";
  }

  return "Unknown";
});
</script>

<template>
  <span class="status-badge" :class="`status-${status}`">
    <span class="status-dot" aria-hidden="true" />
    {{ label }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.43rem;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0.34rem 0.74rem;
  font-family: var(--font-mono);
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1;
  text-transform: uppercase;
}

.status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: currentColor;
}

.status-verified {
  border-color: rgba(0, 247, 200, 0.74);
  background: var(--accent-glow);
  color: var(--accent);
}

.status-failed {
  border-color: rgba(255, 87, 87, 0.7);
  background: var(--fail-glow);
  color: var(--fail);
}

.status-unknown {
  border-color: rgba(255, 202, 86, 0.72);
  background: var(--warn-glow);
  color: var(--warn);
}
</style>
