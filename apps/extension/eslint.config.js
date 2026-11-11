import { createEslintConfig } from '@campuswatch/config/eslint';

export default createEslintConfig({ tsconfigRootDir: import.meta.dirname, react: true });
