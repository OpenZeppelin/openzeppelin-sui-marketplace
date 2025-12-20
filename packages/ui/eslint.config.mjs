import js from "@eslint/js"
import typescript from "@typescript-eslint/eslint-plugin"
import typescriptParser from "@typescript-eslint/parser"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"

const eslintConfig = [
  {
    ignores: ["node_modules/**", "dist/**", ".next/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        React: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": typescript,
      "react-hooks": reactHooks
    },
    rules: {
      ...typescript.configs.recommended.rules,
      ...(() => {
        const reactHooksRules = { ...reactHooks.configs.recommended.rules }
        delete reactHooksRules["react-hooks/set-state-in-effect"]
        return reactHooksRules
      })(),
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-imports": [
        "error",
        {
          patterns: ["dapp/*", "~~/dapp/*", "@sui-oracle-market/*-node"]
        }
      ],
      "no-undef": "off" // TypeScript handles this
    }
  }
]

export default eslintConfig
