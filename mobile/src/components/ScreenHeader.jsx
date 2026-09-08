import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ScreenHeader = ({ title, subtitle, user }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const initials = user?.name
    ? user.name.trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()
    : "U";

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.outlineVariant,
          paddingTop: insets.top + 14,
        },
      ]}
    >
      <View style={styles.titleBox}>
        <Text style={[styles.title, { color: theme.colors.onSurface }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {user ? (
        <View style={styles.user}>
          <View style={[styles.avatar, { backgroundColor: theme.colors.primary }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.userText}>
            <Text style={[styles.userName, { color: theme.colors.onSurface }]} numberOfLines={1}>
              {user.name}
            </Text>
            <Text style={[styles.userRole, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
              {user.role === "admin" ? "Administrador" : "Cajero"}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleBox: { flex: 1, paddingRight: 12 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { fontSize: 13, marginTop: 3 },
  user: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#ffffff", fontWeight: "800", fontSize: 15 },
  userText: { maxWidth: 110 },
  userName: { fontSize: 14, fontWeight: "700" },
  userRole: { fontSize: 12, marginTop: 1 },
});

export default ScreenHeader;
