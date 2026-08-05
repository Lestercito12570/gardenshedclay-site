(() => {
  "use strict";

  const CATALOG_URL = "/products.json";
  const FALLBACK_IMAGE = "/logo.png";

  const COLLECTION_ORDER = [
    "Kitchen",
    "Mugs & Cups",
    "Tableware",
    "Planters",
    "Garden Pottery"
  ];

  const elements = {
    loading: document.getElementById("loading-state"),
    catalog: document.getElementById("catalog"),
    empty: document.getElementById("empty-state"),
    error: document.getElementById("error-state"),
    navigation: document.getElementById("collection-navigation")
  };

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

  function slugify(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getProductSlug(product) {
    return product.slug || product.id || slugify(product.name);
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
      return {
        label: "Sold out",
        className: "sold-out"
      };
    }

    if (product.readyToShip === true) {
      return {
        label: "Ready to ship",
        className: ""
      };
    }

    if (product.leadTime) {
      return {
        label: product.leadTime,
        className: ""
      };
    }

    return {
      label: "Available",
      className: ""
    };
  }

  function compareProducts(a, b) {
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

  function groupProducts(products) {
    return products.reduce((groups, product) => {
      const collection = product.collection || "Current Work";

      if (!groups[collection]) {
        groups[collection] = [];
      }

      groups[collection].push(product);
      return groups;
    }, {});
  }

  function sortCollections(collectionNames) {
    return collectionNames.sort((a, b) => {
      const indexA = COLLECTION_ORDER.indexOf(a);
      const indexB = COLLECTION_ORDER.indexOf(b);

      if (indexA === -1 && indexB === -1) {
        return a.localeCompare(b);
      }

      if (indexA === -1) {
        return 1;
      }

      if (indexB === -1) {
        return -1;
      }

      return indexA - indexB;
    });
  }

  function createCollectionNavigation(collectionNames) {
    elements.navigation.innerHTML = "";

    collectionNames.forEach((collectionName) => {
      const link = document.createElement("a");
      link.href = `#${slugify(collectionName)}`;
      link.textContent = collectionName;

      elements.navigation.appendChild(link);
    });
  }

  function createProductCard(product) {
    const article = document.createElement("article");
    article.className = "product-card";

    const link = document.createElement("a");
    link.className = "product-card-link";
    link.href =
      `/product.html?slug=${encodeURIComponent(getProductSlug(product))}`;

    const imageShell = document.createElement("div");
    imageShell.className = "product-image-shell";

    const image = document.createElement("img");
    image.className = "product-image";
    image.src = getPrimaryImage(product);
    image.alt = product.name || "Garden Shed Clay pottery";
    image.loading = "lazy";

    image.addEventListener("error", () => {
      if (!image.src.endsWith(FALLBACK_IMAGE)) {
        image.src = FALLBACK_IMAGE;
      }
    });

    const availability = getAvailability(product);

    const status = document.createElement("span");
    status.className = `product-status ${availability.className}`.trim();
    status.textContent = availability.label;

    imageShell.append(image, status);

    const info = document.createElement("div");
    info.className = "product-info";

    const name = document.createElement("h2");
    name.className = "product-name";
    name.textContent = product.name || "Untitled piece";

    const meta = document.createElement("div");
    meta.className = "product-meta";

    const price = document.createElement("p");
    price.className = "product-price";
    price.textContent = formatPrice(
      product.price,
      product.currency || "USD"
    );

    const availabilityText = document.createElement("p");
    availabilityText.className = "product-availability";
    availabilityText.textContent = availability.label;

    meta.append(price, availabilityText);

    const viewPiece = document.createElement("span");
    viewPiece.className = "view-piece";
    viewPiece.textContent = "View piece →";

    info.append(name, meta, viewPiece);
    link.append(imageShell, info);
    article.appendChild(link);

    return article;
  }

  function createCollectionSection(collectionName, products) {
    const section = document.createElement("section");
    section.className = "collection-section";
    section.id = slugify(collectionName);

    const heading = document.createElement("div");
    heading.className = "collection-heading";

    const title = document.createElement("h2");
    title.className = "collection-title";
    title.textContent = collectionName;

    const count = document.createElement("span");
    count.className = "collection-count";
    count.textContent =
      products.length === 1
        ? "1 piece"
        : `${products.length} pieces`;

    heading.append(title, count);

    const grid = document.createElement("div");
    grid.className = "product-grid";

    products
      .sort(compareProducts)
      .forEach((product) => {
        grid.appendChild(createProductCard(product));
      });

    section.append(heading, grid);

    return section;
  }

  function renderCatalog(products) {
    const publishedProducts = products.filter((product) => {
      return product && product.published === true;
    });

    if (publishedProducts.length === 0) {
      elements.loading.hidden = true;
      elements.catalog.hidden = true;
      elements.error.hidden = true;
      elements.empty.hidden = false;
      return;
    }

    const groupedProducts = groupProducts(publishedProducts);
    const collectionNames = sortCollections(
      Object.keys(groupedProducts)
    );

    createCollectionNavigation(collectionNames);

    elements.catalog.innerHTML = "";

    collectionNames.forEach((collectionName) => {
      const section = createCollectionSection(
        collectionName,
        groupedProducts[collectionName]
      );

      elements.catalog.appendChild(section);
    });

    elements.loading.hidden = true;
    elements.empty.hidden = true;
    elements.error.hidden = true;
    elements.catalog.hidden = false;
  }

  function showError(error) {
    console.error("Unable to load shop catalog:", error);

    elements.loading.hidden = true;
    elements.catalog.hidden = true;
    elements.empty.hidden = true;
    elements.error.hidden = false;
  }

  async function initializeShop() {
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

      renderCatalog(products);
    } catch (error) {
      showError(error);
    }
  }

  document.addEventListener("DOMContentLoaded", initializeShop);
})();
