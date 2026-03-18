<script setup lang="ts">
import { computed, ref } from "vue";

interface GridItem {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  href?: string;
  external?: boolean;
  copyValue?: string;
}

defineProps<{
  items: GridItem[];
}>();

const copiedKey = ref<string | null>(null);

const copyButtonTitle = computed(() =>
  copiedKey.value === null ? "Copy" : "Copied",
);

async function copyValue(item: GridItem): Promise<void> {
  if (
    !item.copyValue ||
    typeof navigator === "undefined" ||
    !navigator.clipboard
  ) {
    return;
  }

  try {
    await navigator.clipboard.writeText(item.copyValue);
    copiedKey.value = item.label;
    setTimeout(() => {
      copiedKey.value = null;
    }, 1200);
  } catch {
    copiedKey.value = null;
  }
}
</script>

<template>
  <dl class="kv-grid panel">
    <template v-for="item in items" :key="item.label">
      <dt class="kv-label">{{ item.label }}</dt>
      <dd class="kv-value" :class="{ mono: item.mono, highlight: item.highlight }">
        <span class="kv-value-content">
          <a
            v-if="item.href"
            :href="item.href"
            :target="item.external ? '_blank' : undefined"
            :rel="item.external ? 'noreferrer' : undefined"
            class="kv-link"
          >
            {{ item.value }}
          </a>
          <span v-else class="kv-text">{{ item.value }}</span>
          <button
            v-if="item.copyValue"
            type="button"
            class="kv-copy-btn"
            :class="{ 'is-copied': copiedKey === item.label }"
            aria-label="Copy value to clipboard"
            :title="copyButtonTitle"
            @click="copyValue(item)"
          >
            <svg
              class="kv-copy-icon"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect
                x="9"
                y="3"
                width="11"
                height="14"
                rx="2"
                stroke="currentColor"
                stroke-width="2"
              />
              <rect
                x="4"
                y="8"
                width="11"
                height="13"
                rx="2"
                stroke="currentColor"
                stroke-width="2"
              />
            </svg>
          </button>
        </span>
      </dd>
    </template>
  </dl>
</template>

<style scoped>
.kv-grid {
  margin: 0;
  display: grid;
  grid-template-columns: 190px 1fr;
  gap: 0.82rem 1.14rem;
}

.kv-label {
  color: #95a9c6;
}

.kv-value {
  margin: 0;
  color: #d8e2f2;
  overflow-wrap: anywhere;
}

.kv-value-content {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  flex-wrap: nowrap;
}

.kv-value.highlight {
  color: var(--accent);
}

.kv-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.kv-link {
  color: #9ec8ff;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.kv-link:hover {
  color: var(--accent);
}

.kv-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 1.85rem;
  height: 1.85rem;
  min-width: 1.85rem;
  min-height: 1.85rem;
  border: 1px solid rgba(0, 247, 200, 0.7);
  border-radius: 6px;
  background: rgba(0, 247, 200, 0.1);
  color: var(--accent);
  cursor: pointer;
  padding: 0;
}

.kv-copy-btn:hover,
.kv-copy-btn.is-copied {
  background: rgba(0, 247, 200, 0.18);
}

.kv-copy-icon {
  width: 0.9rem;
  height: 0.9rem;
}

@media (max-width: 1024px) {
  .kv-grid {
    grid-template-columns: 1fr;
    gap: 0.24rem;
  }
}
</style>
