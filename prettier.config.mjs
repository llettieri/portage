import importSort from 'prettier-plugin-import-sort';

const config = {
  semi: true,
  tabWidth: 2,
  singleQuote: true,
  trailingComma: 'all',
  arrowParens: 'always',
  plugins: [importSort, 'prettier-plugin-tailwindcss'],
};

export default config;
