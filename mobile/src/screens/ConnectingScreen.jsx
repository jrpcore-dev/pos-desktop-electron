import React, { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Text, ActivityIndicator, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { initialize } from "../services/api";
import RaisedButton from "../components/RaisedButton";

const ConnectingScreen = ({ onConnected }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState("Buscando servidor...");
  const [failed, setFailed] = useState(false);

  const connect = async () => {
    setStatus("Buscando servidor...");
    setFailed(false);
    try {
      const result = await initialize();
      if (result.connected) {
        onConnected();
      } else {
        setStatus("No se encontró el servidor");
        setFailed(true);
      }
    } catch (err) {
      setStatus("Error de conexión");
      setFailed(true);
    }
  };

  useEffect(() => { connect(); }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      {!failed ? (
        <>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text variant="titleMedium" style={{ marginTop: 24, color: theme.colors.onSurface, fontWeight: "600" }}>
            {status}
          </Text>
          <Text style={{ marginTop: 8, color: theme.colors.onSurfaceVariant, textAlign: "center", lineHeight: 22 }}>
            Conectando al sistema de ventas{"\n"}vía WiFi local
          </Text>
        </>
      ) : (
        <>
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: "600", marginBottom: 8 }}>
            {status}
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: "center", lineHeight: 22, marginBottom: 24 }}>
            Asegúrate de estar en la misma red WiFi{"\n"}y que el sistema de ventas esté abierto
          </Text>
          <RaisedButton onPress={connect} style={{ borderRadius: 12 }}>
            Reintentar
          </RaisedButton>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
});

export default ConnectingScreen;
