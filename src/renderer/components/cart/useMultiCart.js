import { useCallback, useRef, useState } from "react";

let uid = 0;

const createCart = (folio) => ({
  id: ++uid,
  folio,
  items: [],
  paymentMethod: "cash",
  notes: "",
});

/**
 * Gestión atómica y ligera de múltiples carritos (pestañas).
 *
 * - Cada carrito guarda su propio `items`, `paymentMethod`, `folio` y `notas` de
 *   forma independiente, de modo que las pestañas inactivas no pierden datos.
 * - `cart` / `setCart` y `paymentMethod` / `setPaymentMethod` exponen un proxy
 *   hacia el carrito activo, manteniendo intacta la lógica de negocio existente
 *   (escaneo, teclas F1-F11, cobro) que opera sobre la venta en curso.
 * - Solo se re-renderiza el nodo modificado: cada actualización crea un array
 *   nuevo con un único carrito cambiado (el activo), sin propagar cambios al
 *   resto del árbol.
 */
export const useMultiCart = () => {
  const folioRef = useRef(1);
  const [carts, setCarts] = useState(() => [createCart(folioRef.current)]);
  const [activeIndex, setActiveIndex] = useState(0);

  const activeCart = carts[activeIndex] || carts[0];

  const cart = activeCart.items;
  const paymentMethod = activeCart.paymentMethod;

  const setCart = useCallback(
    (value) => {
      setCarts((prev) =>
        prev.map((c, i) =>
          i === activeIndex
            ? {
                ...c,
                items:
                  typeof value === "function" ? value(c.items) : value,
              }
            : c,
        ),
      );
    },
    [activeIndex],
  );

  const setPaymentMethod = useCallback(
    (value) => {
      setCarts((prev) =>
        prev.map((c, i) =>
          i === activeIndex
            ? {
                ...c,
                paymentMethod:
                  typeof value === "function" ? value(c.paymentMethod) : value,
              }
            : c,
        ),
      );
    },
    [activeIndex],
  );

  const newSale = useCallback(() => {
    folioRef.current += 1;
    const newCart = createCart(folioRef.current);
    setCarts((prev) => [...prev, newCart]);
    setActiveIndex(carts.length);
  }, [carts.length]);

  const switchCart = useCallback((index) => {
    setActiveIndex(index);
  }, []);

  const cancelCart = useCallback(
    (index) => {
      if (carts.length <= 1) return;
      const next = carts.filter((_, i) => i !== index);
      const newActive =
        index === activeIndex
          ? Math.max(0, index - 1)
          : index < activeIndex
            ? activeIndex - 1
            : activeIndex;
      setCarts(next);
      setActiveIndex(newActive);
    },
    [carts, activeIndex],
  );

  return {
    carts,
    activeIndex,
    activeCart,
    cart,
    setCart,
    paymentMethod,
    setPaymentMethod,
    newSale,
    switchCart,
    cancelCart,
  };
};
