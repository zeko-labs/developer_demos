<script setup lang="ts">
interface ArtifactEntry {
  fileName: string;
  href: string;
  available: boolean;
}

defineProps<{
  items: ArtifactEntry[];
}>();
</script>

<template>
  <ul class="artifact-list panel">
    <li v-for="item in items" :key="item.fileName" class="artifact-item">
      <a v-if="item.available" :href="item.href" target="_blank" rel="noreferrer" class="artifact-link">
        {{ item.fileName }}
      </a>
      <span v-else class="artifact-missing">{{ item.fileName }} (not found)</span>
    </li>
  </ul>
</template>

<style scoped>
.artifact-list {
  display: grid;
  gap: 0.6rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.artifact-link,
.artifact-missing {
  display: block;
  border: 1px solid #284363;
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 0.93rem;
  padding: 0.72rem 0.85rem;
}

.artifact-link {
  background: rgba(7, 12, 22, 0.52);
  color: #c8d7ed;
}

.artifact-link:hover {
  border-color: rgba(0, 247, 200, 0.9);
  color: var(--accent);
}

.artifact-missing {
  background: rgba(7, 12, 22, 0.44);
  color: #8698b3;
}
</style>
