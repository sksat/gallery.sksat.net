import tseslint from "typescript-eslint";
import qwikPlugin from "eslint-plugin-qwik";

export default tseslint.config(
  {
    ignores: [
      "**/.wrangler/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/server/**",
      "**/*.log",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2021,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      qwik: qwikPlugin,
    },
    rules: {
      ...qwikPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/ban-types": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "prefer-spread": "off",
      "no-case-declarations": "off",
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": ["error"],
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
    },
  },
);
