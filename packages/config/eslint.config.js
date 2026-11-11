import { createEslintConfig } from './eslint/index.js';

export default createEslintConfig({ tsconfigRootDir: import.meta.dirname });
