<script setup lang="ts">
interface Breadcrumb {
  label: string;
  to?: string;
}

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    breadcrumbs?: Breadcrumb[];
  }>(),
  {
    subtitle: "",
    breadcrumbs: () => [],
  },
);
</script>

<template>
  <main class="page-shell">
    <header class="page-header panel">
      <nav v-if="breadcrumbs.length > 0" class="breadcrumbs" aria-label="Breadcrumb">
        <template v-for="(crumb, index) in breadcrumbs" :key="`${crumb.label}-${index}`">
          <NuxtLink v-if="crumb.to" :to="crumb.to" class="crumb-link">
            {{ crumb.label }}
          </NuxtLink>
          <span v-else class="crumb-current">{{ crumb.label }}</span>
          <span v-if="index < breadcrumbs.length - 1" class="crumb-separator">/</span>
        </template>
      </nav>
      <h1>{{ title }}</h1>
      <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
    </header>

    <section>
      <slot />
    </section>
  </main>
</template>
