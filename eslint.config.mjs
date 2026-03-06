// @ts-check

import eslint from "@eslint/js"
import { defineConfig, globalIgnores } from "eslint/config"
import tseslint from "typescript-eslint"

export default defineConfig(
  globalIgnores([
    "node_modules/*",
    "dist/*",
    "types/*",
    "*.mjs",
    "*.config.js"
  ]),
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        TextDecoder: "readonly",
        TextEncoder: "readonly"
      },
      parserOptions: {
        projectService: true
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { caughtErrors: "none", argsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/strict-boolean-expressions": "error"
    }
  }
)
