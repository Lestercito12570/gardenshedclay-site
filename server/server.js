import express from "express";
import cors from "cors";
import Stripe from "stripe";
import crypto from "crypto";
import path from "path";

const app = express();

const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY
);
  
const liveStripe = new Stripe(
  process.env.STRIPE_LIVE_SECRET_KEY  
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
  async (req, res) => {
    const signature =
      req.headers["stripe-signature"];

    const webhookSecret =
      process.env.STRIPE_LIVE_WEBHOOK_SECRET;

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
        liveStripe.webhooks.constructEvent(
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

if (
  session.payment_status === "paid" &&
  session.metadata
    ?.newsletterFreeShippingApplied ===
    "yes"
) {
  const mailerLiteToken =
    process.env.MAILERLITE_API_TOKEN;

  const subscriberId =
    String(
      session.metadata
        ?.newsletterSubscriberId ||
      ""
    ).trim();

  if (
    mailerLiteToken &&
    subscriberId
  ) {
    const updateResponse =
      await fetch(
        `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(
          subscriberId
        )}`,
        {
          method: "PUT",

          headers: {
            Accept:
              "application/json",

            Authorization:
              `Bearer ${mailerLiteToken}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              fields: {
                free_shipping_used:
                  "yes"
              }
            })
        }
      );

    if (!updateResponse.ok) {
      const errorText =
        await updateResponse.text();

      console.error(
        "Unable to mark newsletter free-shipping code as used:",
        updateResponse.status,
        errorText
      );
    } else {
      console.log(
        "Newsletter free-shipping code marked as used:",
        {
          subscriberId,
          checkoutSessionId:
            session.id
        }
      );
    }
  }
}
        
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

/*
 * MailerLite newsletter free-shipping webhook
 *
 * Receives newsletter subscriber data from
 * MailerLite, verifies the webhook signature,
 * creates a unique free-shipping code, and
 * stores it in the subscriber's custom fields.
 */
app.post(
  "/api/mailerlite/free-shipping-code",
  express.raw({
    type: "application/json"
  }),
  async (req, res) => {
    try {
      const mailerLiteToken =
        process.env.MAILERLITE_API_TOKEN;

      const webhookSecret =
        process.env.MAILERLITE_WEBHOOK_SECRET;

      if (
        !mailerLiteToken ||
        !webhookSecret
      ) {
        console.error(
          "MailerLite integration is not configured."
        );

        return res.status(500).json({
          error:
            "MailerLite integration is not configured."
        });
      }

      /*
       * Verify that the request really came
       * from MailerLite.
       */
      const signature =
        req.headers.signature;

      if (!signature) {
        console.error(
          "MailerLite webhook received without a signature."
        );

        return res.status(400).json({
          error:
            "Missing MailerLite signature."
        });
      }

      const rawBody =
        req.body;

      const expectedSignature =
        crypto
          .createHmac(
            "sha256",
            webhookSecret
          )
          .update(rawBody)
          .digest("hex");

      if (
        !safeCompare(
          signature,
          expectedSignature
        )
      ) {
        console.error(
          "MailerLite webhook signature verification failed."
        );

        return res.status(400).json({
          error:
            "Invalid MailerLite signature."
        });
      }

      const payload =
        JSON.parse(
          rawBody.toString("utf8")
        );

      /*
       * MailerLite may deliver one event or
       * a batch containing multiple events.
       */
      const incomingEvents =
        Array.isArray(payload.events)
          ? payload.events
          : [payload];

      const mailerLiteHeaders = {
        Accept:
          "application/json",

        Authorization:
          `Bearer ${mailerLiteToken}`,

        "Content-Type":
          "application/json"
      };

      const results = [];

      for (
        const event of incomingEvents
      ) {
        /*
         * Depending on the event format,
         * subscriber information may either
         * be nested or be the event itself.
         */
        const subscriber =
          event.subscriber ||
          event.data?.subscriber ||
          event.data ||
          event;

        const subscriberId =
          String(
            subscriber?.id || ""
          ).trim();

        const subscriberEmail =
          String(
            subscriber?.email || ""
          ).trim();

        if (
          !subscriberId &&
          !subscriberEmail
        ) {
          console.error(
            "MailerLite event did not include subscriber information:",
            event
          );

          results.push({
            success: false,
            reason:
              "missing_subscriber"
          });

          continue;
        }

        const subscriberLookupValue =
          encodeURIComponent(
            subscriberId ||
            subscriberEmail
          );

        /*
         * Fetch the authoritative subscriber
         * record from MailerLite.
         */
        const subscriberResponse =
          await fetch(
            `https://connect.mailerlite.com/api/subscribers/${subscriberLookupValue}`,
            {
              method: "GET",
              headers:
                mailerLiteHeaders
            }
          );

        if (
          !subscriberResponse.ok
        ) {
          const errorText =
            await subscriberResponse.text();

          console.error(
            "Unable to fetch MailerLite subscriber:",
            subscriberResponse.status,
            errorText
          );

          results.push({
            success: false,
            subscriberId:
              subscriberId || null,
            email:
              subscriberEmail || null,
            reason:
              "subscriber_lookup_failed"
          });

          continue;
        }

        const subscriberData =
          await subscriberResponse.json();

        const currentSubscriber =
          subscriberData.data;

        if (!currentSubscriber) {
          results.push({
            success: false,
            subscriberId:
              subscriberId || null,
            email:
              subscriberEmail || null,
            reason:
              "subscriber_not_found"
          });

          continue;
        }

        const existingCode =
          String(
            currentSubscriber
              ?.fields
              ?.free_shipping_code ||
            ""
          ).trim();

        /*
         * If a code already exists, keep it.
         * This prevents retries or repeat
         * webhook deliveries from generating
         * multiple codes for one subscriber.
         */
        if (existingCode) {
          console.log(
            "MailerLite subscriber already has a free-shipping code:",
            {
              subscriberId:
                currentSubscriber.id,

              email:
                currentSubscriber.email
            }
          );

          results.push({
            success: true,
            subscriberId:
              currentSubscriber.id,
            existing: true
          });

          continue;
        }

        /*
         * Generate a customer-friendly,
         * difficult-to-guess unique code.
         *
         * Example:
         * GSC-7A3F91C2
         */
        const freeShippingCode =
          `GSC-${crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()}`;

        /*
         * Store the code and mark it unused.
         */
        const updateResponse =
          await fetch(
            `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(
              currentSubscriber.id
            )}`,
            {
              method: "PUT",

              headers:
                mailerLiteHeaders,

              body:
                JSON.stringify({
                  fields: {
                    free_shipping_code:
                      freeShippingCode,

                    free_shipping_used:
                      "no"
                  }
                })
            }
          );

        if (!updateResponse.ok) {
          const errorText =
            await updateResponse.text();

          console.error(
            "Unable to save MailerLite free-shipping code:",
            updateResponse.status,
            errorText
          );

          results.push({
            success: false,
            subscriberId:
              currentSubscriber.id,
            email:
              currentSubscriber.email,
            reason:
              "code_save_failed"
          });

          continue;
        }

        console.log(
          "Garden Shed Clay free-shipping code created:",
          {
            subscriberId:
              currentSubscriber.id,

            email:
              currentSubscriber.email,

            code:
              freeShippingCode
          }
        );

        results.push({
          success: true,
          subscriberId:
            currentSubscriber.id,
          existing: false
        });
      }

      /*
       * Return a successful webhook response
       * after processing the received events.
       */
      return res.status(200).json({
        received: true,
        processed:
          results.length,
        results
      });
    } catch (error) {
      console.error(
        "Unable to process MailerLite free-shipping webhook:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to generate free-shipping code."
      });
    }
  }
);
app.use(express.json());

/*
 * Validate one-time newsletter free-shipping code.
 *
 * The browser supplies the subscriber email
 * and code. MailerLite remains authoritative.
 */
app.post(
  "/api/validate-free-shipping-code",
  async (req, res) => {
    try {
      const mailerLiteToken =
        process.env.MAILERLITE_API_TOKEN;

      if (!mailerLiteToken) {
        return res.status(500).json({
          error:
            "Newsletter free shipping is not configured."
        });
      }

      const email =
        String(
          req.body.email || ""
        )
          .trim()
          .toLowerCase();

      const code =
        String(
          req.body.code || ""
        )
          .trim()
          .toUpperCase();

      if (!email || !code) {
        return res.status(400).json({
          error:
            "Email address and free shipping code are required."
        });
      }

      const subscriberResponse =
        await fetch(
          `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(
            email
          )}`,
          {
            method: "GET",

            headers: {
              Accept:
                "application/json",

              Authorization:
                `Bearer ${mailerLiteToken}`
            }
          }
        );

      if (!subscriberResponse.ok) {
        return res.status(400).json({
          error:
            "That free shipping code could not be verified."
        });
      }

      const subscriberData =
        await subscriberResponse.json();

      const subscriber =
        subscriberData.data;

      if (!subscriber) {
        return res.status(400).json({
          error:
            "That free shipping code could not be verified."
        });
      }

      const storedCode =
        String(
          subscriber
            ?.fields
            ?.free_shipping_code ||
          ""
        )
          .trim()
          .toUpperCase();

      const used =
        String(
          subscriber
            ?.fields
            ?.free_shipping_used ||
          ""
        )
          .trim()
          .toLowerCase();

      if (
        !storedCode ||
        !safeCompare(
          code,
          storedCode
        )
      ) {
        return res.status(400).json({
          error:
            "That free shipping code does not match this subscriber."
        });
      }

      if (used === "yes") {
        return res.status(400).json({
          error:
            "This free shipping code has already been used."
        });
      }

      return res.json({
        success: true,
        valid: true
      });
    } catch (error) {
      console.error(
        "Unable to validate free shipping code:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to validate free shipping code."
      });
    }
  }
);

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
 * Protected catalog reader
 */
app.get(
  "/api/admin/products",
  requireAdmin,
  async (req, res) => {
    try {
      const githubToken =
        process.env.GITHUB_TOKEN;

      if (!githubToken) {
        return res.status(500).json({
          error:
            "GitHub catalog access is not configured."
        });
      }

      const githubFileUrl =
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_FILE_PATH}?ref=${GITHUB_BRANCH}`;

      const response =
        await fetch(
          githubFileUrl,
          {
            headers: {
              Accept:
                "application/vnd.github+json",

              Authorization:
                `Bearer ${githubToken}`,

              "X-GitHub-Api-Version":
                "2022-11-28",

              "User-Agent":
                "garden-shed-clay-admin"
            }
          }
        );

      if (!response.ok) {
        return res.status(502).json({
          error:
            "Unable to read the product catalog."
        });
      }

      const fileData =
        await response.json();

      const decodedContent =
        Buffer
          .from(
            fileData.content,
            "base64"
          )
          .toString("utf8");

      const catalog =
        JSON.parse(
          decodedContent
        );

      const products =
        Array.isArray(catalog)
          ? catalog
          : catalog.products;

      if (!Array.isArray(products)) {
        return res.status(500).json({
          error:
            "The product catalog has an unsupported structure."
        });
      }

      return res.json({
        products
      });
    } catch (error) {
      console.error(
        "Unable to load product catalog:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to load product catalog."
      });
    }
  }
);


app.patch(
  "/api/admin/products/:id/published",
  requireAdmin,
  async (req, res) => {
  
        try {
      const githubToken =
        process.env.GITHUB_TOKEN;

      if (!githubToken) {
        return res.status(500).json({
          error:
            "GitHub catalog access is not configured."
        });
      }

      const productId =
        String(req.params.id || "").trim();

      const { published } = req.body;

      if (
        !productId ||
        typeof published !== "boolean"
      ) {
        return res.status(400).json({
          error:
            "Product ID and published status are required."
        });
      }

      const githubFileUrl =
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_FILE_PATH}`;

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
          `${githubFileUrl}?ref=${GITHUB_BRANCH}`,
          {
            method: "GET",
            headers
          }
        );

      if (!fileResponse.ok) {
        return res.status(502).json({
          error:
            "Unable to read the product catalog."
        });
      }

      const fileData =
        await fileResponse.json();

      const decodedContent =
        Buffer
          .from(fileData.content, "base64")
          .toString("utf8");

      const catalog =
        JSON.parse(decodedContent);

      const products =
        Array.isArray(catalog)
          ? catalog
          : catalog.products;

      if (!Array.isArray(products)) {
        return res.status(500).json({
          error:
            "The product catalog has an unsupported structure."
        });
      }

      const product =
        products.find(
          (item) =>
            item &&
            item.id === productId
        );

      if (!product) {
        return res.status(404).json({
          error:
            "Product not found."
        });
      }

      product.published = published;

      const updatedCatalog =
        JSON.stringify(catalog, null, 2) +
        "\n";

      const encodedCatalog =
        Buffer
          .from(updatedCatalog, "utf8")
          .toString("base64");

      const updateResponse =
        await fetch(
          githubFileUrl,
          {
            method: "PUT",
            headers: {
              ...headers,
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              message:
                `${published ? "Publish" : "Unpublish"} product: ${product.name}`,
              content: encodedCatalog,
              sha: fileData.sha,
              branch: GITHUB_BRANCH
            })
          }
        );

      if (!updateResponse.ok) {
        const errorText =
          await updateResponse.text();

        console.error(
          "Unable to update product published status:",
          updateResponse.status,
          errorText
        );

        return res.status(502).json({
          error:
            "Unable to update the product catalog."
        });
      }

      return res.json({
        success: true,
        product
      });
    } catch (error) {
      console.error(
        "Unable to update product published status:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to update product published status."
      });
    }  
  }
);
/*
 * Protected existing product update
 *
 * Updates an existing products.json record.
 * If the price changes, creates a new LIVE Stripe
 * Price for the existing Stripe Product and archives
 * the old Price after the catalog update succeeds.
 */
