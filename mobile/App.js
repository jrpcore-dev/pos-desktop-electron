import React, { useState, useMemo, useRef, useEffect } from "react";
import { StyleSheet, View, AppState } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { PaperProvider, useTheme } from "react-native-paper";
import { NavigationContainer, DefaultTheme, DarkTheme as NavDarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from "@expo-google-fonts/inter";

import { DarkTheme, LightTheme } from "./src/theme";
import ScannerScreen from "./src/screens/ScannerScreen";
import ManualScreen from "./src/screens/ManualScreen";
import LoginScreen from "./src/screens/LoginScreen";
import ConnectingScreen from "./src/screens/ConnectingScreen";
import { logout } from "./src/services/api";

const Tab = createBottomTabNavigator();

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const BACKGROUND_LOGOUT_MS = 60 * 1000;

const AppIcon = ({ name, size, color }) => (
  <MaterialCommunityIcons name={name} size={size} color={color} />
);

const MainTabs = ({ cashier }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 58 + Math.max(insets.bottom, 6);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outlineVariant,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: tabBarHeight,
          paddingBottom: Math.max(insets.bottom, 6),
          paddingTop: 8,
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarLabelStyle: { fontWeight: "600", fontSize: 12 },
      }}
    >
      <Tab.Screen
        name="Scanner"
        options={{
          title: "Escanear",
          tabBarIcon: ({ color, size }) => <AppIcon name="qrcode-scan" size={size} color={color} />,
        }}
      >
        {() => <ScannerScreen cashier={cashier} />}
      </Tab.Screen>
      <Tab.Screen
        name="Manual"
        options={{
          title: "Manual",
          tabBarIcon: ({ color, size }) => <AppIcon name="magnify" size={size} color={color} />,
        }}
      >
        {() => <ManualScreen cashier={cashier} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
};

const AppTheme = {
  dark: DarkTheme,
  light: LightTheme,
};

export default function App() {
  const [isDark] = useState(true);
  const [screen, setScreen] = useState("connecting");
  const [cashier, setCashier] = useState(null);

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const timerRef = useRef(null);
  const bgStartRef = useRef(null);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const logoutToLogin = async () => {
    clearTimer();
    try {
      await logout();
    } catch {}
    setCashier(null);
    setScreen("login");
  };

  const scheduleTimer = () => {
    clearTimer();
    timerRef.current = setTimeout(logoutToLogin, SESSION_TIMEOUT_MS);
  };

  const handleActivity = () => {
    if (screenRef.current === "main") scheduleTimer();
  };

  useEffect(() => {
    if (screen === "main") scheduleTimer();
    else clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        if (screenRef.current !== "main") return;
        const bgMs = bgStartRef.current ? Date.now() - bgStartRef.current : 0;
        bgStartRef.current = null;
        if (bgMs >= BACKGROUND_LOGOUT_MS) {
          logoutToLogin();
        } else {
          scheduleTimer();
        }
      } else {
        clearTimer();
        bgStartRef.current = Date.now();
      }
    });
    return () => {
      sub.remove();
      clearTimer();
    };
  }, []);

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  const paperTheme = useMemo(() => (isDark ? DarkTheme : LightTheme), [isDark]);
  const navTheme = useMemo(() => ({
    ...(isDark ? NavDarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? NavDarkTheme.colors : DefaultTheme.colors),
      background: isDark ? "#081226" : "#f6f9ff",
      card: isDark ? "#0f1b33" : "#ffffff",
      text: isDark ? "#e8eefc" : "#0b1220",
      border: "rgba(148, 180, 220, 0.15)",
      primary: isDark ? "#60a5fa" : "#2563eb",
    },
  }), [isDark]);

  const renderScreen = () => {
    switch (screen) {
      case "connecting":
        return <ConnectingScreen onConnected={() => setScreen("login")} />;
      case "login":
        return <LoginScreen onLogin={(c) => { setCashier(c); setScreen("main"); }} />;
      case "main":
        return <MainTabs cashier={cashier} />;
      default:
        return null;
    }
  };

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: isDark ? "#081226" : "#f6f9ff" }} />;
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <NavigationContainer theme={navTheme}>
          <StatusBar style={isDark ? "light" : "dark"} />
          <View style={{ flex: 1 }} onTouchStartCapture={handleActivity}>
            {renderScreen()}
          </View>
        </NavigationContainer>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
