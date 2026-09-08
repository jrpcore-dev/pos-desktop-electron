import React, { useState, useCallback } from "react";
import { View, FlatList, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { Text, TextInput, Button, Chip, ActivityIndicator, Snackbar, Searchbar, SegmentedButtons, useTheme, IconButton, Switch } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { searchProducts, getProductByBarcode, addStock, createProduct } from "../services/api";
import { computeCostConfirm } from "../utils/costLogic";
import ModalSheet from "../components/ModalSheet";
import FormInput, { FormSection } from "../components/FormInput";
import PressableCard from "../components/PressableCard";
import RaisedButton from "../components/RaisedButton";
import ScreenHeader from "../components/ScreenHeader";
import { isContainerUnit, unitLabels } from "../utils/unitLabels";

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

const ManualScreen = ({ cashier }) => {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showStockModal, setShowStockModal] = useState(false);
  const [stockQty, setStockQty] = useState("");
  const [stockCost, setStockCost] = useState("");
  const [stockRegisterExpense, setStockRegisterExpense] = useState(false);
  const [showCostConfirm, setShowCostConfirm] = useState(false);
  const [costConfirm, setCostConfirm] = useState(null);
  const [snackbar, setSnackbar] = useState({ visible: false, text: "" });

  const [newProduct, setNewProduct] = useState({ ...EMPTY_FORM });

  const showMsg = (text) => setSnackbar({ visible: true, text });

  const doSearch = useCallback(async (query) => {
    if (!query || query.trim().length < 1) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await searchProducts(query);
      setResults(data.products || []);
    } catch (err) {
      showMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = (query) => {
    setSearchQuery(query);
    doSearch(query);
  };

  const handleBarcodeSearch = async () => {
    const code = manualCode.trim();
    if (!code) return;
    setLoading(true);
    try {
      const data = await getProductByBarcode(code);
      setProduct(data.product);
      setShowDetail(true);
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
  };

  const handleProductTap = (p) => {
    setProduct(p);
    setShowDetail(true);
  };

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
    const confirm = computeCostConfirm({
      enteredCost: stockCost,
      quantity: qty,
      saleUnit: product?.sale_unit,
      boxQty: product?.box_qty,
      costPrice: product?.cost_price,
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
        barcode: newProduct.barcode || null,
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
      setManualCode("");
      doSearch(searchQuery);
    } catch (err) {
      showMsg(err.message);
    }
  };

  const renderProduct = ({ item }) => {
    const isContainer = isContainerUnit(item.sale_unit);
    const priceText = `$${(isContainer && item.box_qty > 0 && (item.stock || 0) >= item.box_qty
      ? (item.box_price || 0)
      : (item.price || 0)).toFixed(2)}`;
    const stockText = isContainer && item.box_qty > 0 && (item.stock || 0) >= item.box_qty
      ? `${Math.floor((item.stock || 0) / item.box_qty)} ${unitLabels(item.sale_unit)?.plural || "cajas"} (${item.stock || 0} pz)`
      : `${item.stock || 0} ${isContainer ? "pz" : UNIT_LABELS[item.sale_unit] || "pz"}`;
    const isLow = (item.stock || 0) <= 5;
    return (
      <PressableCard
        onPress={() => handleProductTap(item)}
        style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}
        pressedStyle={styles.cardPressed}
      >
        <View style={[styles.cardIcon, { backgroundColor: theme.colors.primaryContainer, shadowColor: theme.colors.primary }]}>
          <MaterialCommunityIcons name="package-variant-closed" size={22} color={theme.colors.primary} />
        </View>
        <View style={styles.cardInfo}>
          <Text variant="titleSmall" numberOfLines={1} style={{ fontWeight: "600", color: theme.colors.onSurface }}>
            {item.name}
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 }}>
            {item.barcode || "Sin código"}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={{ fontWeight: "800", color: theme.colors.primary }}>{priceText}</Text>
          <Chip compact mode="flat" textStyle={{ fontSize: 11 }}
            style={{ marginTop: 6, backgroundColor: isLow ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)" }}>
            {stockText}
          </Chip>
        </View>
      </PressableCard>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScreenHeader title="Inventario" subtitle="Busca y registra productos" user={cashier} />
      <View style={styles.searchSection}>
        <Searchbar
          placeholder="Buscar productos..."
          value={searchQuery}
          onChangeText={handleSearch}
          style={{ backgroundColor: theme.colors.surfaceVariant, borderRadius: 14 }}
          inputStyle={{ fontSize: 15 }}
        />
        <View style={styles.codeRow}>
          <TextInput
            mode="outlined"
            placeholder="Código manual"
            placeholderTextColor={theme.colors.onSurfaceVariant}
            textColor={theme.colors.onSurface}
            value={manualCode}
            onChangeText={setManualCode}
            style={{ flex: 1, backgroundColor: theme.colors.surfaceVariant }}
            outlineColor={theme.colors.outline}
            activeOutlineColor={theme.colors.primary}
            outlineStyle={{ borderRadius: 14 }}
          />
          <RaisedButton onPress={handleBarcodeSearch} loading={loading}
            style={{ borderRadius: 14, marginLeft: 8 }} contentStyle={{ height: 52 }}>
            Buscar
          </RaisedButton>
        </View>
      </View>

      {loading && !showDetail && (
        <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
      )}

      {!loading && results.length > 0 && (
        <FlatList data={results} renderItem={renderProduct} keyExtractor={(item) => String(item.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent} style={styles.list} />
      )}

      {!loading && results.length === 0 && searchQuery.trim().length > 0 && (
        <View style={styles.empty}>
          <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>No se encontraron productos</Text>
          <Button mode="outlined" icon="plus" onPress={() => { setNewProduct({ ...EMPTY_FORM, name: searchQuery }); setShowNewForm(true); }}>
            Registrar "{searchQuery}"
          </Button>
        </View>
      )}

      {!loading && results.length === 0 && searchQuery.trim().length === 0 && (
        <View style={styles.empty}>
          <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: "center", lineHeight: 22 }}>
            Busca productos por nombre o código{"\n"}o ingresa un código manualmente
          </Text>
        </View>
      )}

      <ModalSheet visible={showDetail} onDismiss={() => setShowDetail(false)}>
        <SheetHeader title="Detalle del producto" onClose={() => setShowDetail(false)} />
        {product && (
          <>
            <View style={styles.productHeader}>
              <View style={[styles.cardIcon, { backgroundColor: theme.colors.primaryContainer }]}>
                <MaterialCommunityIcons name="package-variant-closed" size={24} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="titleLarge" numberOfLines={2} style={{ fontWeight: "700", color: theme.colors.onSurface, lineHeight: 26 }}>
                  {product.name}
                </Text>
                {product.barcode && <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 }}>Código: {product.barcode}</Text>}
              </View>
            </View>
            <View style={styles.infoRow}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>Precio venta:</Text>
              <Text style={{ fontWeight: "600", color: theme.colors.onSurface }}>
                ${(isContainerUnit(product.sale_unit) && product.box_qty > 0 && (product.stock || 0) >= product.box_qty
                  ? (product.box_price || 0)
                  : (product.price || 0)).toFixed(2)}
              </Text>
            </View>
            {isContainerUnit(product.sale_unit) && product.box_qty > 0 && (product.stock || 0) >= product.box_qty && (
              <View style={styles.infoRow}>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Precio pieza:</Text>
                <Text style={{ color: theme.colors.onSurface }}>${(product.price || 0).toFixed(2)}</Text>
              </View>
            )}
            {product.cost_price > 0 && (
              <View style={styles.infoRow}>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Costo:</Text>
                <Text style={{ color: theme.colors.onSurface }}>${(product.cost_price || 0).toFixed(2)}</Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>Stock:</Text>
              <Chip compact mode="flat" textStyle={{ fontWeight: "700" }}
                style={{ backgroundColor: (product.stock || 0) > 5 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)" }}>
                {isContainerUnit(product.sale_unit) && product.box_qty > 0 && (product.stock || 0) >= product.box_qty
                  ? `${Math.floor((product.stock || 0) / product.box_qty)} ${unitLabels(product.sale_unit)?.plural || "cajas"} (${product.stock || 0} pz)`
                  : `${product.stock || 0} ${isContainerUnit(product.sale_unit) ? "pz" : UNIT_LABELS[product.sale_unit] || "pz"}`}
              </Chip>
            </View>
            {product.sale_unit && (
              <View style={styles.infoRow}>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Venta por:</Text>
                <Text style={{ color: theme.colors.onSurface }}>
                  {SALE_UNITS.find((u) => u.value === product.sale_unit)?.label || product.sale_unit}
                </Text>
              </View>
            )}
            {isContainerUnit(product.sale_unit) && product.box_qty > 0 && (
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
            <View style={{ flexDirection: "row", gap: 12, marginTop: 20, marginBottom: 8 }}>
              <RaisedButton icon="plus" onPress={() => { setStockRegisterExpense(false); setShowStockModal(true); }} style={{ flex: 1 }}>+ Stock</RaisedButton>
              <Button mode="outlined" onPress={() => setShowDetail(false)} style={{ flex: 1 }}>Cerrar</Button>
            </View>
          </>
        )}
      </ModalSheet>

      <ModalSheet visible={showNewForm} onDismiss={() => setShowNewForm(false)}>
        <SheetHeader title="Nuevo producto" onClose={() => setShowNewForm(false)} />
        <FormSection title="Información del producto" subtitle="Completa los datos principales." />
        <FormInput label="Nombre del producto" required icon="cube-outline"
          value={newProduct.name} onChangeText={(t) => setNewProduct((p) => ({ ...p, name: t }))} autoFocus />
        <FormInput label="Código" icon="barcode"
          value={newProduct.barcode} onChangeText={(t) => setNewProduct((p) => ({ ...p, barcode: t }))} />
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
        <SegmentedButtons
          value={newProduct.sale_unit}
          onValueChange={(v) => setNewProduct((p) => ({ ...p, sale_unit: v }))}
          buttons={SALE_UNITS}
          style={{ marginBottom: 16 }}
        />
        {isContainerUnit(newProduct.sale_unit) ? (
          <View style={styles.formRow}>
            <FormInput label={unitLabels(newProduct.sale_unit)?.pzasPer || "Piezas por caja"} icon="grid" keyboardType="number-pad"
              value={newProduct.box_qty} onChangeText={(t) => setNewProduct((p) => ({ ...p, box_qty: t }))} style={{ flex: 1 }} />
            <FormInput label={unitLabels(newProduct.sale_unit)?.stockContainer || "Stock inicial (cajas)"} icon="archive" keyboardType="number-pad"
              value={newProduct.stock} onChangeText={(t) => setNewProduct((p) => ({ ...p, stock: t }))} style={{ flex: 1 }} />
          </View>
        ) : (
          <FormInput
            label={newProduct.sale_unit === "weight" ? "Stock inicial (kg)" : "Stock inicial"} icon="archive" keyboardType="number-pad"
            value={newProduct.stock} onChangeText={(t) => setNewProduct((p) => ({ ...p, stock: t }))} />
        )}
        <View style={styles.formActions}>
          <Button mode="outlined" onPress={() => setShowNewForm(false)}
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
        <Text style={{ color: theme.colors.onSurface, marginBottom: 12, fontWeight: "600" }}>
          {product?.name}
        </Text>
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
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchSection: { padding: 16, gap: 12 },
  codeRow: { flexDirection: "row", alignItems: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#2563eb",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { height: 6 },
    elevation: 6,
  },
  cardPressed: { opacity: 0.9 },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { height: 3 },
    elevation: 4,
  },
  cardInfo: { flex: 1, marginLeft: 12, marginRight: 8 },
  cardRight: { alignItems: "flex-end" },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 16, flexGrow: 1 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  formRow: { flexDirection: "row", gap: 12 },
  formActions: { flexDirection: "row", gap: 12, marginTop: 4, marginBottom: 8 },
  productHeader: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  infoRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(100,116,139,0.18)",
  },
});

export default ManualScreen;
