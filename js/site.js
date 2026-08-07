(() => {
  "use strict";

  const CART_STORAGE_KEY = "gardenShedClayCart";

  function loadCart() {
    try {
      const savedCart = localStorage.getItem(CART_STORAGE_KEY);

      if (!savedCart) {
        return [];
      }

      const parsedCart = JSON.parse(savedCart);

      return Array.isArray(parsedCart) ? parsedCart : [];
    } catch (error) {
      console.error("Unable to load cart:", error);
      return [];
    }
  }

  function getCartQuantity(cart) {
    return cart.reduce((total, item) => {
      return total + Number(item.quantity || 0);
    }, 0);
  }

  function updateCartCount() {
    const countElement =
      document.getElementById("site-cart-count");

    if (!countElement) {
      return;
    }

    const cart = loadCart();
    const quantity = getCartQuantity(cart);

    countElement.textContent = `(${quantity})`;
  }

  document.addEventListener(
    "DOMContentLoaded",
    updateCartCount
  );

  window.addEventListener(
    "storage",
    updateCartCount
  );

  window.addEventListener(
    "cart-updated",
    updateCartCount
  );
})();
