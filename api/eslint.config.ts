// node_modules
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

// Node globals used by the plain .mjs scripts (TS files get them from @types/node)
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly'
} as const;

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['build/**', 'src/generated/**', 'prisma/**', 'node_modules/**']
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: nodeGlobals }
  },
  {
    rules: {
      // `_`-prefixed names mark intentionally unused params / omitted rest props
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ]
    }
  },
  {
    // Classes hold the logic routes call; they must never reach back into routes.
    files: ['src/classes/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../routes/*', '**/routes/*'],
              message: 'Classes must not import routes; move the shared code into src/classes.'
            }
          ]
        }
      ]
    }
  }
);
