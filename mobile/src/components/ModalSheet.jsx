import React from "react";
import { Modal, View, ScrollView, StyleSheet, Pressable, Platform, Dimensions } from "react-native";
import { useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import useKeyboardHeight from "./useKeyboardHeight";

const { height: WINDOW_HEIGHT } = Dimensions.get("window");

const ModalSheet = ({ visible, onDismiss, children, dismissable = true, maxHeightRatio = 0.88 }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  const bottomPad = keyboard > 0 ? 12 : Math.max(insets.bottom, 16);
  const maxHeight = keyboard > 0 ? Math.max(240, WINDOW_HEIGHT - keyboard - 16) : WINDOW_HEIGHT * maxHeightRatio;

  return (
    <Modal
      transparent
      visible={visible}
      onRequestClose={onDismiss}
      animationType={Platform.OS === "ios" ? "slide" : "none"}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[styles.root, keyboard > 0 && { paddingBottom: keyboard }]}>
        <Pressable style={styles.backdrop} onPress={dismissable ? onDismiss : null} />
        <View style={styles.sheetShadow}>
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                borderTopColor: theme.colors.outlineVariant,
                paddingBottom: bottomPad,
                maxHeight,
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: theme.colors.onSurfaceVariant }]} />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  sheetShadow: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 24,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 6, opacity: 0.6 },
  content: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
});

export default ModalSheet;
