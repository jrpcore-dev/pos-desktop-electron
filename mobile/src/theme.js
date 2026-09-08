import { MD3DarkTheme, MD3LightTheme, configureFonts } from "react-native-paper";

const INTER = {
  400: "Inter_400Regular",
  500: "Inter_500Medium",
  600: "Inter_600SemiBold",
  700: "Inter_700Bold",
  800: "Inter_800ExtraBold",
};

const VARIANT_WEIGHTS = {
  displayLarge: 800,
  displayMedium: 800,
  displaySmall: 700,
  headlineLarge: 700,
  headlineMedium: 700,
  headlineSmall: 700,
  titleLarge: 700,
  titleMedium: 600,
  titleSmall: 600,
  labelLarge: 600,
  labelMedium: 500,
  labelSmall: 500,
  bodyLarge: 400,
  bodyMedium: 400,
  bodySmall: 400,
};

const fontConfig = Object.fromEntries(
  Object.entries(VARIANT_WEIGHTS).map(([variant, weight]) => [
    variant,
    { fontFamily: INTER[weight], fontWeight: "normal" },
  ])
);

const shared = {
  colors: {
    primary: "#2563eb",
    primaryContainer: "#dbeafe",
    secondary: "#475569",
    secondaryContainer: "#e2e8f0",
    tertiary: "#0ea5e9",
    tertiaryContainer: "#e0f2fe",
  },
  fonts: configureFonts({ config: fontConfig }),
  roundness: 12,
};

export const DarkTheme = {
  ...MD3DarkTheme,
  ...shared,
  colors: {
    ...MD3DarkTheme.colors,
    ...shared.colors,
    primary: "#60a5fa",
    onPrimary: "#0b2a6b",
    primaryContainer: "#1e40af",
    onPrimaryContainer: "#dbeafe",
    secondary: "#94a3b8",
    secondaryContainer: "#334155",
    onSecondaryContainer: "#f1f5f9",
    tertiary: "#38bdf8",
    tertiaryContainer: "rgba(56, 189, 248, 0.16)",
    background: "#081226",
    surface: "#0f1b33",
    surfaceVariant: "#1c2a45",
    onSurface: "#e8eefc",
    onSurfaceVariant: "#94a8c9",
    outline: "rgba(148, 180, 220, 0.24)",
    outlineVariant: "rgba(148, 180, 220, 0.12)",
    error: "#f87171",
    errorContainer: "rgba(239, 68, 68, 0.16)",
    onError: "#ffffff",
    onErrorContainer: "#fecaca",
    success: "#22c55e",
  },
};

export const LightTheme = {
  ...MD3LightTheme,
  ...shared,
  colors: {
    ...MD3LightTheme.colors,
    ...shared.colors,
    primary: "#2563eb",
    onPrimary: "#ffffff",
    primaryContainer: "#dbeafe",
    onPrimaryContainer: "#172554",
    secondary: "#475569",
    secondaryContainer: "#e2e8f0",
    onSecondaryContainer: "#0f172a",
    tertiary: "#0ea5e9",
    tertiaryContainer: "#e0f2fe",
    background: "#f6f9ff",
    surface: "#ffffff",
    surfaceVariant: "#eef3fb",
    onSurface: "#0b1220",
    onSurfaceVariant: "#52627a",
    outline: "rgba(100, 116, 139, 0.5)",
    outlineVariant: "#e2e8f0",
    error: "#dc2626",
    errorContainer: "rgba(220, 38, 38, 0.1)",
    onError: "#ffffff",
    onErrorContainer: "#991b1b",
    success: "#16a34a",
  },
};
