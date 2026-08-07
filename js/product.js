(() => {
  "use strict";

  const CATALOG_URL = "/products.json";
  const FALLBACK_IMAGE = "/IMG_8302.jpeg";
  const CART_STORAGE_KEY = "gardenShedClayCart";

  const $ = (selector) => document.querySelector(selector);

  const elements = {
    loading: $("#loading"),
    piece: $("#piece"),
    error: $("#error-state"),
    title: $("#piece-title"),
    price: $("#piece-price"),
    availability: $("#piece-availability"),
    description: $("#piece-description"),
    mainImage: $("#main-image"),
    thumbs: $("#gallery-thumbs"),
    colorGroup: $("#color-group"),
    colorSelect: $("#color-select"),
    buyButton: $("#buy-button"),
    checkoutNote: $("#checkout-note"),
    details: $("#piece-details"),
    tags: $("#piece-tags"),
    year: $("#year")
  };

  function getRequestedId() {
    const params = new URLSearchParams(window.location.search);

    return (
      params.get("id") ||
      params.get("slug") ||
      ""
    ).trim();
  }

  function normalizeCatalog(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (payload && Array.isArray(payload.products)) {
      return payload.products;
    }

    return [];
  }

  function money(value, currency = "USD") {
    const amount = Number(value);

    if (!Number.isFinite(amount)) {
      return "";
    }

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(amount);
  }

  function publicAvailability(product) {
    const quantity = Number(product.inventory ?? 0);

    if (quantity <= 0) {
      return {
        text: "Sold out",
        className: "sold"
      };
    }

    if (quantity <= 3) {
      return {
        text: `Only ${quantity} remaining`,
        className: "low"
      };
    }

    if (product.readyToShip === true) {
      return {
        text: "Ready to ship",
        className: ""
      };
    }

    return {
      text: "Available",
      className: ""
    };
  }

  function yesNo(value) {
    if (value === true) {
      return "Yes";
    }

    if (value === false) {
      return "No";
    }

    return "";
  }

  function shippingText(product) {
    const shipping = product.shipping || {};

    if (shipping.type === "free") {
      return "Free shipping";
    }

    if (shipping.type === "flat-rate") {
      return `${money(
        shipping.price ?? 0,
        product.currency || "USD"
      )} flat-rate shipping`;
    }

    if (shipping.type === "calculated") {
      return "Calculated at checkout";
    }

    return shipping.description || "";
  }

  function imageUrl(image) {
    if (!image) {
      return FALLBACK_IMAGE;
    }

    if (/^https?:\/\//i.test(image)) {
      return image;
    }

    return image.startsWith("/")
      ? image
      : `/${image}`;
  }

  function renderGallery(product) {
    const images =
      Array.isArray(product.images) &&
      product.images.length
        ? product.images
        : [FALLBACK_IMAGE];

    const title =
      product.name ||
      "Garden Shed Clay pottery";

    elements.mainImage.src = imageUrl(images[0]);
    elements.mainImage.alt = `${title}, image 1`;

    elements.mainImage.addEventListener(
      "error",
      () => {
        elements.mainImage.src = FALLBACK_IMAGE;
      },
      { once: true }
    );

    elements.thumbs.innerHTML = "";

    if (images.length <= 1) {
      elements.thumbs.hidden = true;
      return;
    }

    elements.thumbs.hidden = false;

    images.forEach((image, index) => {
      const button =
        document.createElement("button");

      button.type = "button";
      button.className = "thumb-button";

      button.setAttribute(
        "aria-label",
        `View image ${index + 1} of ${title}`
      );

      button.setAttribute(
        "aria-current",
        index === 0 ? "true" : "false"
      );

      const img = document.createElement("img");

      img.src = imageUrl(image);
      img.alt = "";
      img.loading = "lazy";

      img.addEventListener(
        "error",
        () => {
          img.src = FALLBACK_IMAGE;
        },
        { once: true }
      );

      button.appendChild(img);

      button.addEventListener("click", () => {
        elements.mainImage.src =
          imageUrl(image);

        elements.mainImage.alt =
          `${title}, image ${index + 1}`;

        elements.thumbs
          .querySelectorAll(".thumb-button")
          .forEach((thumb) => {
            thumb.setAttribute(
              "aria-current",
              "false"
            );
          });

        button.setAttribute(
          "aria-current",
          "true"
        );
      });

      elements.thumbs.appendChild(button);
    });
  }

  function renderColors(product) {
    const colors = Array.isArray(product.colors)
      ? product.colors.filter(Boolean)
      : [];

    if (!colors.length) {
      elements.colorGroup.hidden = true;
      return;
    }

    elements.colorSelect.innerHTML = "";

    colors.forEach((color) => {
      const option =
        document.createElement("option");

      option.value = color;
      option.textContent = color;

      elements.colorSelect.appendChild(option);
    });

    elements.colorGroup.hidden = false;
  }

  function addDetail(label, value) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return;
    }

    const row = document.createElement("div");
    row.className = "detail-row";

    const labelElement =
      document.createElement("div");

    labelElement.className = "detail-label";
    labelElement.textContent = label;

    const valueElement =
      document.createElement("div");

    valueElement.textContent = value;

    row.append(
      labelElement,
      valueElement
    );

    elements.details.appendChild(row);
  }

  function renderDetails(product) {
    elements.details.innerHTML = "";

    addDetail(
      "Dimensions",
      product.dimensions
    );

    addDetail(
      "Dishwasher safe",
      yesNo(product.dishwasherSafe)
    );

    addDetail(
      "Microwave safe",
      yesNo(product.microwaveSafe)
    );

    if (product.readyToShip === true) {
      addDetail(
        "Availability",
        "Ready to ship"
      );
    } else if (
      product.readyToShip === false
    ) {
      addDetail(
        "Lead time",
        product.leadTime ||
          "Made to order"
      );
    }

    addDetail(
      "Shipping",
      shippingText(product)
    );
  }

  function renderTags(product) {
    elements.tags.innerHTML = "";

    const tags = Array.isArray(product.tags)
      ? product.tags.filter(Boolean)
      : [];

    tags.forEach((tag) => {
      const span =
        document.createElement("span");

      span.className = "tag";
      span.textContent = tag;

      elements.tags.appendChild(span);
    });
  }

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

  
  function addProductToCart(product) {
  const cart = loadCart();

  const productId =
    product.id ||
    product.slug;

  if (!productId) {
    console.error(
      "Unable to add product without an ID."
    );

    return;
  }

  const existingItem = cart.find(
    (item) => item.id === productId
  );

  if (existingItem) {
    existingItem.quantity =
      Number(
        existingItem.quantity || 0
      ) + 1;
  } else {
    const primaryImage =
      Array.isArray(product.images) &&
      product.images.length > 0
        ? imageUrl(product.images[0])
        : FALLBACK_IMAGE;

    cart.push({
      id: productId,
      slug:
        product.slug ||
        product.id,
      name:
        product.name ||
        "Untitled piece",
      price:
        Number(product.price),
      currency:
        product.currency ||
        "USD",
      image: primaryImage,
      quantity: 1,
      stripePriceId:
        product.stripePriceId ||
        ""
    });
  }

  saveCart(cart);

  window.dispatchEvent(
    new Event("cart-updated")
  );

  elements.buyButton.textContent =
    "Added to cart";

  window.setTimeout(() => {
    elements.buyButton.textContent =
      "Add to cart";
  }, 1400);
}
  function configureCheckout(product) {
    const inventory =
      Number(product.inventory ?? 0);

    if (inventory <= 0) {
      elements.buyButton.textContent =
        "Sold out";

      elements.buyButton.disabled = true;

      elements.checkoutNote.textContent =
        "This piece is currently unavailable.";

      return;
    }

    elements.buyButton.textContent =
      "Add to cart";

    elements.buyButton.disabled = false;

    elements.checkoutNote.textContent =
      "Review your selections before secure checkout.";

    elements.buyButton.onclick = () => {
      addProductToCart(product);
    };
  }

  function updateMetadata(product) {
    const title =
      `${product.name} | Garden Shed Clay`;

    const description =
      product.description ||
      "Handmade pottery from Garden Shed Clay in Philadelphia.";

    const productSlug =
      product.slug ||
      product.id ||
      "";

    const canonical =
      `https://gardenshedclay.com/product.html?slug=${
        encodeURIComponent(productSlug)
      }`;

    const primaryImage = imageUrl(
      Array.isArray(product.images)
        ? product.images[0]
        : ""
    );

    const absoluteImage = new URL(
      primaryImage,
      window.location.origin
    ).toString();

    document.title = title;

    const metaDescription =
      $("#meta-description");

    const canonicalLink =
      $("#canonical-link");

    const openGraphTitle =
      $("#og-title");

    const openGraphDescription =
      $("#og-description");

    const openGraphUrl =
      $("#og-url");

    const openGraphImage =
      $("#og-image");

    if (metaDescription) {
      metaDescription.setAttribute(
        "content",
        description
      );
    }

    if (canonicalLink) {
      canonicalLink.setAttribute(
        "href",
        canonical
      );
    }

    if (openGraphTitle) {
      openGraphTitle.setAttribute(
        "content",
        title
      );
    }

    if (openGraphDescription) {
      openGraphDescription.setAttribute(
        "content",
        description
      );
    }

    if (openGraphUrl) {
      openGraphUrl.setAttribute(
        "content",
        canonical
      );
    }

    if (openGraphImage) {
      openGraphImage.setAttribute(
        "content",
        absoluteImage
      );
    }

    const availability =
      Number(product.inventory ?? 0) > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";

    const schema = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      description,
      image: (
        product.images || []
      ).map((image) => {
        return new URL(
          imageUrl(image),
          window.location.origin
        ).toString();
      }),
      brand: {
        "@type": "Brand",
        name: "Garden Shed Clay"
      },
      offers: {
        "@type": "Offer",
        url: canonical,
        priceCurrency:
          product.currency ||
          "USD",
        price:
          Number(product.price),
        availability,
        itemCondition:
          "https://schema.org/NewCondition"
      }
    };

    const productSchema =
      $("#product-schema");

    if (productSchema) {
      productSchema.textContent =
        JSON.stringify(schema);
    }
  }

  function renderProduct(product) {
    elements.title.textContent =
      product.name ||
      "Untitled pottery";

    elements.price.textContent =
      money(
        product.price,
        product.currency ||
          "USD"
      );

    elements.description.textContent =
      product.description ||
      "";

    const availability =
      publicAvailability(product);

    elements.availability.textContent =
      availability.text;

    elements.availability.className =
      `availability ${
        availability.className
      }`.trim();

    renderGallery(product);
    renderColors(product);
    renderDetails(product);
    renderTags(product);
    configureCheckout(product);
    updateMetadata(product);

    elements.loading.hidden = true;
    elements.error.hidden = true;
    elements.piece.hidden = false;
  }

  function showError(message) {
    console.error(message);

    elements.loading.hidden = true;
    elements.piece.hidden = true;
    elements.error.hidden = false;
  }

  async function initialize() {
    if (elements.year) {
      elements.year.textContent =
        new Date().getFullYear();
    }

    const requestedId =
      getRequestedId();

    if (!requestedId) {
      showError(
        "No product ID or slug was supplied."
      );

      return;
    }

    try {
      const response = await fetch(
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

      const products =
        normalizeCatalog(payload);

      const product = products.find(
        (item) => {
          return (
            item &&
            item.published !== false &&
            (
              item.id === requestedId ||
              item.slug === requestedId
            )
          );
        }
      );

      if (!product) {
        showError(
          `No published product matched "${requestedId}".`
        );

        return;
      }

      renderProduct(product);
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : "Unable to load the product catalog."
      );
    }
  }

  document.addEventListener(
    "DOMContentLoaded",
    initialize
  );
})();
