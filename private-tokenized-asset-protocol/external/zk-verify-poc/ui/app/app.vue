<template>
  <div class="app-root">
    <NuxtRouteAnnouncer />
    <NuxtPage class="app-page" />
    <footer class="app-footer">
      <p>zkVerify PoC</p>
      <p class="app-footer-copy">Directory, Certificate Overview, and Full Record SPA views.</p>
    </footer>
  </div>
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-page {
  flex: 1;
}

.app-footer {
  border-top: 1px solid #1d3552;
  background: rgba(8, 14, 24, 0.92);
  color: #8ea2bf;
  font-family: var(--font-mono);
  font-size: 0.84rem;
  padding: 0.75rem 2.5rem 0.95rem;
}

.app-footer p {
  margin: 0;
}

.app-footer-copy {
  margin-top: 0.25rem !important;
}

@media (max-width: 1024px) {
  .app-footer {
    padding: 0.75rem 1.1rem 0.9rem;
  }
}
</style>
