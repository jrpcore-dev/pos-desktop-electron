import React, { useState, useRef, useCallback, useEffect } from "react";
import { View, StyleSheet, Vibration, Dimensions } from "react-native";
import { Text, Button, ActivityIndicator, Snackbar, Chip, useTheme, SegmentedButtons, IconButton, Switch } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { getProductByBarcode, createProduct, addStock } from "../services/api";
import { computeCostConfirm } from "../utils/costLogic";
import ModalSheet from "../components/ModalSheet";
import FormInput, { FormSection } from "../components/FormInput";
import RaisedButton from "../components/RaisedButton";
import ScreenHeader from "../components/ScreenHeader";
import { isContainerUnit, unitLabels } from "../utils/unitLabels";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const SCANNER_DELAY_MS = 3500;
const SCAN_DEBOUNCE_MS = 2500;
const DETECT_FEEDBACK_MS = 700;

const FRAME_WAIT_COLOR = "#94a3b8";
const FRAME_IDLE_COLOR = "#ef4444";
const FRAME_DETECTED_COLOR = "#22c55e";

const SALE_UNITS = [
  { value: "piece", label: "Pieza" },
  { value: "weight", label: "Kilo" },
  { value: "box", label: "Caja" },
  { value: "package", label: "Paquete" },
];

const UNIT_LABELS = { piece: "pz", weight: "kg", box: "cajas", package: "paquetes" };

const EMPTY_FORM = {
  name: "", barcode: "", cost_price: "", price: "", sale_unit: "piece", stock: "",
  box_qty: "", box_price: "",
};

const SheetHeader = ({ title, onClose }) => {
  const theme = useTheme();
  return (
    <View style={styles.sheetHeader}>
      <Text variant="titleLarge" style={{ fontWeight: "700", color: theme.colors.onSurface, flex: 1 }}>
        {title}
      </Text>
      <IconButton icon="close" onPress={onClose} />
    </View>
  );
};

