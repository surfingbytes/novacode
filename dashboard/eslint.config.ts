import { globalIgnores } from 'eslint/config';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import pluginVue from 'eslint-plugin-vue';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}']
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommendedTypeChecked,

  {
    name: 'app/type-aware',
    files: ['**/*.{ts,mts,tsx,vue}'],
    languageOptions: {
      // projectService itself is enabled by defineConfigWithVueTs; pin the root so lint works from any cwd.
      parserOptions: { tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } }
      ],
      // Attribute line breaks are layout, which Prettier owns; skip-formatting does not cover this rule.
      'vue/first-attribute-linebreak': 'off'
    }
  },

  {
    name: 'app/tests',
    files: ['**/*.test.ts'],
    rules: {
      // `expect(obj.method)` / `vi.mocked(obj.method)` pass methods around without calling them.
      '@typescript-eslint/unbound-method': 'off',
      // async mock implementations stand in for async APIs even when they await nothing.
      '@typescript-eslint/require-await': 'off'
    }
  },

  skipFormatting
);
