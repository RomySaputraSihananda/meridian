import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
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
