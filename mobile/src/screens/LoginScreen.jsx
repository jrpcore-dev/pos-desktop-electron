import React, { useState, useEffect, useMemo } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, Dimensions, KeyboardAvoidingView, Platform } from "react-native";
import { Text, Button, ActivityIndicator, useTheme, Avatar } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authenticate, getCashiers } from "../services/api";
import FormInput from "../components/FormInput";
import PressableCard from "../components/PressableCard";
import RaisedButton from "../components/RaisedButton";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
const GAP = 12;
const MAX_COLUMNS = 3;

const LoginScreen = ({ onLogin }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [cashiers, setCashiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [pin, setPin] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await getCashiers();
        setCashiers(data.cashiers || []);
      } catch {} finally {
        setLoading(false);
      }
    })();
  }, []);

  const columns = Math.min(MAX_COLUMNS, Math.max(1, cashiers.length));
  const cardWidth = Math.min(380, SCREEN_WIDTH - 48);
  const innerWidth = cardWidth - 48;
  const itemSize = Math.max(92, Math.min(148, (innerWidth - GAP * (columns - 1)) / columns));
  const avatarSize = itemSize > 124 ? 56 : itemSize > 96 ? 48 : 40;

  const rows = useMemo(() => {
    const out = [];
    for (let i = 0; i < cashiers.length; i += columns) out.push(cashiers.slice(i, i + columns));
    return out;
  }, [cashiers, columns]);

  const handleSelect = (item) => {
    if (item.is_active === 0) {
      setError("Este usuario está inactivo");
      return;
    }
    setSelectedId(item.id);
    setPin("");
    setError("");
  };

  const handleLogin = async () => {
    if (!selectedId) { setError("Selecciona un usuario"); return; }
    if (!pin.trim()) { setError("Ingresa tu PIN"); return; }
    setAuthLoading(true);
    setError("");
    try {
      const result = await authenticate(selectedId, pin.trim());
      if (result.success) {
        onLogin(result.cashier);
      } else {
        setError(result.error || "PIN inválido");
      }
    } catch (err) {
      setError("Error de conexión");
    } finally {
      setAuthLoading(false);
    }
  };

  const selected = cashiers.find((c) => c.id === selectedId);

  const renderAvatarCard = (item, index) => {
    const initial = item.name.charAt(0).toUpperCase();
    const bgColor = COLORS[index % COLORS.length];
    const isActive = item.is_active !== 0;
    return (
      <PressableCard
        key={String(item.id)}
        onPress={() => handleSelect(item)}
        disabled={!isActive}
        style={[
          styles.avatarCard,
          {
            width: itemSize,
            height: itemSize,
            backgroundColor: theme.colors.surfaceVariant,
            borderColor: isActive ? theme.colors.outlineVariant : theme.colors.error,
            shadowColor: isActive ? bgColor : theme.colors.error,
          },
          !isActive && styles.inactiveCard,
        ]}
        pressedStyle={styles.avatarCardPressed}
      >
        <Avatar.Text
          size={avatarSize}
          label={initial}
          color="#ffffff"
          style={{ backgroundColor: isActive ? bgColor : theme.colors.surfaceDisabled, alignSelf: "center" }}
        />
        <Text
          variant="labelSmall"
          numberOfLines={1}
          style={{ textAlign: "center", marginTop: 6, fontWeight: "600", color: isActive ? theme.colors.onSurface : theme.colors.onSurfaceVariant, width: itemSize - 16 }}
        >
          {item.name}
        </Text>
        <View style={[styles.badge, { backgroundColor: isActive ? "#dcfce7" : "#fee2e2", borderColor: isActive ? "#22c55e" : "#ef4444" }]}>
          <View style={[styles.badgeDot, { backgroundColor: isActive ? "#16a34a" : "#dc2626" }]} />
          <Text style={[styles.badgeText, { color: isActive ? "#15803d" : "#b91c1c" }]}>
            {isActive ? "Activo" : "Inactivo"}
          </Text>
        </View>
      </PressableCard>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
          <View style={[styles.accent, { backgroundColor: theme.colors.primary }]} />
          <Text variant="headlineSmall" style={{ fontWeight: "800", color: theme.colors.onSurface, textAlign: "center" }}>
            POS Móvil
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: 4, marginBottom: 20 }}>
            {selectedId ? "Ingresa tu PIN para acceder" : "Selecciona un usuario"}
          </Text>

          {!selectedId ? (
            loading ? (
              <ActivityIndicator size="large" style={{ paddingVertical: 40 }} color={theme.colors.primary} />
            ) : rows.length === 0 ? (
              <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: "center", paddingVertical: 32 }}>
                No hay usuarios registrados
              </Text>
            ) : (
              <ScrollView
                style={{ maxHeight: 340 }}
                contentContainerStyle={styles.grid}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                {rows.map((row, ri) => (
                  <View key={ri} style={styles.gridRow}>
                    {row.map((item, idx) => renderAvatarCard(item, ri * columns + idx))}
                  </View>
                ))}
              </ScrollView>
            )
          ) : (
            <View style={{ width: "100%" }}>
              <TouchableOpacity onPress={() => { setSelectedId(null); setError(""); }} style={{ alignSelf: "center", marginBottom: 16 }} activeOpacity={0.8}>
                <Avatar.Text
                  size={64}
                  label={selected.name.charAt(0).toUpperCase()}
                  color="#ffffff"
                  style={{ backgroundColor: COLORS[selected.id % COLORS.length], alignSelf: "center" }}
                />
                <Text variant="titleMedium" style={{ textAlign: "center", fontWeight: "700", marginTop: 4, color: theme.colors.onSurface }}>
                  {selected.name}
                </Text>
                <Text variant="labelSmall" style={{ textAlign: "center", color: theme.colors.onSurfaceVariant }}>
                  {selected.role === "admin" ? "Propietario" : "Cajero"} — tocar para cambiar
                </Text>
              </TouchableOpacity>

              <FormInput
                label="PIN de acceso"
                value={pin}
                onChangeText={(t) => { setPin(t.replace(/\D/g, "").slice(0, 6)); setError(""); }}
                secureTextEntry
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                error={!!error}
              />
              {error ? (
                <Text style={{ color: theme.colors.error, fontSize: 13, marginBottom: 8 }}>{error}</Text>
              ) : null}

              <RaisedButton
                onPress={handleLogin}
                loading={authLoading}
                disabled={authLoading || pin.length < 3}
                style={{ borderRadius: 14, marginTop: 8 }}
              >
                {authLoading ? "Conectando..." : "Acceder"}
              </RaisedButton>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  card: {
    width: "100%",
    maxWidth: 380,
    padding: 24,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { height: 8 },
    elevation: 6,
  },
  accent: { width: 40, height: 4, borderRadius: 2, marginBottom: 16 },
  avatarCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 10,
    justifyContent: "center",
    alignItems: "center",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { height: 4 },
    elevation: 6,
  },
  avatarCardPressed: { opacity: 0.88 },
  inactiveCard: { opacity: 0.55 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  grid: { alignItems: "center", paddingVertical: 2 },
  gridRow: { flexDirection: "row", gap: GAP, marginBottom: GAP },
});

export default LoginScreen;
