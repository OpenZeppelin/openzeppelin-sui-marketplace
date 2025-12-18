import eslint from "@eslint/js"
import prettierPluginRecommended from "eslint-plugin-prettier/recommended"
import unicornPlugin from "eslint-plugin-unicorn"
import typescriptEslint from "typescript-eslint"

export default typescriptEslint.config(
  eslint.configs.recommended,
  typescriptEslint.configs.strict,
  prettierPluginRecommended,
  {
    plugins: {
      unicorn: unicornPlugin
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "prettier/prettier": ["error"]
    }
  },
  {
    ignores: ["*/node_modules/"]
  }
)
