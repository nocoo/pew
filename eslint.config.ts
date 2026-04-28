import eslint from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/.next-e2e/**",
      "**/.next-e2e-ui/**",
      "**/coverage/**",
      "packages/web/next-env.d.ts",
    ],
  },

  // Base: ESLint recommended + typescript-eslint strict
  eslint.configs.recommended,
  ...tseslint.configs.strict,

  // Global rule overrides for all packages
  {
    rules: {
      // Allow unused vars with _ prefix (common pattern for intentional ignores)
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Allow dynamic delete — used intentionally in config manipulation (notifier hooks)
      "@typescript-eslint/no-dynamic-delete": "off",
    },
  },

  // Web package: React hooks + Next.js rules
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooksPlugin,
      "@next/next": nextPlugin,
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Point to correct pages directory for monorepo
      "@next/next/no-html-link-for-pages": ["error", "packages/web/src/app"],
    },
  },

  // Test files: relax some rules
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // Ban .skip and .only — prevent accidentally committed debug modifiers
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='skip']",
          message: "Do not commit .skip tests — remove before committing",
        },
        {
          selector: "MemberExpression[property.name='only']",
          message: "Do not commit .only tests — remove before committing",
        },
      ],
    },
  },
);
