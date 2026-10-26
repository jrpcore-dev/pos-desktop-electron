// Lado del carrito en la terminal, guardado en esta PC (cada caja según cómo
// esté acomodada: monitor, cajón, escáner). "right" por defecto.
import { useEffect, useState } from "react";

const KEY = "cartSide";
const EVENT = "cart-side-change";

export const getCartSide = () => {
  try {
    return localStorage.getItem(KEY) === "left" ? "left" : "right";
  } catch {
    return "right";
  }
};

export const setCartSide = (side) => {
  const value = side === "left" ? "left" : "right";
  try {
    localStorage.setItem(KEY, value);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
};

export const useCartSide = () => {
  const [side, setSide] = useState(getCartSide);
  useEffect(() => {
    const onChange = () => setSide(getCartSide());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return side;
};
