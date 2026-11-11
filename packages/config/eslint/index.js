import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ignores = ['**/dist/**', '**/.output/**', '**/.wxt/**', '**/.turbo/**', '**/coverage/**'];

/**
 * Builds the shared flat ESLint config for a workspace package.
 *
 * @param {object} options
 * @param {string} options.tsconfigRootDir Directory containing the package tsconfig.json.
 * @param {boolean} [options.react] Enable React hooks rules and browser globals.
 */
export function createEslintConfig({ tsconfigRootDir, react = false }) {
  return tseslint.config(
    { ignores },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: react ? globals.browser : globals.node,
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        eqeqeq: ['error', 'always'],
        'no-console': 'error',
      },
    },
    ...(react ? [reactHooks.configs.flat.recommended] : []),
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      ...tseslint.configs.disableTypeChecked,
    },
    prettier,
  );
}
