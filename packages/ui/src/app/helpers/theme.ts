import { darkTheme, lightTheme } from "../config/themes"

export const getThemeSettings = () => [
  {
    // Default to light theme.
    variables: lightTheme
  },
  {
    // React to the color scheme media query.
    mediaQuery: "(prefers-color-scheme: dark)",
    variables: darkTheme
  },
  {
    // Reacts to the dark class.
    selector: ".dark",
    variables: darkTheme
  }
]
