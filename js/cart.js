(() => {
  "use strict";

  const CART_STORAGE_KEY =
    "gardenShedClayCart";

  const CATALOG_URL =
    "/products.json";

  let catalogProducts = [];

  const elements = {
    cartItems:
      document.getElementById("cart-items"),

    cartSubtotal:
      document.getElementById("cart-subtotal"),

    cartCount:
      document.getElementById("cart-count"),

 freeShippingMessage:
  document.getElementById(
    "free-shipping-message"
  ),

freeShippingEmail:
  document.getElementById(
    "free-shipping-email"
  ),

freeShippingCode:
  document.getElementById(
    "free-shipping-code"
  ),

applyFreeShippingButton:
  document.getElementById(
    "apply-free-shipping-button"
  ),

freeShippingCodeStatus:
  document.getElementById(
    "free-shipping-code-status"
  ),

checkoutButton:
  document.getElementById(
    "checkout-button"
  )
};

let appliedFreeShippingEmail =
  "";

let appliedFreeShippingCode =
  "";
  
  function loadCart() {
    try {
      const savedCart =
        localStorage.getItem(
          CART_STORAGE_KEY
        );

      if (!savedCart) {
        return [];
      }

      const parsedCart =
        JSON.parse(savedCart);

      return Array.isArray(parsedCart)
        ? parsedCart
        : [];
    } catch (error) {
      console.error(
        "Unable to load cart:",
        error
      );

      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify(cart)
    );
  }

  function normalizeCatalog(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (
      payload &&
      Array.isArray(payload.products)
    ) {
      return payload.products;
    }

    return [];
  }

  async function loadCatalog() {
    try {
      const response =
        await fetch(
          CATALOG_URL,
          {
            cache: "no-store"
          }
        );

      if (!response.ok) {
        throw new Error(
          `Catalog request failed with status ${response.status}.`
        );
      }

      const payload =
        await response.json();

      catalogProducts =
        normalizeCatalog(payload);
    } catch (error) {
      console.error(
        "Unable to load current product inventory:",
        error
      );

      catalogProducts = [];
    }
  }

  function findCatalogProduct(item) {
    return catalogProducts.find(
      (product) => {
        if (!product) {
          return false;
        }

        return (
          product.id === item.id ||
          product.slug === item.id ||
          product.id === item.slug ||
          product.slug === item.slug ||
          (
            item.stripePriceId &&
            product.stripePriceId ===
              item.stripePriceId
          )
        );
      }
    );
  }

  function formatPrice(
    price,
    currency = "USD"
  ) {
    const amount =
      Number(price);

    if (!Number.isFinite(amount)) {
      return "$0.00";
    }

    return new Intl.NumberFormat(
      "en-US",
      {
        style: "currency",
        currency
      }
    ).format(amount);
  }

  function getCartQuantity(cart) {
    return cart.reduce(
      (total, item) => {
        return (
          total +
          Number(item.quantity || 0)
        );
      },
      0
    );
  }

  function getCartSubtotal(cart) {
    return cart.reduce(
      (total, item) => {
        const price =
          Number(item.price || 0);

        const quantity =
          Number(item.quantity || 0);

        return (
          total +
          price * quantity
        );
      },
      0
    );
  }

  function updateFreeShippingMessage(
    subtotal
  ) {
    if (
      !elements.freeShippingMessage
    ) {
      return;
    }

    const FREE_SHIPPING_THRESHOLD =
      150;

    const amountRemaining =
      FREE_SHIPPING_THRESHOLD -
      subtotal;

    if (amountRemaining <= 0) {
      elements
        .freeShippingMessage
        .textContent =
        "You qualify for free shipping!";

      return;
    }

    elements
      .freeShippingMessage
      .textContent =
      `You’re ${formatPrice(
        amountRemaining
      )} away from free shipping.`;
  }

async function applyFreeShippingCode() {
  if (
    !elements.freeShippingEmail ||
    !elements.freeShippingCode ||
    !elements.freeShippingCodeStatus ||
    !elements.applyFreeShippingButton
  ) {
    return;
  }

  const email =
    elements.freeShippingEmail.value
      .trim()
      .toLowerCase();

  const code =
    elements.freeShippingCode.value
      .trim()
      .toUpperCase();

  if (!email || !code) {
    elements.freeShippingCodeStatus.textContent =
      "Enter the email address you subscribed with and your free shipping code.";

    return;
  }

  elements.applyFreeShippingButton.disabled =
    true;

  elements.applyFreeShippingButton.textContent =
    "Checking Code...";

  elements.freeShippingCodeStatus.textContent =
    "Checking your free shipping code...";

  try {
    const response =
      await fetch(
        "https://gsc-checkout.onrender.com/api/validate-free-shipping-code",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              email,
              code
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        "Unable to validate free shipping code."
      );
    }

    appliedFreeShippingEmail =
      email;

    appliedFreeShippingCode =
      code;

    elements.freeShippingCodeStatus.textContent =
      "Free shipping code applied! Your shipping will be $0 at checkout.";

    elements.applyFreeShippingButton.textContent =
      "Free Shipping Applied";
  } catch (error) {
    appliedFreeShippingEmail =
      "";

    appliedFreeShippingCode =
      "";

    console.error(
      "Free shipping code validation error:",
      error
    );

    elements.freeShippingCodeStatus.textContent =
      error.message ||
      "That free shipping code could not be applied.";

    elements.applyFreeShippingButton.textContent =
      "Apply Free Shipping";
  } finally {
    elements.applyFreeShippingButton.disabled =
      false;
  }
}  
  function updateCartCount(cart) {
    if (!elements.cartCount) {
      return;
    }

    elements.cartCount.textContent =
      `(${getCartQuantity(cart)})`;
  }

  function createQuantityControls(
    item,
    cart
  ) {
    const controls =
      document.createElement("div");

    controls.className =
      "cart-quantity-controls";

    const decreaseButton =
      document.createElement("button");

    decreaseButton.type =
      "button";

    decreaseButton.textContent =
      "−";

    decreaseButton.setAttribute(
      "aria-label",
      `Decrease quantity of ${item.name}`
    );

    const quantity =
      document.createElement("span");

    quantity.className =
      "cart-item-quantity";

    quantity.textContent =
      String(item.quantity);

    const increaseButton =
      document.createElement("button");

    increaseButton.type =
      "button";

    increaseButton.textContent =
      "+";

    increaseButton.setAttribute(
      "aria-label",
      `Increase quantity of ${item.name}`
    );

    decreaseButton.addEventListener(
      "click",
      () => {
        changeQuantity(
          item.id,
          -1,
          cart
        );
      }
    );

    increaseButton.addEventListener(
      "click",
      () => {
        changeQuantity(
          item.id,
          1,
          cart
        );
      }
    );

    controls.append(
      decreaseButton,
      quantity,
      increaseButton
    );

    return controls;
  }

  function createMadeToOrderNotice(
    item
  ) {
    const product =
      findCatalogProduct(item);

    if (!product) {
      return null;
    }

    const inventory =
      Math.max(
        0,
        Number(
          product.inventory ?? 0
        )
      );

    const quantity =
      Math.max(
        0,
        Number(
          item.quantity || 0
        )
      );

    if (quantity <= inventory) {
      return null;
    }

    const readyQuantity =
      Math.min(
        quantity,
        inventory
      );

    const madeToOrderQuantity =
      quantity - readyQuantity;

    const wrapper =
      document.createElement("div");

    wrapper.className =
      "cart-made-to-order";

    const status =
      document.createElement("p");

    status.className =
      "cart-made-to-order-status";

    if (readyQuantity > 0) {
      status.textContent =
        `${readyQuantity} ready to ship · ${madeToOrderQuantity} Made to Order`;
    } else {
      status.textContent =
        `${madeToOrderQuantity} Made to Order`;
    }

    const note =
      document.createElement("p");

    note.className =
      "cart-made-to-order-note";

    note.textContent =
      "Additional pieces will be made especially for you. We’ll contact you with an estimated ship date after your order is placed.";

    wrapper.append(
      status,
      note
    );

    return wrapper;
  }

  function createCartItem(
    item,
    cart
  ) {
    const article =
      document.createElement(
        "article"
      );

    article.className =
      "cart-item";

    const image =
      document.createElement("img");

    image.className =
      "cart-item-image";

    image.src =
      item.image ||
      "/logo.png";

    image.alt =
      item.name ||
      "Garden Shed Clay pottery";

    image.addEventListener(
      "error",
      () => {
        image.src =
          "/logo.png";
      },
      {
        once: true
      }
    );

    const details =
      document.createElement("div");

    details.className =
      "cart-item-details";

    const name =
      document.createElement("h2");

    name.className =
      "cart-item-name";

    name.textContent =
      item.name ||
      "Untitled piece";

    const price =
      document.createElement("p");

    price.className =
      "cart-item-price";

    price.textContent =
      formatPrice(
        item.price,
        item.currency ||
          "USD"
      );

    const controls =
      createQuantityControls(
        item,
        cart
      );

    const madeToOrderNotice =
      createMadeToOrderNotice(
        item
      );

    const removeButton =
      document.createElement(
        "button"
      );

    removeButton.type =
      "button";

    removeButton.className =
      "cart-remove-button";

    removeButton.textContent =
      "Remove";

    removeButton.addEventListener(
      "click",
      () => {
        removeItem(
          item.id,
          cart
        );
      }
    );

    details.append(
      name,
      price,
      controls
    );

    if (madeToOrderNotice) {
      details.appendChild(
        madeToOrderNotice
      );
    }

    details.appendChild(
      removeButton
    );

    article.append(
      image,
      details
    );

    return article;
  }

  function changeQuantity(
    itemId,
    change,
    cart
  ) {
    const item =
      cart.find(
        (cartItem) =>
          cartItem.id === itemId
      );

    if (!item) {
      return;
    }

    item.quantity =
      Number(
        item.quantity || 0
      ) + change;

    if (item.quantity <= 0) {
      removeItem(
        itemId,
        cart
      );

      return;
    }

    saveCart(cart);
    renderCart(cart);
  }

  function removeItem(
    itemId,
    cart
  ) {
    const updatedCart =
      cart.filter(
        (item) =>
          item.id !== itemId
      );

    saveCart(updatedCart);
    renderCart(updatedCart);
  }

  function renderEmptyCart() {
    elements.cartItems.innerHTML =
      "";

    const message =
      document.createElement("p");

    message.textContent =
      "Your cart is currently empty.";

    const shopLink =
      document.createElement("a");

    shopLink.href =
      "/shop.html";

    shopLink.className =
      "button";

    shopLink.textContent =
      "Browse the Collection";

    elements.cartItems.append(
      message,
      shopLink
    );

    elements.cartSubtotal.textContent =
      "$0.00";

    updateFreeShippingMessage(0);

    elements.checkoutButton.disabled =
      true;
  }

  function renderCart(cart) {
    updateCartCount(cart);

    if (!cart.length) {
      renderEmptyCart();
      return;
    }

    elements.cartItems.innerHTML =
      "";

    cart.forEach((item) => {
      elements.cartItems.appendChild(
        createCartItem(
          item,
          cart
        )
      );
    });

    const subtotal =
      getCartSubtotal(cart);

    elements.cartSubtotal.textContent =
      formatPrice(subtotal);

    updateFreeShippingMessage(
      subtotal
    );

    elements.checkoutButton.disabled =
      false;

    elements.checkoutButton.textContent =
      "Proceed to Checkout";
  }

  async function beginCheckout() {
    const cart =
      loadCart();

    if (!cart.length) {
      return;
    }

    const invalidItem =
      cart.find((item) => {
        return (
          !item.stripePriceId ||
          !Number.isFinite(
            Number(item.quantity)
          ) ||
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

    elements.checkoutButton.disabled =
      true;

    elements.checkoutButton.textContent =
      "Preparing checkout...";

    try {
      const response =
        await fetch(
          "https://gsc-checkout.onrender.com/api/create-checkout-session",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                items:
                  cart.map(
                    (item) => {
                      return {
                        id:
                          item.id,

                        name:
                          item.name,

                        stripePriceId:
                          item.stripePriceId,

                        quantity:
                          Number(
                            item.quantity
                          )
                      };
                    }
                  ),
                freeShippingEmail:
  appliedFreeShippingEmail,

freeShippingCode:
  appliedFreeShippingCode
              })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Unable to start checkout."
        );
      }

      if (!data.url) {
        throw new Error(
          "Stripe did not return a checkout URL."
        );
      }

      window.location.href =
        data.url;
    } catch (error) {
      console.error(
        "Checkout error:",
        error
      );

      alert(
        "Checkout could not be started. Please try again."
      );

      elements.checkoutButton.disabled =
        false;

      elements.checkoutButton.textContent =
        "Proceed to Checkout";
    }
  }

  async function initializeCart() {
    const cart =
      loadCart();

    await loadCatalog();

    renderCart(cart);

    if (
      elements.checkoutButton
    ) {
      elements
        .checkoutButton
        .addEventListener(
          "click",
          beginCheckout
        );
    }
if (
  elements.applyFreeShippingButton
) {
  elements
    .applyFreeShippingButton
    .addEventListener(
      "click",
      applyFreeShippingCode
    );    
  }

  }  

  document.addEventListener(
    "DOMContentLoaded",
    initializeCart
  );
})();
