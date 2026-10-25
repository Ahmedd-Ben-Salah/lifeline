import nextVitals from 'eslint-config-next/core-web-vitals';
const config = [
  ...nextVitals,
  { ignores: ['.next/**', 'lib/engine/data/**', 'scripts/**'] },
  // React Compiler advisory rules: we keep three.js state in refs and fetch in effects on purpose
  { rules: { 'react-hooks/set-state-in-effect': 'warn', 'react-hooks/refs': 'warn', 'react-hooks/immutability': 'warn', 'react-hooks/purity': 'warn' } },
];
export default config;
