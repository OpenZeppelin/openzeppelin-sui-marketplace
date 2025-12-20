/** @type {import("prettier").Config} */
const config = {
  trailingComma: "none",
  tabWidth: 2,
  useTabs: false,
  semi: false,
  singleQuote: false,
  bracketSpacing: true,
  printWidth: 80,
  tailwindConfig: "./tailwind.config.ts",
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindFunctions: ["clsx", "c", "cn"]
}

export default config
