import { createContext, useContext } from "react";

export const ThemeModeContext = createContext({ toggleMode: () => {} });

export const useThemeMode = () => useContext(ThemeModeContext);
