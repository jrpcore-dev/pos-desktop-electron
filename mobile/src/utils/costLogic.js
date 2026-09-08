export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export const computeCostConfirm = ({ enteredCost, quantity, saleUnit, boxQty, costPrice }) => {
  const cost = parseFloat(enteredCost);
  if (!cost || cost <= 0 || !quantity || quantity <= 0) return null;
  const isBox = (saleUnit === "box" || saleUnit === "package") && boxQty > 0;
  const expected = (costPrice || 0) * quantity;
  const diff = cost - expected;
  if (Math.abs(diff) < 1) return null;
  const newCost = round2(cost / quantity);
  return { oldCost: costPrice || 0, newCost, direction: diff > 0 ? "subio" : "bajo", isBox, saleUnit };
};
