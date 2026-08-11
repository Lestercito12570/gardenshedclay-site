import express from "express";
import cors from "cors";
import Stripe from "stripe";
import crypto from "crypto";
import path from "path";

const app = express();

const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY
);

const PORT = process.env.PORT || 3000;

/*
 * GitHub catalog configuration
 *
 * These values are not secrets.
 * The actual GitHub token remains safely
 * stored in Render as GITHUB_TOKEN.
 */
const GITHUB_OWNER = "Lestercito12570";
const GITHUB_REPO = "gardenshedclay-site";
const GITHUB_BRANCH = "main";
const PRODUCTS_FILE_PATH = "products.json";

app.use(cors());

function safeCompare(valueA, valueB) {
  const bufferA = Buffer.from(
    String(valueA),
    "utf8"
  );

  const bufferB = Buffer.from(
    String(valueB),
    "utf8"
  );

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    bufferA,
    bufferB
  );
}

function requireAdmin(req, res, next) {
  const expectedUsername =
    process.env.ADMIN_USERNAME;

  const expectedPassword =
    process.env.ADMIN_PASSWORD;

  if (
    !expectedUsername ||
    !expectedPassword
  ) {
    console.error(
      "Admin credentials are not configured."
    );

    return res.status(500).send(
      "Admin authentication is not configured."
    );
  }

  const authorization =
    req.headers.authorization || "";

  if (
    !authorization.startsWith("Basic ")
  ) {
    res.set(
      "WWW-Authenticate",
      'Basic realm="Garden Shed Clay Admin", charset="UTF-8"'
    );

    return res.status(401).send(
      "Authentication required."
    );
  }

  try {
    const encodedCredentials =
      authorization.slice(6);

    const decodedCredentials =
      Buffer
        .from(
          encodedCredentials,
          "base64"
        )
        .toString("utf8");

    const separatorIndex =
      decodedCredentials.indexOf(":");

    if (separatorIndex === -1) {
      throw new Error(
        "Invalid Basic Authentication format."
      );
    }

    const suppliedUsername =
      decodedCredentials.slice(
        0,
        separatorIndex
      );

    const suppliedPassword =
      decodedCredentials.slice(
        separatorIndex + 1
      );

    const usernameMatches =
      safeCompare(
        suppliedUsername,
        expectedUsername
      );

    const passwordMatches =
      safeCompare(
        suppliedPassword,
        expectedPassword
      );

    if (
      !usernameMatches ||
      !passwordMatches
    ) {
      res.set(
        "WWW-Authenticate",
        'Basic realm="Garden Shed Clay Admin", charset="UTF-8"'
      );

      return res.status(401).send(
        "Invalid username or password."
      );
    }

    return next();
  } catch (error) {
    console.error(
      "Admin authentication error:",
      error
    );

    res.set(
      "WWW-Authenticate",
      'Basic realm="Garden Shed Clay Admin", charset="UTF-8"'
    );

    return res.status(401).send(
      "Authentication required."
    );
  }
}

/*
 * Stripe webhook
 *
 * IMPORTANT:
 * This route must use the raw request body
 * and must appear before express.json().
 */
app.post(
  "/api/stripe-webhook",
  express.raw({
    type: "application/json"
  }),
  (req, res) => {
    const signature =
      req.headers["stripe-signature"];

    const webhookSecret =
      process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature) {
      console.error(
        "Stripe webhook received without a signature."
      );

      return res.status(400).send(
        "Missing Stripe signature."
      );
    }

    if (!webhookSecret) {
      console.error(
        "STRIPE_WEBHOOK_SECRET is not configured."
      );

      return res.status(500).send(
        "Webhook secret is not configured."
      );
    }

    let event;

    try {
      event =
        stripe.webhooks.constructEvent(
          req.body,
          signature,
          webhookSecret
        );
    } catch (error) {
      console.error(
        "Stripe webhook signature verification failed:",
        error instanceof Error
          ? error.message
          : error
      );

      return res.status(400).send(
        "Webhook signature verification failed."
      );
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session =
          event.data.object;

        console.log(
          "Garden Shed Clay order paid:",
          {
            checkoutSessionId:
              session.id,

            paymentStatus:
              session.payment_status,

            customerEmail:
              session.customer_details
                ?.email || null,

            amountTotal:
              session.amount_total,

            currency:
              session.currency
          }
        );

        break;
      }

      default:
        console.log(
          `Unhandled Stripe event: ${event.type}`
        );
    }

    return res.json({
      received: true
    });
  }
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service:
      "Garden Shed Clay Checkout",
    message:
      "Checkout service is running."
  });
});

