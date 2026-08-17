(() => {
  "use strict";

  const CART_STORAGE_KEY = "gardenShedClayCart";

const elements = {
  cartItems: document.getElementById("cart-items"),
  cartSubtotal: document.getElementById("cart-subtotal"),
  cartCount: document.getElementById("cart-count"),
  freeShippingMessage:
    document.getElementById("free-shipping-message"),
  checkoutButton: document.getElementById("checkout-button")
};
  
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

  function saveCart(cart) {
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify(cart)
    );
  }

  function formatPrice(price, currency = "USD") {
    const amount = Number(price);

    if (!Number.isFinite(amount)) {
      return "$0.00";
    }

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(amount);
  }

  function getCartQuantity(cart) {
    return cart.reduce((total, item) => {
      return total + Number(item.quantity || 0);
    }, 0);
  }

  function getCartSubtotal(cart) {
    return cart.reduce((total, item) => {
      const price = Number(item.price || 0);
      const quantity = Number(item.quantity || 0);

      return total + price * quantity;
    }, 0);
  }

function updateFreeShippingMessage(subtotal) {
  if (!elements.freeShippingMessage) {
    return;
  }

  const FREE_SHIPPING_THRESHOLD =
    150;

  const amountRemaining =
    FREE_SHIPPING_THRESHOLD - subtotal;

  if (amountRemaining <= 0) {
    elements.freeShippingMessage.textContent =
      "You qualify for free shipping!";
    return;
  }

  elements.freeShippingMessage.textContent =
    `You’re ${formatPrice(amountRemaining)} away from free shipping.`;
}
  
  function updateCartCount(cart) {
    if (!elements.cartCount) {
      return;
    }

    elements.cartCount.textContent =
      `(${getCartQuantity(cart)})`;
  }

  function createQuantityControls(item, cart) {
    const controls = document.createElement("div");
    controls.className = "cart-quantity-controls";

    const decreaseButton = document.createElement("button");
    decreaseButton.type = "button";
    decreaseButton.textContent = "−";
    decreaseButton.setAttribute(
      "aria-label",
      `Decrease quantity of ${item.name}`
    );

    const quantity = document.createElement("span");
    quantity.className = "cart-item-quantity";
    quantity.textContent = String(item.quantity);

    const increaseButton = document.createElement("button");
    increaseButton.type = "button";
    increaseButton.textContent = "+";
    increaseButton.setAttribute(
      "aria-label",
      `Increase quantity of ${item.name}`
    );

    decreaseButton.addEventListener("click", () => {
      changeQuantity(item.id, -1, cart);
    });

    increaseButton.addEventListener("click", () => {
      changeQuantity(item.id, 1, cart);
    });

    controls.append(
      decreaseButton,
      quantity,
      increaseButton
    );

    return controls;
  }

  function createCartItem(item, cart) {
    const article = document.createElement("article");
    article.className = "cart-item";

    const image = document.createElement("img");
    image.className = "cart-item-image";
    image.src = item.image || "/logo.png";
    image.alt = item.name || "Garden Shed Clay pottery";

    image.addEventListener(
      "error",
      () => {
        image.src = "/logo.png";
      },
      { once: true }
    );

    const details = document.createElement("div");
    details.className = "cart-item-details";

    const name = document.createElement("h2");
    name.className = "cart-item-name";
    name.textContent = item.name || "Untitled piece";

    const price = document.createElement("p");
    price.className = "cart-item-price";
    price.textContent = formatPrice(
      item.price,
      item.currency || "USD"
    );

    const controls = createQuantityControls(item, cart);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "cart-remove-button";
    removeButton.textContent = "Remove";

    removeButton.addEventListener("click", () => {
      removeItem(item.id, cart);
    });

    details.append(
      name,
      price,
      controls,
      removeButton
    );

    article.append(image, details);

    return article;
  }

  function changeQuantity(itemId, change, cart) {
    const item = cart.find(
      (cartItem) => cartItem.id === itemId
    );

    if (!item) {
      return;
    }

    item.quantity =
      Number(item.quantity || 0) + change;

    if (item.quantity <= 0) {
      removeItem(itemId, cart);
      return;
    }

    saveCart(cart);
    renderCart(cart);
  }

  function removeItem(itemId, cart) {
    const updatedCart = cart.filter(
      (item) => item.id !== itemId
    );

    saveCart(updatedCart);
    renderCart(updatedCart);
  }

  function renderEmptyCart() {
    elements.cartItems.innerHTML = "";

    const message = document.createElement("p");
    message.textContent = "Your cart is currently empty.";

    const shopLink = document.createElement("a");
    shopLink.href = "/shop.html";
    shopLink.className = "button";
    shopLink.textContent = "Browse the Collection";

    elements.cartItems.append(message, shopLink);

    elements.cartSubtotal.textContent = "$0.00";

updateFreeShippingMessage(0);
    
    elements.checkoutButton.disabled = true;
  }

  function renderCart(cart) {
    updateCartCount(cart);

    if (!cart.length) {
      renderEmptyCart();
      return;
    }

    elements.cartItems.innerHTML = "";

    cart.forEach((item) => {
      elements.cartItems.appendChild(
        createCartItem(item, cart)
      );
    });

    const subtotal = getCartSubtotal(cart);

    elements.cartSubtotal.textContent =
      formatPrice(subtotal);

    updateFreeShippingMessage(subtotal);
    
    elements.checkoutButton.disabled = false;
    elements.checkoutButton.textContent =
      "Proceed to Checkout";
  }

  async function beginCheckout() {
    const cart = loadCart();

    if (!cart.length) {
      return;
    }

    const invalidItem = cart.find((item) => {
      return (
        !item.stripePriceId ||
        !Number.isFinite(Number(item.quantity)) ||
        Number(item.quantity) < 1
      );
    });

    if (invalidItem) {
      console.error(
        "Cart item is missing valid Stripe checkout information:",
        invalidItem
      );

      alert(
        "One of the items in your cart cannot be checked out yet."
      );

      return;
    }

    elements.checkoutButton.disabled = true;
    elements.checkoutButton.textContent =
      "Preparing checkout...";

    try {
      const response = await fetch(
        "https://gsc-checkout.onrender.com/api/create-checkout-session",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            items: cart.map((item) => {
              return {
                id: item.id,
                name: item.name,
                stripePriceId: item.stripePriceId,
                quantity: Number(item.quantity)
              };
            })
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to start checkout."
        );
      }

      if (!data.url) {
        throw new Error(
          "Stripe did not return a checkout URL."
        );
      }

      window.location.href = data.url;
    } catch (error) {
      console.error("Checkout error:", error);

      alert(
        "Checkout could not be started. Please try again."
      );

      elements.checkoutButton.disabled = false;
      elements.checkoutButton.textContent =
        "Proceed to Checkout";
    }
  }

  function initializeCart() {
    const cart = loadCart();

    renderCart(cart);

    if (elements.checkoutButton) {
      elements.checkoutButton.addEventListener(
        "click",
        beginCheckout
      );
    }
  }

  document.addEventListener(
    "DOMContentLoaded",
    initializeCart
  );
})();
