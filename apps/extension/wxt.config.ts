import { defineConfig } from 'wxt';

const PORTAL_HOST_PERMISSION = 'https://portal.citd.edu.vn/*';

/** The CampusWatch API origin the extension may call (public URL, not a secret). */
function apiHostPermission(): string {
  const url = new URL(process.env.WXT_API_BASE_URL ?? 'http://127.0.0.1:3000');
  return `${url.protocol}//${url.hostname}/*`;
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Explicit imports only: no auto-imported globals.
  imports: false,
  // Keep the dev server off port 3000, which the API uses by default.
  dev: { server: { port: 3100 } },
  manifest: {
    name: 'CampusWatch',
    description: 'Notifies you when your CITD Portal academic data changes.',
    // Least privilege (implementation plan, section 6.1). `cookies` is never requested,
    // and there is no access to websites other than the Portal and the CampusWatch API.
    permissions: ['storage', 'alarms'],
    host_permissions: [PORTAL_HOST_PERMISSION, apiHostPermission()],
  },
});
