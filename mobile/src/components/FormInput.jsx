import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { TextInput, useTheme } from "react-native-paper";

export const FormSection = ({ title, subtitle, marginTop = 4, marginBottom = 16 }) => {
  const theme = useTheme();
  return (
    <View style={{ marginTop, marginBottom }}>
      <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
};

const FormInput = ({ label, required, placeholder, helperText, icon, style, contentStyle, outlineStyle, error, ...props }) => {
  const theme = useTheme();
  const borderColor = error ? theme.colors.error : theme.colors.outline;
  return (
    <View style={[styles.wrapper, style]}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: error ? theme.colors.error : theme.colors.onSurface }]}>
            {label}
          </Text>
          {required ? (
            <Text style={[styles.required, { color: error ? theme.colors.error : theme.colors.primary }]}> *</Text>
          ) : null}
        </View>
      ) : null}
      <TextInput
        mode="outlined"
        placeholder={placeholder || label}
        outlineColor={borderColor}
        activeOutlineColor={error ? theme.colors.error : theme.colors.primary}
        outlineStyle={[{ borderRadius: 10, borderWidth: 1.2 }, outlineStyle]}
        style={{ backgroundColor: theme.colors.surfaceVariant }}
        contentStyle={[{ minHeight: 50 }, contentStyle]}
        textColor={theme.colors.onSurface}
        placeholderTextColor={theme.colors.onSurfaceVariant}
        left={icon ? <TextInput.Icon icon={icon} color={theme.colors.onSurfaceVariant} /> : undefined}
        error={error}
        {...props}
      />
      {helperText ? (
        <Text style={[styles.helper, { color: error ? theme.colors.error : theme.colors.onSurfaceVariant }]}>
          {helperText}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { marginBottom: 16 },
  labelRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 6, marginLeft: 2 },
  label: { fontSize: 13, fontWeight: "600" },
  required: { fontSize: 13, fontWeight: "700" },
  helper: { fontSize: 12, marginTop: 5, marginLeft: 2 },
  sectionTitle: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 12.5, marginTop: 3, lineHeight: 18 },
});

export default FormInput;
