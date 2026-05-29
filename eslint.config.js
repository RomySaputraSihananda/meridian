import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  {
    files: ["**/*.js", "!test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: false },
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "error",
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node, describe: "readonly", it: "readonly", expect: "readonly", beforeEach: "readonly" },
      parserOptions: {
        ecmaFeatures: { jsx: false },
        ecmaVersion: 2024,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "error",
    },
  },
  prettier,
  {
    ignores: ["node_modules/**", "discord-listener/**", "scripts/**"],
  },
];