app.patch(
  "/api/admin/products/:id",
  requireAdmin,
  async (req, res) => {
    let newStripePrice = null;

    try {
      const githubToken =
        process.env.GITHUB_TOKEN;

      if (!githubToken) {
        return res.status(500).json({
          error:
            "GitHub catalog access is not configured."
        });
      }

      const productId =
        String(req.params.id || "").trim();

      const { product: submittedProduct } =
        req.body;

      if (
        !productId ||
        !submittedProduct ||
        typeof submittedProduct !== "object"
      ) {
        return res.status(400).json({
          error:
            "Product ID and product record are required."
        });
      }

      const githubFileUrl =
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_FILE_PATH}`;

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

      /*
       * Read current catalog.
       */
      const fileResponse =
        await fetch(
          `${githubFileUrl}?ref=${GITHUB_BRANCH}`,
          {
            method: "GET",
            headers
          }
        );

      if (!fileResponse.ok) {
        return res.status(502).json({
          error:
            "Unable to read the product catalog."
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

      const catalog =
        JSON.parse(decodedContent);

      const products =
        Array.isArray(catalog)
          ? catalog
          : catalog.products;

      if (!Array.isArray(products)) {
        return res.status(500).json({
          error:
            "The product catalog has an unsupported structure."
        });
      }

      const productIndex =
        products.findIndex(
          (item) =>
            item &&
            item.id === productId
        );

      if (productIndex === -1) {
        return res.status(404).json({
          error:
            "Product not found."
        });
      }

      const existingProduct =
        products[productIndex];

      const numericPrice =
        Number(submittedProduct.price);

      if (
        !Number.isFinite(numericPrice) ||
        numericPrice <= 0
      ) {
        return res.status(400).json({
          error:
            "A valid product price is required."
        });
      }

      const oldPrice =
        Number(existingProduct.price);

      const priceChanged =
        Math.round(numericPrice * 100) !==
        Math.round(oldPrice * 100);

      let stripePriceId =
        existingProduct.stripePriceId;

      /*
       * Price changed:
       * create a replacement LIVE Stripe Price
       * attached to the existing Stripe Product.
       */
      if (priceChanged) {
        if (!existingProduct.stripeProductId) {
          return res.status(400).json({
            error:
              "The existing product does not have a Stripe Product ID."
          });
        }

        if (!existingProduct.stripePriceId) {
          return res.status(400).json({
            error:
              "The existing product does not have a Stripe Price ID."
          });
        }

        const unitAmount =
          Math.round(
            numericPrice * 100
          );

        newStripePrice =
          await liveStripe.prices.create({
            product:
              existingProduct.stripeProductId,

            unit_amount:
              unitAmount,

            currency:
              String(
                submittedProduct.currency ||
                existingProduct.currency ||
                "USD"
              ).toLowerCase(),

            metadata: {
              source:
                "garden-shed-clay-admin",

              productId:
                existingProduct.id
            }
          });

        stripePriceId =
          newStripePrice.id;
      }

      /*
       * Preserve identity and Stripe Product.
       * Replace editable catalog values.
       */
      const updatedProduct = {
        ...existingProduct,
        ...submittedProduct,

        id:
          existingProduct.id,

        stripeProductId:
          existingProduct.stripeProductId,

        stripePriceId,

        price:
          numericPrice
      };

      products[productIndex] =
        updatedProduct;

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

      /*
       * Commit updated catalog.
       */
      const updateResponse =
        await fetch(
          githubFileUrl,
          {
            method: "PUT",

            headers: {
              ...headers,

              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              message:
                `Update product: ${updatedProduct.name}`,

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
          "Unable to update products.json:",
          updateResponse.status,
          errorText
        );

        /*
         * If we created a new Stripe Price but
         * GitHub failed, deactivate the new Price
         * so checkout cannot accidentally use it.
         */
        if (newStripePrice) {
          try {
            await liveStripe.prices.update(
              newStripePrice.id,
              {
                active: false
              }
            );
          } catch (rollbackError) {
            console.error(
              "Unable to archive replacement Stripe Price after catalog failure:",
              rollbackError
            );
          }
        }

        return res.status(502).json({
          error:
            "Unable to save the product catalog."
        });
      }

      /*
       * Catalog now points at the new Price,
       * so archive the previous Price.
       */
      if (
        priceChanged &&
        existingProduct.stripePriceId
      ) {
        await liveStripe.prices.update(
          existingProduct.stripePriceId,
          {
            active: false
          }
        );
      }

      const updateData =
        await updateResponse.json();

      console.log(
        "Garden Shed Clay product updated:",
        {
          id:
            updatedProduct.id,

          name:
            updatedProduct.name,

          priceChanged,

          stripePriceId:
            updatedProduct.stripePriceId,

          commit:
            updateData.commit?.sha ||
            null
        }
      );

      return res.json({
        success: true,

        product:
          updatedProduct,

        priceChanged,

        oldStripePriceId:
          existingProduct.stripePriceId ||
          null,

        newStripePriceId:
          priceChanged
            ? stripePriceId
            : null,

        commitSha:
          updateData.commit?.sha ||
          null
      });
    } catch (error) {
      console.error(
        "Unable to update Garden Shed Clay product:",
        error
      );

      /*
       * Best-effort cleanup if a replacement
       * Stripe Price was created before failure.
       */
      if (newStripePrice) {
        try {
          await liveStripe.prices.update(
            newStripePrice.id,
            {
              active: false
            }
          );
        } catch (rollbackError) {
          console.error(
            "Unable to archive replacement Stripe Price after error:",
            rollbackError
          );
        }
      }

      return res.status(500).json({
        error:
          "Unable to save product changes."
      });
    }
  }
);/*
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

app.post(
  "/api/admin/create-live-stripe-product",
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
        await liveStripe.products.create({
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
        await liveStripe.prices.create({
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
        `product-images/${fileName}`;

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

let existingFileSha = null;

const existingFileResponse =
  await fetch(
    `${githubUrl}?ref=${GITHUB_BRANCH}`,
    {
      method: "GET",

      headers: {
        Accept:
          "application/vnd.github+json",

        Authorization:
          `Bearer ${githubToken}`,

        "X-GitHub-Api-Version":
          "2022-11-28",

        "User-Agent":
          "garden-shed-clay-admin"
      }
    }
  );

if (existingFileResponse.ok) {
  const existingFileData =
    await existingFileResponse.json();

  existingFileSha =
    existingFileData.sha || null;
} else if (
  existingFileResponse.status !== 404
) {
  const errorText =
    await existingFileResponse.text();

  console.error(
    "Unable to check existing product image:",
    existingFileResponse.status,
    errorText
  );

  return res.status(502).json({
    error:
      "Unable to check the existing product image."
  });
}      
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

  ...(existingFileSha
    ? { sha: existingFileSha }
    : {}),

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
 *
 * Shipping rules:
 * - $150+ merchandise subtotal = free shipping
 * - Otherwise, highest flat-rate shipping amount
 *   + $5 for each additional flat-rate item
 * - Products marked free shipping contribute $0
 */
app.post(
  "/api/create-checkout-session",
  async (req, res) => {
    try {
    const {
  items,
  freeShippingEmail = "",
  freeShippingCode = ""
} = req.body;
      
      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({
          error:
            "Cart items are required."
        });
      }

let newsletterFreeShippingValid =
  false;

let newsletterSubscriberId =
  "";

const normalizedFreeShippingEmail =
  String(freeShippingEmail)
    .trim()
    .toLowerCase();

const normalizedFreeShippingCode =
  String(freeShippingCode)
    .trim()
    .toUpperCase();

if (
  normalizedFreeShippingEmail &&
  normalizedFreeShippingCode
) {
  const mailerLiteToken =
    process.env.MAILERLITE_API_TOKEN;

  if (!mailerLiteToken) {
    return res.status(500).json({
      error:
        "Newsletter free shipping is not configured."
    });
  }

  const subscriberResponse =
    await fetch(
      `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(
        normalizedFreeShippingEmail
      )}`,
      {
        method: "GET",

        headers: {
          Accept:
            "application/json",

          Authorization:
            `Bearer ${mailerLiteToken}`
        }
      }
    );

  if (!subscriberResponse.ok) {
    return res.status(400).json({
      error:
        "That free shipping code could not be verified."
    });
  }

  const subscriberData =
    await subscriberResponse.json();

  const subscriber =
    subscriberData.data;

  const storedCode =
    String(
      subscriber
        ?.fields
        ?.free_shipping_code ||
      ""
    )
      .trim()
      .toUpperCase();

  const used =
    String(
      subscriber
        ?.fields
        ?.free_shipping_used ||
      ""
    )
      .trim()
      .toLowerCase();

  if (
    !storedCode ||
    !safeCompare(
      normalizedFreeShippingCode,
      storedCode
    )
  ) {
    return res.status(400).json({
      error:
        "That free shipping code does not match this subscriber."
    });
  }

  if (used === "yes") {
    return res.status(400).json({
      error:
        "This free shipping code has already been used."
    });
  }

  newsletterFreeShippingValid =
    true;

  newsletterSubscriberId =
    String(
      subscriber.id || ""
    );
}      
      /*
       * Read the authoritative product catalog.
       * Do not trust price or shipping values
       * supplied by the customer's browser.
       */
      const githubToken =
        process.env.GITHUB_TOKEN;

      if (!githubToken) {
        return res.status(500).json({
          error:
            "Product catalog access is not configured."
        });
      }

      const githubFileUrl =
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_FILE_PATH}?ref=${GITHUB_BRANCH}`;

      const catalogResponse =
        await fetch(
          githubFileUrl,
          {
            headers: {
              Accept:
                "application/vnd.github+json",

              Authorization:
                `Bearer ${githubToken}`,

              "X-GitHub-Api-Version":
                "2022-11-28",

              "User-Agent":
                "garden-shed-clay-checkout"
            }
          }
        );

      if (!catalogResponse.ok) {
        return res.status(502).json({
          error:
            "Unable to read the product catalog."
        });
      }

      const fileData =
        await catalogResponse.json();

      const decodedContent =
        Buffer
          .from(
            fileData.content,
            "base64"
          )
          .toString("utf8");

      const catalog =
        JSON.parse(
          decodedContent
        );

      const products =
        Array.isArray(catalog)
          ? catalog
          : catalog.products;

      if (!Array.isArray(products)) {
        return res.status(500).json({
          error:
            "The product catalog has an unsupported structure."
        });
      }

      /*
       * Build Stripe line items and calculate
       * merchandise subtotal + shipping from
       * authoritative catalog records.
       */
      const lineItems = [];

      let merchandiseSubtotalCents =
        0;

      let highestFlatRateCents =
        0;

      let flatRateItemCount =
        0;

      for (const item of items) {
        if (!item.stripePriceId) {
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
          !Number.isInteger(quantity) ||
          quantity < 1
        ) {
          throw new Error(
            `Invalid quantity for ${
              item.name ||
              "a cart item"
            }.`
          );
        }

        const catalogProduct =
          products.find(
            (product) =>
              product &&
              product.stripePriceId ===
                item.stripePriceId
          );

        if (!catalogProduct) {
          return res.status(400).json({
            error:
              `A cart item is no longer available at its current price. Please refresh your cart and try again.`
          });
        }

        if (
          catalogProduct.published === false
        ) {
          return res.status(400).json({
            error:
              `${catalogProduct.name} is no longer available.`
          });
        }

        const productPrice =
          Number(
            catalogProduct.price
          );

        if (
          !Number.isFinite(productPrice) ||
          productPrice <= 0
        ) {
          return res.status(500).json({
            error:
              `Invalid catalog price for ${catalogProduct.name}.`
          });
        }

        merchandiseSubtotalCents +=
          Math.round(
            productPrice * 100
          ) * quantity;

        const shippingType =
          catalogProduct.shipping?.type ||
          "flat-rate";

        const shippingPrice =
          Number(
            catalogProduct.shipping?.price ||
            0
          );

        if (
          shippingType ===
          "calculated"
        ) {
          return res.status(400).json({
            error:
              `${catalogProduct.name} uses calculated shipping, which is not yet supported at checkout.`
          });
        }

        if (
          shippingType ===
          "flat-rate"
        ) {
          const shippingCents =
            Math.max(
              0,
              Math.round(
                shippingPrice * 100
              )
            );

          highestFlatRateCents =
            Math.max(
              highestFlatRateCents,
              shippingCents
            );

          flatRateItemCount +=
            quantity;
        }

        lineItems.push({
          price:
            catalogProduct.stripePriceId,

          quantity
        });
      }

      /*
       * Combined-order shipping.
       */
      const FREE_SHIPPING_THRESHOLD_CENTS =
        15000;

      const ADDITIONAL_ITEM_SHIPPING_CENTS =
        500;

      let shippingAmountCents =
        0;

let newsletterFreeShippingApplied =
  false;

if (
  merchandiseSubtotalCents >=
  FREE_SHIPPING_THRESHOLD_CENTS
) {
  shippingAmountCents =
    0;
} else if (
  newsletterFreeShippingValid
) {
  shippingAmountCents =
    0;

  newsletterFreeShippingApplied =
    true;
} else if (
  flatRateItemCount > 0
) {
  shippingAmountCents =
    highestFlatRateCents +
    (
      Math.max(
        0,
        flatRateItemCount - 1
      ) *
      ADDITIONAL_ITEM_SHIPPING_CENTS
    );
}
      
const shippingDisplayName =
  newsletterFreeShippingApplied
    ? "Newsletter Free Shipping"
    : shippingAmountCents === 0
      ? "Free Shipping"
      : "Standard Shipping";
      
      /*
       * Create Live Stripe Checkout Session.
       */
      const session =
        await liveStripe
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
            },

            shipping_options: [
              {
                shipping_rate_data: {
                  type:
                    "fixed_amount",

                  fixed_amount: {
                    amount:
                      shippingAmountCents,

                    currency:
                      "usd"
                  },

                  display_name:
                    shippingDisplayName
                }
              }
            ],

metadata: {
  merchandiseSubtotalCents:
    String(
      merchandiseSubtotalCents
    ),

  shippingAmountCents:
    String(
      shippingAmountCents
    ),

  newsletterFreeShippingApplied:
    newsletterFreeShippingApplied
      ? "yes"
      : "no",

  newsletterSubscriberId:
    newsletterFreeShippingApplied
      ? newsletterSubscriberId
      : "",

  newsletterFreeShippingCode:
    newsletterFreeShippingApplied
      ? normalizedFreeShippingCode
      : ""
}
          }
                 );

      console.log(
        "Garden Shed Clay checkout created:",
        {
          checkoutSessionId:
            session.id,

          merchandiseSubtotalCents,

          shippingAmountCents,

          flatRateItemCount
        }
      );

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