/*
 * Protected Garden Shed Clay Admin page
 */
app.get(
  "/admin",
  requireAdmin,
  (req, res) => {
    const adminFile =
      path.join(
        process.cwd(),
        "admin.html"
      );

    return res.sendFile(adminFile);
  }
);

/*
 * Protected Stripe product creation
 */
app.post(
  "/api/admin/create-stripe-product",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        name,
        description = "",
        price,
        currency = "USD",
        slug = ""
      } = req.body;

      const numericPrice =
        Number(price);

      if (
        !name ||
        !name.trim()
      ) {
        return res.status(400).json({
          error:
            "Product name is required."
        });
      }

      if (
        !Number.isFinite(
          numericPrice
        ) ||
        numericPrice <= 0
      ) {
        return res.status(400).json({
          error:
            "A valid product price is required."
        });
      }

      const unitAmount =
        Math.round(
          numericPrice * 100
        );

      const stripeProduct =
        await stripe.products.create({
          name:
            name.trim(),

          description:
            description.trim() ||
            undefined,

          metadata: {
            source:
              "garden-shed-clay-admin",

            slug:
              slug || ""
          }
        });

      const stripePrice =
        await stripe.prices.create({
          product:
            stripeProduct.id,

          unit_amount:
            unitAmount,

          currency:
            currency.toLowerCase()
        });

      return res.json({
        productId:
          stripeProduct.id,

        priceId:
          stripePrice.id
      });
    } catch (error) {
      console.error(
        "Unable to create Stripe product:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to create Stripe product."
      });
    }
  }
);

/*
 * Protected catalog publishing
 *
 * Reads products.json from GitHub,
 * adds the new product, then commits
 * the updated catalog back to main.
 */
