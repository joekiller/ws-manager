module.exports = {
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "tsconfigRootDir": __dirname,
    "project": ["./tsconfig.json", "./tsconfig.jest.json", "./example/tsconfig.json"],
  },
  "ignorePatterns": [
    "jest.config.ts"
  ],
  "extends": [
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:prettier/recommended",
    "plugin:jest/recommended",
    "plugin:jest/style"
  ],
  "plugins": [
    "jest"
  ],
  "rules": {}
};
