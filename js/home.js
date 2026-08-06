(() => {
  "use strict";

  const CATALOG_URL = "/products.json";
  const FALLBACK_IMAGE = "/logo.png";
  const MAX_FEATURED_PRODUCTS = 3;

  const featuredContainer = document.getElementById("featured-pottery");

  if (!featuredContainer) {
    return;
  }

  function normalizeCatalog(data) {
    if (Array.isArray(data)) {
      return data;
    }

    if (data && Array.isArray(data.products)) {
      return data.products;
    }

    return [];
  }

  function formatPrice(price, currency = "USD") {
    const amount = Number(price);

    if (!Number.isFinite(amount)) {
      return "";
    }

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(amount);
  }

  function imageUrl(image) {
    if (!image) {
      return FALLBACK_IMAGE;
    }

    if (/^https?:\/\//i.test(image)) {
      return image;
    }

    return image.startsWith("/") ? image : `/${image}`;
  }

  function getProductSlug(product) {
    return product.slug || product.id || "";
  }

  function getPrimaryImage(product) {
    if (Array.isArray(product.images) && product.images.length > 0) {
      return imageUrl(product.images[0]);
    }

    return FALLBACK_IMAGE;
  }

  function getAvailability(product) {
    const inventory = Number(product.inventory ?? 0);

    if (inventory <= 0) {
      return "Sold out";
    }

    if (product.readyToShip === true) {
      return "Ready to ship";
    }

    if (product.leadTime) {
      return product.leadTime;
    }

    return "Available";
  }

  function compareFeaturedProducts(a, b) {
    const orderA = Number.isFinite(Number(a.sortOrder))
      ? Number(a.sortOrder)
      : 9999;

    const orderB = Number.isFinite(Number(b.sortOrder))
      ? Number(b.sortOrder)
      : 9999;

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return String(a.name || "").localeCompare(String(b.name || ""));
  }

  function createFeaturedCard(product, index) {
    const link = document.createElement("a");

    link.className =
      index === 0
        ? "pottery-card large"
        : "pottery-card";

    link.href =
      `/product.html?slug=${encodeURIComponent(getProductSlug(product))}`;

    link.setAttribute(
      "aria-label",
      `View ${product.name || "featured pottery"}`
    );

    const image = document.createElement("img");
    image.src = getPrimaryImage(product);
    image.alt =
      product.name || "Featured pottery by Garden Shed Clay";
    image.loading = index === 0 ? "eager" : "lazy";

    image.addEventListener("error", () => {
      image.src = FALLBACK_IMAGE;
    });

    const label = document.createElement("div");
    label.className = "pottery-label";

    const title = document.createElement("h3");
    title.textContent = product.name || "Untitled piece";

    const details = document.createElement("p");

    const price = formatPrice(
      product.price,
      product.currency || "USD"
    );

    const availability = getAvailability(product);

    details.textContent =
      price && availability
        ? `${price} · ${availability}`
        : price || availability;

    label.append(title, details);
    link.append(image, label);

    return link;
  }

  function renderFeaturedProducts(products) {
    const featuredProducts = products
      .filter((product) => {
        return (
          product &&
          product.published === true &&
          product.featured === true
        );
      })
      .sort(compareFeaturedProducts)
      .slice(0, MAX_FEATURED_PRODUCTS);

    featuredContainer.innerHTML = "";

    if (featuredProducts.length === 0) {
      const message = document.createElement("p");
      message.textContent =
        "New featured pottery will be added after the next kiln firing.";

      featuredContainer.appendChild(message);
      return;
    }

    const firstProduct = featuredProducts[0];

    featuredContainer.appendChild(
      createFeaturedCard(firstProduct, 0)
    );

    if (featuredProducts.length > 1) {
      const stack = document.createElement("div");
      stack.className = "pottery-stack";

      featuredProducts
        .slice(1)
        .forEach((product, index) => {
          stack.appendChild(
            createFeaturedCard(product, index + 1)
          );
        });

      featuredContainer.appendChild(stack);
    }
  }

  function showError(error) {
    console.error("Unable to load featured pottery:", error);

    featuredContainer.innerHTML = "";

    const message = document.createElement("p");
    message.textContent =
      "Featured pottery could not be loaded. Please try again shortly.";

    featuredContainer.appendChild(message);
  }

  async function initializeFeaturedPottery() {
    try {
      const response = await fetch(CATALOG_URL, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(
          `Catalog request failed with status ${response.status}`
        );
      }

      const data = await response.json();
      const products = normalizeCatalog(data);

      renderFeaturedProducts(products);
    } catch (error) {
      showError(error);
    }
  }

  document.addEventListener(
    "DOMContentLoaded",
    initializeFeaturedPottery
  );
})();
