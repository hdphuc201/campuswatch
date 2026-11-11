import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Keep the dev server off port 3000, which the API uses by default.
  dev: { server: { port: 3100 } },
  manifest: {
    name: 'CampusWatch',
    description: 'Notifies you when your CITD Portal academic data changes.',
    // P1 requests no permissions. Portal host access and alarms are added in P3/P4
    // (implementation plan, section 6.1). The `cookies` permission is never requested.
    permissions: [],
  },
});