app.post(
  "/api/admin/publish-product",
  requireAdmin,
  async (req, res) => {
    try {
      const githubToken =
        process.env.GITHUB_TOKEN;

      if (!githubToken) {
        console.error(
          "GITHUB_TOKEN is not configured."
        );

        return res.status(500).json({
          error:
            "GitHub publishing is not configured."
        });
      }

      const { product } = req.body;

      if (
        !product ||
        typeof product !== "object"
      ) {
        return res.status(400).json({
          error:
            "A product record is required."
        });
      }

      if (
        !product.id ||
        !product.name
      ) {
        return res.status(400).json({
          error:
            "Product ID and name are required."
        });
      }

      if (
        !product.stripeProductId ||
        !product.stripePriceId
      ) {
        return res.status(400).json({
          error:
            "Create the product in Stripe before publishing."
        });
      }

      const githubFileUrl =
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_FILE_PATH}?ref=${GITHUB_BRANCH}`;

      const headers = {
        Accept:
          "application/vnd.github+json",

        Authorization:
          `Bearer ${githubToken}`,

        "X-GitHub-Api-Version":
          "2022-11-28",

        "User-Agent":
          "garden-shed-clay-admin"
      };

      const fileResponse =
        await fetch(
          githubFileUrl,
          {
            method: "GET",
            headers
          }
        );

      if (!fileResponse.ok) {
        const errorText =
          await fileResponse.text();

        console.error(
          "Unable to read products.json from GitHub:",
          fileResponse.status,
          errorText
        );

        return res.status(502).json({
          error:
            "Unable to read the product catalog from GitHub."
        });
      }

      const fileData =
        await fileResponse.json();

      const decodedContent =
        Buffer
          .from(
            fileData.content,
            "base64"
          )
          .toString("utf8");

      let catalog;

      try {
        catalog =
          JSON.parse(decodedContent);
      } catch (error) {
        console.error(
          "products.json contains invalid JSON:",
          error
        );

        return res.status(500).json({
          error:
            "The current product catalog is invalid."
        });
      }

      let products;

      /*
       * Your storefront already supports either:
       *
       * [
       *   {...}
       * ]
       *
       * or:
       *
       * {
       *   "products": [
       *     {...}
       *   ]
       * }
       *
       * This preserves whichever format
       * products.json currently uses.
       */
      if (Array.isArray(catalog)) {
        products = catalog;
      } else if (
        catalog &&
        Array.isArray(catalog.products)
      ) {
        products =
          catalog.products;
      } else {
        return res.status(500).json({
          error:
            "The product catalog has an unsupported structure."
        });
      }

      const duplicate =
        products.find((existing) => {
          if (!existing) {
            return false;
          }

          return (
            existing.id === product.id ||
            (
              product.slug &&
              existing.slug === product.slug
            )
          );
        });

      if (duplicate) {
        return res.status(409).json({
          error:
            "A product with this ID or slug already exists."
        });
      }

      products.push(product);

      const updatedCatalog =
        JSON.stringify(
          catalog,
          null,
          2
        ) + "\n";

      const encodedCatalog =
        Buffer
          .from(
            updatedCatalog,
            "utf8"
          )
          .toString("base64");

      const updateResponse =
        await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_FILE_PATH}`,
          {
            method: "PUT",

            headers: {
              ...headers,
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              message:
                `Publish product: ${product.name}`,

              content:
                encodedCatalog,

              sha:
                fileData.sha,

              branch:
                GITHUB_BRANCH
            })
          }
        );

      if (!updateResponse.ok) {
        const errorText =
          await updateResponse.text();

        console.error(
          "Unable to publish products.json to GitHub:",
          updateResponse.status,
          errorText
        );

        return res.status(502).json({
          error:
            "Unable to publish the product to GitHub."
        });
      }

      const updateData =
        await updateResponse.json();

      console.log(
        "Garden Shed Clay product published:",
        {
          id:
            product.id,

          name:
            product.name,

          commit:
            updateData.commit?.sha ||
            null
        }
      );

      return res.json({
        success: true,
        product,
        commitSha:
          updateData.commit?.sha ||
          null
      });
    } catch (error) {
      console.error(
        "Unable to publish Garden Shed Clay product:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to publish product."
      });
    }
  }
);
/*
 * Protected product image import
 *
 * Downloads one remote product image and
 * commits it to the Garden Shed Clay GitHub
 * repository under images/products/.
 */
