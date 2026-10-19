import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next@16 ships native ESLint flat-config arrays, so they can be
// spread directly. Routing them through @eslint/eslintrc's FlatCompat crashes
// with a circular-structure error.
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [".next/**", "node_modules/**", "coverage/**"]
  }
];

export default eslintConfig;
