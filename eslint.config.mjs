import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['node_modules/**', 'out/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ['**/*.{ts,tsx}'] })),
  { languageOptions: { globals: globals.node } },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser }
  }
]