app.post(
  "/api/admin/import-product-image",
  requireAdmin,
  async (req, res) => {
    try {
      const githubToken =
        process.env.GITHUB_TOKEN;

      if (!githubToken) {
        return res.status(500).json({
          error:
            "GitHub image importing is not configured."
        });
      }

      const {
        imageUrl,
        slug,
        imageIndex
      } = req.body;

      if (
        !imageUrl ||
        !slug ||
        !Number.isInteger(Number(imageIndex))
      ) {
        return res.status(400).json({
          error:
            "Image URL, product slug, and image index are required."
        });
      }

      /*
       * Only accept HTTPS image URLs.
       */
      let parsedImageUrl;

      try {
        parsedImageUrl =
          new URL(imageUrl);
      } catch {
        return res.status(400).json({
          error:
            "The image URL is invalid."
        });
      }

      if (parsedImageUrl.protocol !== "https:") {
        return res.status(400).json({
          error:
            "Only HTTPS image URLs are allowed."
        });
      }

      /*
       * Download the remote image.
       */
      const imageResponse =
        await fetch(imageUrl);

      if (!imageResponse.ok) {
        return res.status(502).json({
          error:
            "Unable to download the product image."
        });
      }

      const contentType =
        imageResponse.headers.get(
          "content-type"
        ) || "";

      if (!contentType.startsWith("image/")) {
        return res.status(400).json({
          error:
            "The remote URL did not return an image."
        });
      }

      /*
       * Determine a safe extension.
       */
      let extension = "jpg";

      if (contentType.includes("png")) {
        extension = "png";
      } else if (
        contentType.includes("webp")
      ) {
        extension = "webp";
      } else if (
        contentType.includes("gif")
      ) {
        extension = "gif";
      }

      const safeSlug =
        String(slug)
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

      if (!safeSlug) {
        return res.status(400).json({
          error:
            "The product slug is invalid."
        });
      }

      const paddedIndex =
        String(Number(imageIndex))
          .padStart(2, "0");

      const fileName =
        `${safeSlug}-${paddedIndex}.${extension}`;

      const repositoryPath =
        `images/products/${fileName}`;

      const imageBuffer =
        Buffer.from(
          await imageResponse.arrayBuffer()
        );

      /*
       * Keep accidental giant downloads out
       * of the repository.
       */
      const MAX_IMAGE_BYTES =
        15 * 1024 * 1024;

      if (
        imageBuffer.length >
        MAX_IMAGE_BYTES
      ) {
        return res.status(413).json({
          error:
            "The product image is too large."
        });
      }

      const githubUrl =
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repositoryPath}`;

      const githubResponse =
        await fetch(
          githubUrl,
          {
            method: "PUT",

            headers: {
              Accept:
                "application/vnd.github+json",

              Authorization:
                `Bearer ${githubToken}`,

              "X-GitHub-Api-Version":
                "2022-11-28",

              "User-Agent":
                "garden-shed-clay-admin",

              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              message:
                `Import product image: ${fileName}`,

              content:
                imageBuffer.toString(
                  "base64"
                ),

              branch:
                GITHUB_BRANCH
            })
          }
        );

      if (!githubResponse.ok) {
        const errorText =
          await githubResponse.text();

        console.error(
          "Unable to import product image to GitHub:",
          githubResponse.status,
          errorText
        );

        return res.status(502).json({
          error:
            "Unable to save the product image to GitHub."
        });
      }

      const githubData =
        await githubResponse.json();

      console.log(
        "Garden Shed Clay product image imported:",
        {
          path:
            repositoryPath,

          commit:
            githubData.commit?.sha ||
            null
        }
      );

      return res.json({
        success: true,

        path:
          repositoryPath,

        fileName,

        commitSha:
          githubData.commit?.sha ||
          null
      });
    } catch (error) {
      console.error(
        "Unable to import product image:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to import product image."
      });
    }
  }
);
/*
 * Public customer checkout
 */
app.post(
  "/api/create-checkout-session",
  async (req, res) => {
    try {
      const { items } =
        req.body;

      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({
          error:
            "Cart items are required."
        });
      }

      const lineItems =
        items.map((item) => {
          if (
            !item.stripePriceId
          ) {
            throw new Error(
              `Missing Stripe Price ID for ${
                item.name ||
                "a cart item"
              }.`
            );
          }

          const quantity =
            Number(
              item.quantity || 1
            );

          if (
            !Number.isInteger(
              quantity
            ) ||
            quantity < 1
          ) {
            throw new Error(
              `Invalid quantity for ${
                item.name ||
                "a cart item"
              }.`
            );
          }

          return {
            price:
              item.stripePriceId,

            quantity
          };
        });

      const session =
        await stripe
          .checkout
          .sessions
          .create({
            mode:
              "payment",

            line_items:
              lineItems,

            success_url:
              "https://gardenshedclay.com/success.html?session_id={CHECKOUT_SESSION_ID}",

            cancel_url:
              "https://gardenshedclay.com/cart.html",

            billing_address_collection:
              "auto",

            shipping_address_collection: {
              allowed_countries: [
                "US"
              ]
            }
          });

      return res.json({
        url:
          session.url
      });
    } catch (error) {
      console.error(
        "Unable to create Stripe Checkout Session:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to start checkout."
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(
    `Garden Shed Clay checkout service listening on port ${PORT}`
  );
});
