const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    ignores: ["node_modules/**"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
  "no-console": "off",
  "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
  "preserve-caught-error": "off",
    },
  },
];