const ScannerScreen = ({ cashier }) => {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [scannerReady, setScannerReady] = useState(false);
  const [detected, setDetected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showStockModal, setShowStockModal] = useState(false);
  const [snackbar, setSnackbar] = useState({ visible: false, text: "" });

  const [newProduct, setNewProduct] = useState({ ...EMPTY_FORM });

  const [stockQty, setStockQty] = useState("");
  const [stockCost, setStockCost] = useState("");
  const [stockRegisterExpense, setStockRegisterExpense] = useState(false);
  const [showCostConfirm, setShowCostConfirm] = useState(false);
  const [costConfirm, setCostConfirm] = useState(null);

  const lastCodeRef = useRef("");
  const lastScanAtRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setScannerReady(true), SCANNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const showMsg = (text) => setSnackbar({ visible: true, text });

  const handleBarCodeScanned = useCallback(async ({ data }) => {
    const code = String(data || "").trim();
    const now = Date.now();
    if (!scannerReady || !scanning || loading) return;
    if (code === lastCodeRef.current && now - lastScanAtRef.current < SCAN_DEBOUNCE_MS) return;

    lastCodeRef.current = code;
    lastScanAtRef.current = now;
    setScanning(false);
    setDetected(true);
    Vibration.vibrate(100);
    showMsg("¡Código de barras detectado!");

    await new Promise((resolve) => setTimeout(resolve, DETECT_FEEDBACK_MS));
    setDetected(false);
    setLoading(true);

    try {
      const result = await getProductByBarcode(code);
      setProduct(result.product);
      setShowDetail(true);
      showMsg(`Producto encontrado: ${result.product.name}`);
    } catch (err) {
      if (err.message.includes("no encontrado")) {
        setNewProduct({ ...EMPTY_FORM, barcode: code });
        setShowNewForm(true);
      } else {
        showMsg(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [scannerReady, scanning, loading]);

  const performAddStock = async (updateCostPrice) => {
    const qty = parseInt(stockQty);
    if (!qty || qty <= 0) return showMsg("Cantidad inválida");
    if (!product) return showMsg("Error: producto no disponible");
    const actualQty = isContainerUnit(product.sale_unit) && product.box_qty > 0 ? qty * product.box_qty : qty;
    try {
      const result = await addStock(product.id, actualQty, stockCost, "", stockRegisterExpense, updateCostPrice);
      setProduct(result.product);
      setShowStockModal(false);
      setStockQty("");
      setStockCost("");
      setStockRegisterExpense(false);
      const p = result.product;
      const isBox = isContainerUnit(p.sale_unit) && p.box_qty > 0 && p.stock >= p.box_qty;
      if (updateCostPrice != null) {
        showMsg(`Stock actualizado. Precio de costo: $${updateCostPrice.toFixed(2)}`);
      } else {
        showMsg(`Stock actualizado: ${p.stock} ${isBox ? (unitLabels(p.sale_unit)?.showMsg || "cajas") : "pz"}`);
      }
    } catch (err) {
      showMsg(err.message);
    }
  };

  const handleAddStock = async () => {
    const qty = parseInt(stockQty);
    if (!qty || qty <= 0) return showMsg("Cantidad inválida");
    if (!product) return showMsg("Error: producto no disponible");
    const confirm = computeCostConfirm({
      enteredCost: stockCost,
      quantity: qty,
      saleUnit: product.sale_unit,
      boxQty: product.box_qty,
      costPrice: product.cost_price,
    });
    if (confirm) {
      setCostConfirm(confirm);
      setShowCostConfirm(true);
      return;
    }
    await performAddStock(null);
  };

  const handleCostConfirmYes = () => {
    const confirm = costConfirm;
    setShowCostConfirm(false);
    setCostConfirm(null);
    performAddStock(confirm?.newCost ?? null);
  };

  const handleCostConfirmNo = () => {
    setShowCostConfirm(false);
    setCostConfirm(null);
    performAddStock(null);
  };

  const handleCreateProduct = async () => {
    if (!newProduct.name.trim()) return showMsg("El nombre es requerido");
    try {
      const isBox = isContainerUnit(newProduct.sale_unit);
      const boxQty = parseInt(newProduct.box_qty) || 0;
      const payload = {
        barcode: newProduct.barcode,
        name: newProduct.name.trim(),
        cost_price: parseFloat(newProduct.cost_price) || 0,
        price: parseFloat(newProduct.price) || 0,
        sale_unit: newProduct.sale_unit,
        stock: isBox ? (parseInt(newProduct.stock) || 0) * boxQty : parseInt(newProduct.stock) || 0,
        box_qty: boxQty,
        box_price: parseFloat(newProduct.box_price) || 0,
      };
      await createProduct(payload);
      setShowNewForm(false);
      showMsg(`Producto registrado: ${payload.name}`);
      setProduct(null);
      setScanning(true);
    } catch (err) {
      showMsg(err.message);
    }
  };

  const closeDetail = () => {
    setShowDetail(false);
    setScanning(true);
  };

  const closeNewForm = () => {
    setShowNewForm(false);
    setScanning(true);
  };

  const frameColor = !scannerReady ? FRAME_WAIT_COLOR : detected ? FRAME_DETECTED_COLOR : FRAME_IDLE_COLOR;
  const statusText = !scannerReady ? "Preparando escáner..." : detected ? "¡Código de barras detectado!" : "Enfoca el código de barras";

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title="Escanear" subtitle="Escanea códigos y registra productos" user={cashier} />
      {!permission?.granted ? (
        <View style={styles.center}>
          <Text variant="titleLarge" style={{ marginBottom: 16, color: theme.colors.onSurface }}>
            Permiso de cámara requerido
          </Text>
          <Button mode="contained" onPress={requestPermission} buttonColor={theme.colors.primary}
            style={{ borderRadius: 12, shadowColor: theme.colors.primary, shadowOpacity: 0.4, shadowRadius: 9, shadowOffset: { height: 5 }, elevation: 8 }}>
            Conceder permiso
          </Button>
        </View>
      ) : (
        <View style={styles.cameraContainer}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "code128", "code39", "upc_a", "upc_e"] }}
            onBarcodeScanned={handleBarCodeScanned}
          />
          <View style={styles.overlay} pointerEvents="none">
            <View style={styles.scanFrame}>
              <View style={[styles.scanBackdrop, { backgroundColor: frameColor, opacity: 0.08 }]} />
              <View style={[styles.corner, styles.cornerTL, { borderColor: frameColor }]} />
              <View style={[styles.corner, styles.cornerTR, { borderColor: frameColor }]} />
              <View style={[styles.corner, styles.cornerBL, { borderColor: frameColor }]} />
              <View style={[styles.corner, styles.cornerBR, { borderColor: frameColor }]} />
            </View>
            <View style={[styles.statusPill, { shadowColor: frameColor }]}>
              <View style={[styles.statusDot, { backgroundColor: frameColor }]} />
              <Text style={styles.scanHint}>{statusText}</Text>
            </View>
          </View>
        </View>
      )}

      {loading && (
        <View style={StyleSheet.absoluteFill}>
          <View style={[styles.center, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={{ marginTop: 16, color: "#fff" }}>Buscando producto...</Text>
          </View>
        </View>
      )}

      <ModalSheet visible={showDetail} onDismiss={closeDetail}>
        <SheetHeader title="Detalle del producto" onClose={closeDetail} />
        {!product ? (
          <Text style={{ color: theme.colors.error, textAlign: "center", marginVertical: 20 }}>Producto no disponible</Text>
        ) : (
          <>
            <View style={styles.productHeader}>
              <View style={[styles.productIcon, { backgroundColor: theme.colors.primaryContainer }]}>
                <MaterialCommunityIcons name="package-variant-closed" size={24} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="titleLarge" numberOfLines={2} style={{ fontWeight: "700", color: theme.colors.onSurface, lineHeight: 26 }}>
                  {product.name}
                </Text>
                {product.barcode && (
                  <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 }}>
                    Código: {product.barcode}
                  </Text>
                )}
              </View>
            </View>
            {isContainerUnit(product.sale_unit) && (product.box_qty || 0) > 0 && (product.stock || 0) >= (product.box_qty || 0) ? (
              <>
                <View style={styles.infoRow}>
                  <Text style={{ color: theme.colors.onSurfaceVariant }}>
                    {unitLabels(product.sale_unit)?.saleDetail || "Precio venta (caja):"}
                  </Text>
                  <Text style={{ fontWeight: "600", color: theme.colors.onSurface }}>${(product.box_price || 0).toFixed(2)}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={{ color: theme.colors.onSurfaceVariant }}>Precio pieza:</Text>
                  <Text style={{ color: theme.colors.onSurface }}>${(product.price || 0).toFixed(2)}</Text>
                </View>
              </>
            ) : (
              <View style={styles.infoRow}>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Precio venta:</Text>
                <Text style={{ fontWeight: "600", color: theme.colors.onSurface }}>${(product.price || 0).toFixed(2)}</Text>
              </View>
            )}
            {(product.cost_price || 0) > 0 && (
              <View style={styles.infoRow}>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Costo:</Text>
                <Text style={{ color: theme.colors.onSurface }}>${(product.cost_price || 0).toFixed(2)}</Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>Stock:</Text>
              <Chip compact mode="flat" textStyle={{ fontWeight: "700" }}
                style={{ backgroundColor: (product.stock || 0) > 5 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)" }}>
                {isContainerUnit(product.sale_unit) && (product.box_qty || 0) > 0 && (product.stock || 0) >= (product.box_qty || 0)
                  ? `${Math.floor((product.stock || 0) / (product.box_qty || 1))} ${unitLabels(product.sale_unit)?.plural || "cajas"} (${product.stock || 0} pz)`
                  : `${product.stock || 0} ${isContainerUnit(product.sale_unit) ? "pz" : (UNIT_LABELS[product.sale_unit] || "pz")}`}
              </Chip>
            </View>
            {product.sale_unit && (
              <View style={styles.infoRow}>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Venta por:</Text>
                <Text style={{ color: theme.colors.onSurface }}>
                  {(SALE_UNITS.find((u) => u.value === product.sale_unit)?.label) || product.sale_unit}
                </Text>
              </View>
            )}
            {isContainerUnit(product.sale_unit) && (product.box_qty || 0) > 0 && (
              <View style={styles.infoRow}>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>
                  {unitLabels(product.sale_unit)?.pzasPer || "Piezas por caja:"}
                </Text>
                <Text style={{ color: theme.colors.onSurface }}>{product.box_qty}</Text>
              </View>
            )}
            {product.category_name && (
              <View style={styles.infoRow}>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Categoría:</Text>
                <Text style={{ color: theme.colors.onSurface }}>{product.category_name}</Text>
              </View>
            )}
            {product.supplier_name && (
              <View style={styles.infoRow}>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Proveedor:</Text>
                <Text style={{ color: theme.colors.onSurface }}>{product.supplier_name}</Text>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 20, marginBottom: 8 }}>
              <RaisedButton icon="plus" onPress={() => { setStockRegisterExpense(false); setShowStockModal(true); }} style={{ flex: 1 }}>+ Stock</RaisedButton>
              <Button mode="outlined" onPress={closeDetail} style={{ flex: 1 }}>Escanear otro</Button>
            </View>
          </>
        )}
      </ModalSheet>

      <ModalSheet visible={showNewForm} onDismiss={closeNewForm}>
        <SheetHeader title="Nuevo producto" onClose={closeNewForm} />
        <FormSection title="Información del producto" subtitle="Completa los datos principales." />
        <FormInput label="Código" icon="barcode" value={newProduct.barcode} disabled helperText="Asignado automáticamente por el escáner" />
        <FormInput label="Nombre del producto" required icon="cube-outline"
          value={newProduct.name} onChangeText={(t) => setNewProduct((p) => ({ ...p, name: t }))} autoFocus />
        <View style={styles.formRow}>
          <FormInput label="Precio compra" icon="cash" keyboardType="decimal-pad"
            value={newProduct.cost_price} onChangeText={(t) => setNewProduct((p) => ({ ...p, cost_price: t }))} style={{ flex: 1 }} />
          {isContainerUnit(newProduct.sale_unit) ? (
            <FormInput label="Precio pieza" icon="tag" keyboardType="decimal-pad"
              value={newProduct.price} onChangeText={(t) => setNewProduct((p) => ({ ...p, price: t }))} style={{ flex: 1 }} />
          ) : (
            <FormInput label={newProduct.sale_unit === "weight" ? "Precio por kg" : "Precio venta"} icon="tag" keyboardType="decimal-pad"
              value={newProduct.price} onChangeText={(t) => setNewProduct((p) => ({ ...p, price: t }))} style={{ flex: 1 }} />
          )}
        </View>
        {isContainerUnit(newProduct.sale_unit) && (
          <FormInput label={unitLabels(newProduct.sale_unit)?.priceContainer || "Precio venta caja"} icon="package-variant" keyboardType="decimal-pad"
            value={newProduct.box_price} onChangeText={(t) => setNewProduct((p) => ({ ...p, box_price: t }))} />
        )}
        <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, fontWeight: "600", marginBottom: 6, marginLeft: 2 }}>Unidad de venta</Text>
        <SegmentedButtons value={newProduct.sale_unit} onValueChange={(v) => setNewProduct((p) => ({ ...p, sale_unit: v }))}
          buttons={SALE_UNITS} style={{ marginBottom: 16 }} />
        {isContainerUnit(newProduct.sale_unit) ? (
          <View style={styles.formRow}>
            <FormInput label={unitLabels(newProduct.sale_unit)?.pzasPer || "Piezas por caja"} icon="grid" keyboardType="number-pad"
              value={newProduct.box_qty} onChangeText={(t) => setNewProduct((p) => ({ ...p, box_qty: t }))} style={{ flex: 1 }} />
            <FormInput label={unitLabels(newProduct.sale_unit)?.stockContainer || "Stock inicial (cajas)"} icon="archive" keyboardType="number-pad"
              value={newProduct.stock} onChangeText={(t) => setNewProduct((p) => ({ ...p, stock: t }))} style={{ flex: 1 }} />
          </View>
        ) : (
          <FormInput label={newProduct.sale_unit === "weight" ? "Stock inicial (kg)" : "Stock inicial"} icon="archive" keyboardType="number-pad"
            value={newProduct.stock} onChangeText={(t) => setNewProduct((p) => ({ ...p, stock: t }))} />
        )}
        <View style={styles.formActions}>
          <Button mode="outlined" onPress={closeNewForm}
            style={{ flex: 1, borderRadius: 12 }} contentStyle={{ height: 50 }}>
            Cancelar
          </Button>
          <RaisedButton onPress={handleCreateProduct} style={{ flex: 1 }}>
            Guardar producto
          </RaisedButton>
        </View>
      </ModalSheet>

      <ModalSheet visible={showStockModal} onDismiss={() => setShowStockModal(false)}>
        <SheetHeader title="Aumentar Stock" onClose={() => setShowStockModal(false)} />
        <Text style={{ color: theme.colors.onSurface, marginBottom: 12, fontWeight: "600" }}>{product?.name}</Text>
        <FormInput label={isContainerUnit(product?.sale_unit) ? (unitLabels(product.sale_unit)?.quantity || "Cantidad (cajas)") : "Cantidad"} value={stockQty} onChangeText={setStockQty} keyboardType="number-pad" autoFocus />
        <FormInput label="Costo total del stock" value={stockCost} onChangeText={setStockCost} keyboardType="decimal-pad" />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Text style={{ color: theme.colors.onSurface, fontSize: 14, flex: 1, paddingRight: 8 }}>
            Descontar de la caja (egreso)
          </Text>
          <Switch value={stockRegisterExpense} onValueChange={setStockRegisterExpense} color={theme.colors.primary} />
        </View>
        <RaisedButton onPress={handleAddStock} style={{ marginBottom: 8 }}>
          Aumentar Stock
        </RaisedButton>
      </ModalSheet>

      <ModalSheet visible={showCostConfirm} onDismiss={() => setShowCostConfirm(false)}>
        <SheetHeader title="Precio de costo" onClose={() => setShowCostConfirm(false)} />
        {costConfirm && (
          <>
            <Text style={{ color: theme.colors.onSurface, fontSize: 15, lineHeight: 22, marginBottom: 16 }}>
              El precio de costo {costConfirm.isBox ? (unitLabels(product?.sale_unit)?.per || "por caja") : "unitario"}{" "}
              <Text style={{ fontWeight: "800", color: costConfirm.direction === "subio" ? "#dc2626" : "#059669" }}>
                {costConfirm.direction === "subio" ? "subió" : "bajó"}
              </Text>{" "}
              de <Text style={{ fontWeight: "700" }}>${costConfirm.oldCost.toFixed(2)}</Text> a{" "}
              <Text style={{ fontWeight: "700" }}>${costConfirm.newCost.toFixed(2)}</Text>. ¿Quieres actualizarlo?
            </Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Button mode="outlined" onPress={handleCostConfirmNo} style={{ flex: 1, borderRadius: 12 }} contentStyle={{ height: 50 }}>
                No, solo stock
              </Button>
              <RaisedButton onPress={handleCostConfirmYes} style={{ flex: 1 }}>
                Sí, actualizar
              </RaisedButton>
            </View>
          </>
        )}
      </ModalSheet>

      <Snackbar visible={snackbar.visible} onDismiss={() => setSnackbar({ visible: false, text: "" })}
        duration={3000} style={{ marginBottom: 70 }}>
        {snackbar.text}
      </Snackbar>
    </View>
  );
};

const FRAME_W = SCREEN_WIDTH * 0.8;
const FRAME_H = SCREEN_WIDTH * 0.42;

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  cameraContainer: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  overlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    marginBottom: 20,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { height: 4 },
    elevation: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  scanFrame: {
    width: FRAME_W,
    height: FRAME_H,
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  scanBackdrop: {
    position: "absolute",
    top: -10,
    left: -10,
    right: -10,
    bottom: -10,
    borderRadius: 22,
  },
  corner: {
    position: "absolute",
    width: 30,
    height: 30,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 12 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 12 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 12 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 12 },
  scanHint: { color: "#f1f5f9", fontSize: 14, fontWeight: "600" },
  formRow: { flexDirection: "row", gap: 12 },
  formActions: { flexDirection: "row", gap: 12, marginTop: 4, marginBottom: 8 },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  productHeader: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  productIcon: {
    width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", marginRight: 12,
    shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { height: 3 }, elevation: 4,
  },
  infoRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(100,116,139,0.18)",
  },
});

export default ScannerScreen;
