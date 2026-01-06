import eslint from "@eslint/js"
import prettierPluginRecommended from "eslint-plugin-prettier/recommended"
import unicornPlugin from "eslint-plugin-unicorn"
import typescriptEslint from "typescript-eslint"

const nodeBuiltinModules = [
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "tty",
  "v8",
  "vm",
  "worker_threads",
  "zlib"
]

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
    files: ["scripts/ci/install-sui-cli.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly"
      }
    }
  },
  {
    files: ["packages/domain/core/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["node:*", "@sui-oracle-market/*-node"],
          paths: nodeBuiltinModules
        }
      ]
    }
  },
  {
    files: ["packages/tooling/core/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["node:*", "@sui-oracle-market/domain-*"],
          paths: nodeBuiltinModules
        }
      ]
    }
  },
  {
    files: ["packages/tooling/node/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["@sui-oracle-market/domain-*"]
        }
      ]
    }
  },
  {
    files: ["packages/ui/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "node:*",
            "@sui-oracle-market/*-node",
            "dapp/*",
            "~~/dapp/*"
          ],
          paths: nodeBuiltinModules
        }
      ]
    }
  },
  {
    files: ["packages/learn/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "node:*",
            "@sui-oracle-market/*-node",
            "dapp/*",
            "~~/dapp/*"
          ],
          paths: nodeBuiltinModules
        }
      ]
    }
  },
  {
    ignores: [
      "**/node_modules/**",
      "packages/**/dist/**",
      "packages/**/.next/**"
    ]
  }
)
