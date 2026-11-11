// The extension sources read build-time values from Vite's `import.meta.env`.
interface ImportMetaEnv {
  readonly WXT_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
