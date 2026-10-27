import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next@16 ships native ESLint flat-config arrays, so they can be
// spread directly. Routing them through @eslint/eslintrc's FlatCompat crashes
// with a circular-structure error.
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // `private-audit/` holds local backups and environment inventories. It is
    // excluded from type checking too, so it must not be linted either.
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "private-audit/**"
    ]
  }
];

export default eslintConfig;
