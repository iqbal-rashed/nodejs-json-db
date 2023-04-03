module.exports = {
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
    parser: "@typescript-eslint/parser",
    plugins: ["@typescript-eslint"],
    root: true,
    ignorePatterns: ["**/dist/*", "*.d.ts", ".cache", "**/*.config.js", ".eslintrc.js"],
};
