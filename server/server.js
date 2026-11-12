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
const CUSTOMERS_FILE_PATH = "customers.json";
const ORDERS_FILE_PATH = "orders.json";

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

        /*
         * Load the Garden Shed Clay order ledger
         * after a successful Stripe payment.
         */
        if (
          session.payment_status === "paid"
        ) {

          const stripeLineItems =
            await liveStripe.checkout.sessions.listLineItems(
              session.id,
              {
                limit: 100
              }
            );

          const purchasedItems =
            stripeLineItems.data.map(
              (item) => ({
                stripePriceId:
                  item.price?.id || null,

                name:
                  item.description || null,

                quantity:
                  item.quantity || 0,

                unitAmount:
                  item.price?.unit_amount || 0,

                amountTotal:
                  item.amount_total || 0
              })
            );
          
          const githubToken =
            process.env.GITHUB_TOKEN;

          if (!githubToken) {
            throw new Error(
              "GITHUB_TOKEN is not configured for order recording."
            );
          }

          const ordersFileUrl =
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ORDERS_FILE_PATH}?ref=${GITHUB_BRANCH}`;

          const ordersResponse =
            await fetch(
              ordersFileUrl,
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
                    "garden-shed-clay-checkout"
                }
              }
            );

          if (!ordersResponse.ok) {
            throw new Error(
              `Unable to read orders.json from GitHub: ${ordersResponse.status}`
            );
          }

          const ordersFileData =
            await ordersResponse.json();

          const ordersContent =
            Buffer
              .from(
                ordersFileData.content,
                "base64"
              )
              .toString("utf8");

          const orderData =
            JSON.parse(
              ordersContent
            );

          if (
            !orderData ||
            !Array.isArray(orderData.orders)
          ) {
            throw new Error(
              "orders.json has an unsupported structure."
            );
          }

          const existingOrder =
            orderData.orders.find(
              (order) =>
                order &&
                order.stripeCheckoutSessionId ===
                  session.id
            );

          if (existingOrder) {
            console.log(
              "Garden Shed Clay order already recorded:",
              {
                checkoutSessionId:
                  session.id,

                orderId:
                  existingOrder.orderId ||
                  null
              }
            );
          }

          if (!existingOrder) {
            const newOrder = {
              orderId:
                `gsc-${session.id}`,

              stripeCheckoutSessionId:
                session.id,

              stripePaymentIntentId:
                session.payment_intent ||
                null,

              orderDate:
                new Date(
                  session.created * 1000
                ).toISOString(),

              status:
                "pending-shipment",

              inventoryTracking:
                "pending",

              customer: {
                name:
                  session.customer_details
                    ?.name || null,

                email:
                  session.customer_details
                    ?.email || null
              },

              items:
                purchasedItems,

              subtotal:
                session.metadata
                  ?.merchandiseSubtotalCents
                  ? Number(
                      session.metadata
                        .merchandiseSubtotalCents
                    )
                  : 0,

              shipping:
                session.metadata
                  ?.shippingAmountCents
                  ? Number(
                      session.metadata
                        .shippingAmountCents
                    )
                  : 0,

              total:
                session.amount_total || 0,

              currency:
                String(
                  session.currency || "usd"
                ).toUpperCase()
            };
        
            orderData.orders.push(
              newOrder
            );

            const updatedOrders =
              JSON.stringify(
                orderData,
                null,
                2
              ) + "\n";

            const encodedOrders =
              Buffer
                .from(
                  updatedOrders,
                  "utf8"
                )
                .toString("base64");     

            const ordersWriteUrl =
              `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ORDERS_FILE_PATH}`;            

            const ordersWriteResponse =
              await fetch(
                ordersWriteUrl,
                {
                  method: "PUT",
                  headers: {
                    Accept:
                      "application/vnd.github+json",
                    Authorization:
                      `Bearer ${githubToken}`,
                    "X-GitHub-Api-Version":
                      "2022-11-28",
                    "Content-Type":
                      "application/json",
                    "User-Agent":
                      "garden-shed-clay-checkout"
                  },
                  body: JSON.stringify({
                    message:
                      `Record Garden Shed Clay order ${newOrder.orderId}`,
                    content:
                      encodedOrders,
                    sha:
                      ordersFileData.sha,
                    branch:
                      GITHUB_BRANCH
                  })
                }
              );

            if (!ordersWriteResponse.ok) {
              const ordersWriteError =
                await ordersWriteResponse.text();

              throw new Error(
                `Unable to write orders.json to GitHub: ${ordersWriteResponse.status} ${ordersWriteError}`
              );
            }            

            console.log(
              "Garden Shed Clay order recorded:",
              {
                orderId:
                  newOrder.orderId,

                checkoutSessionId:
                  session.id
              }
            );
            
          }
          
          // Legacy orders predate inventory automation. They were reconciled
          // manually and must NEVER be deducted retroactively on webhook retry.
          const inventoryEligible = !existingOrder ||
            existingOrder.inventoryTracking === "pending";
          if (inventoryEligible) {
            // The product catalog commit is the idempotency boundary: each
            // product records the Stripe session ID in the same atomic write
            // as its stock reduction. GitHub's blob SHA prevents stale writes.
            const catalogUrl =
              `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${PRODUCTS_FILE_PATH}`;
            const headers = {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${githubToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
              "Content-Type": "application/json",
              "User-Agent": "garden-shed-clay-checkout"
            };
            let inventoryCommitted = false;
            for (let attempt = 0; attempt < 5; attempt++) {
              const catalogResponse = await fetch(
                `${catalogUrl}?ref=${GITHUB_BRANCH}`, { headers }
              );
              if (!catalogResponse.ok) {
                throw new Error(`Unable to read inventory: ${catalogResponse.status}`);
              }
              const catalogFile = await catalogResponse.json();
              const catalog = JSON.parse(Buffer.from(
                catalogFile.content, "base64"
              ).toString("utf8"));
              const products = Array.isArray(catalog) ? catalog : catalog.products;
              if (!Array.isArray(products)) {
                throw new Error("Invalid products.json inventory structure.");
              }
              const quantities = new Map();
              for (const item of purchasedItems) {
                if (!item.stripePriceId || !Number.isInteger(item.quantity) || item.quantity < 1) {
                  throw new Error("Paid order has invalid inventory line items.");
                }
                quantities.set(item.stripePriceId,
                  (quantities.get(item.stripePriceId) || 0) + item.quantity);
              }
              let changed = false;
              for (const [priceId, quantity] of quantities) {
                const product = products.find(p => p && p.stripePriceId === priceId);
                if (!product) throw new Error(`Paid product not found in catalog: ${priceId}`);
                const applied = Array.isArray(product.inventoryAppliedCheckoutSessions)
                  ? product.inventoryAppliedCheckoutSessions : [];
                if (applied.includes(session.id)) continue;
                if (!Number.isSafeInteger(product.inventory) || product.inventory < quantity) {
                  // Do not silently clamp stock or fabricate inventory. Escalate
                  // this paid order for manual fulfillment reconciliation.
                  throw new Error(`Paid order inventory shortage for ${product.id}: need ${quantity}, have ${product.inventory}`);
                }
                product.inventory -= quantity;
                product.inventoryAppliedCheckoutSessions = [...applied, session.id];
                changed = true;
              }
              if (!changed) {
                inventoryCommitted = true;
                break;
              }
              const write = await fetch(catalogUrl, {
                method: "PUT", headers,
                body: JSON.stringify({
                  message: `Deduct inventory for paid checkout ${session.id}`,
                  content: Buffer.from(JSON.stringify(catalog, null, 2) + "\\n").toString("base64"),
                  sha: catalogFile.sha,
                  branch: GITHUB_BRANCH
                })
              });
              if (write.ok) {
                inventoryCommitted = true;
                break;
              }
              if (write.status !== 409 && write.status !== 422) {
                throw new Error(`Unable to commit paid order inventory: ${write.status}`);
              }
            }
            if (!inventoryCommitted) {
              throw new Error("Inventory commit conflict after five retries.");
            }
            console.log("Paid checkout inventory deducted or previously applied:", session.id);
          }

          if (session.metadata?.internationalInquiryId) {
            const inquiryId = session.metadata.internationalInquiryId;
            const quoteHash = session.metadata.internationalQuoteHash;
            const verified = await mtoMutate(all => {
              const inquiry = all.find(x=>x.id===inquiryId && x.type==="international-shipping");
              if (!inquiry || inquiry.paymentSessionId !== session.id ||
                  inquiry.paymentQuoteHash !== quoteHash) {
                throw new Error("International paid session does not match a registered quote.");
              }
              if (inquiry.paymentConfirmedAt) return inquiry;
              inquiry.paymentConfirmedAt = new Date().toISOString();
              inquiry.status = "paid-ready-for-production";
              inquiry.updatedAt = new Date().toISOString();
              return inquiry;
            });
            if (!verified) throw new Error("Unable to confirm international paid inquiry.");
          }

          console.log(
            "Garden Shed Clay order ledger loaded:",
            {
              existingOrders:
                orderData.orders.length,

              checkoutSessionId:
                session.id
            }
          );
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
        console.error(
          "GitHub product catalog read failed:",
          response.status,
          response.statusText
        );

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


app.get(
  "/api/admin/customers",
  requireAdmin,
  async (req, res) => {
    try {
      const githubToken =
        process.env.GITHUB_TOKEN;

      if (!githubToken) {
        return res.status(500).json({
          error:
            "GitHub customer access is not configured."
        });
      }

      const githubFileUrl =
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${CUSTOMERS_FILE_PATH}?ref=${GITHUB_BRANCH}`;

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
            "Unable to read the customer database."
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

      const customerData =
        JSON.parse(
          decodedContent
        );

      const customers =
        Array.isArray(customerData)
          ? customerData
          : customerData.customers;

      if (!Array.isArray(customers)) {
        return res.status(500).json({
          error:
            "The customer database has an unsupported structure."
        });
      }

      return res.json({
        customers
      });
    } catch (error) {
      console.error(
        "Unable to load customer database:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to load customer database."
      });
    }
  }
);

app.get(
  "/api/admin/orders",
  requireAdmin,
  async (req, res) => {
    try {
      const githubToken =
        process.env.GITHUB_TOKEN;

      if (!githubToken) {
        return res.status(500).json({
          error:
            "GitHub order access is not configured."
        });
      }

      const githubFileUrl =
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ORDERS_FILE_PATH}?ref=${GITHUB_BRANCH}`;

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
            "Unable to read the order database."
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

      const orderData =
        JSON.parse(
          decodedContent
        );

      const orders =
        Array.isArray(orderData)
          ? orderData
          : orderData.orders;

      if (!Array.isArray(orders)) {
        return res.status(500).json({
          error:
            "The order database has an unsupported structure."
        });
      }

      return res.json({
        orders
      });
    } catch (error) {
      console.error(
        "Unable to load order database:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to load order database."
      });
    }
  }
);

app.patch(
  "/api/admin/orders/:orderId/status",
  requireAdmin,
  async (req, res) => {
    const orderId =
      String(
        req.params.orderId || ""
      ).trim();

    const status =
      String(
        req.body?.status || ""
      ).trim();

    if (!orderId) {
      return res.status(400).json({
        error:
          "Order ID is required."
      });
    }

    if (
      ![
        "pending-shipment",
        "shipped"
      ].includes(status)
    ) {
      return res.status(400).json({
        error:
          "Unsupported order status."
      });
    }

    const githubToken =
      process.env.GITHUB_TOKEN;

    if (!githubToken) {
      return res.status(500).json({
        error:
          "GitHub order access is not configured."
      });
    }

    const githubFileUrl =
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ORDERS_FILE_PATH}?ref=${GITHUB_BRANCH}`;

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
          "Unable to read the order database."
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

    const orderData =
      JSON.parse(
        decodedContent
      );

    const orders =
      Array.isArray(orderData)
        ? orderData
        : orderData.orders;

    if (!Array.isArray(orders)) {
      return res.status(500).json({
        error:
          "The order database has an unsupported structure."
      });
    }

    const order =
      orders.find(
        (item) =>
          item &&
          item.orderId === orderId
      );

    if (!order) {
      return res.status(404).json({
        error:
          "Order not found."
      });
    }

    order.status =
      status;

    const updatedOrders =
      JSON.stringify(
        orderData,
        null,
        2
      ) + "\n";

    const encodedOrders =
      Buffer
        .from(
          updatedOrders,
          "utf8"
        )
        .toString("base64");

    const ordersWriteUrl =
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ORDERS_FILE_PATH}`;

    const writeResponse =
      await fetch(
        ordersWriteUrl,
        {
          method: "PUT",

          headers: {
            Accept:
              "application/vnd.github+json",

            Authorization:
              `Bearer ${githubToken}`,

            "X-GitHub-Api-Version":
              "2022-11-28",

            "Content-Type":
              "application/json",

            "User-Agent":
              "garden-shed-clay-admin"
          },

          body: JSON.stringify({
            message:
              `Update Garden Shed Clay order ${orderId} to ${status}`,

            content:
              encodedOrders,

            sha:
              fileData.sha,

            branch:
              GITHUB_BRANCH
          })
        }
      );

    if (!writeResponse.ok) {
      const writeError =
        await writeResponse.text();

      console.error(
        "Unable to update order:",
        writeError
      );
      
      return res.status(502).json({
        error:
          "Unable to update the order."
      });
    }

    return res.json({
      success: true,
      order
    });
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
    let catalogUpdated = false;
    
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

const submittedSlug =
  String(
    req.body?.product?.slug || ""
  ).trim();

if (!submittedSlug) {
  return res.status(400).json({
    error:
      "Product slug is required."
  });
}

      const slugConflict =
  products.some(
    (item, index) =>
      index !== productIndex &&
      item?.slug === submittedSlug
  );

if (slugConflict) {
  return res.status(409).json({
    error:
      "Another product already uses that slug."
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

      catalogUpdated = true;
      
      /*
       * Catalog now points at the new Price,
       * so archive the previous Price.
       */
      
     if (
  priceChanged &&
  existingProduct.stripePriceId
) {
  try {
    await liveStripe.prices.update(
      existingProduct.stripePriceId,
      {
        active: false
      }
    );
  } catch (archiveError) {
    console.error(
      "Catalog updated, but unable to archive previous Stripe Price:",
      archiveError
    );
  }
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
      
      if (
  newStripePrice &&
  !catalogUpdated
) {        
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
let stripeProduct = null;
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

     stripeProduct =
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
  if (stripeProduct) {
    try {
      await liveStripe.products.update(
        stripeProduct.id,
        {
          active: false
        }
      );
    } catch (cleanupError) {
      console.error(
        "Unable to deactivate orphaned Stripe product:",
        cleanupError
      );
    }
  }
      
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

      product.published =
  true;

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

      const calculatedShippingProducts = [];

let smallPotteryPieceCount =
  0;

let brownSugarKeeperCount =
  0;

let regularFlatRateItemCount =
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

if (
  catalogProduct.fulfillmentStatus ===
    "pending-shipment" ||
  catalogProduct.fulfillmentStatus ===
    "shipped"
) {
  return res.status(400).json({
    error:
      `${catalogProduct.name} is no longer available.`
  });
}
        
        const availableStock = Number(catalogProduct.inventory);
        if (!Number.isSafeInteger(availableStock) || availableStock < quantity) {
          return res.status(409).json({
            code: "INSUFFICIENT_STOCK",
            error: `${catalogProduct.name} has only ${Math.max(0, availableStock || 0)} ready to ship.`,
            stripePriceId: catalogProduct.stripePriceId,
            productName: catalogProduct.name,
            requestedQuantity: quantity,
            availableQuantity: Number.isSafeInteger(availableStock)
              ? Math.max(0, availableStock) : 0
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

        // Defer unsupported shipping validation until the full
        // merchandise subtotal is known. Orders qualifying for
        // free shipping must not be blocked by a product's
        // calculated-shipping setting.
        if (shippingType === "calculated") {
          calculatedShippingProducts.push(catalogProduct.name);
        }

const isSmallPotteryPiece =
  catalogProduct.shipping
    ?.category ===
  "small-pottery-piece";

const isBrownSugarKeeper =
  catalogProduct.shipping?.category === "brown-sugar-keeper";
        
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

  if (isBrownSugarKeeper) {
  brownSugarKeeperCount += quantity;
} else if (isSmallPotteryPiece) {
  smallPotteryPieceCount +=
    quantity;
} else {
  regularFlatRateItemCount +=
    quantity;
}

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

      // Do not guess shipping charges on orders below the
      // free-shipping threshold. A validated newsletter code
      // also grants free shipping.
      if (
        calculatedShippingProducts.length > 0 &&
        merchandiseSubtotalCents < FREE_SHIPPING_THRESHOLD_CENTS &&
        !newsletterFreeShippingValid
      ) {
        return res.status(400).json({
          error:
            `${calculatedShippingProducts[0]} uses calculated shipping, which is not yet supported at checkout.`
        });
      }

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
  brownSugarKeeperCount > 0 &&
  regularFlatRateItemCount === 0 &&
  smallPotteryPieceCount === 0
) {
  // Brown sugar keepers only: $6 first, $2 each additional.
  shippingAmountCents =
    600 + Math.max(0, brownSugarKeeperCount - 1) * 200;
} else if (
  brownSugarKeeperCount > 0
) {
  // Mixed orders: retain the existing $5 additional-item rate
  // for other pottery, and charge $2 per keeper.
  const nonKeeperCount = flatRateItemCount - brownSugarKeeperCount;
  shippingAmountCents =
    highestFlatRateCents +
    Math.max(0, nonKeeperCount - 1) * ADDITIONAL_ITEM_SHIPPING_CENTS +
    brownSugarKeeperCount * 200;
} else if (
  regularFlatRateItemCount > 0
) {
  /*
   * Mixed cart or regular pottery:
   * use the normal combined-order rule.
   */
  shippingAmountCents =
    highestFlatRateCents +
    (
      Math.max(
        0,
        flatRateItemCount - 1
      ) *
      ADDITIONAL_ITEM_SHIPPING_CENTS
    );
  
} else if (
  smallPotteryPieceCount > 0
) {
  /*
   * Cart contains only small pottery pieces:
   * $6 for the first piece,
   * plus $1 for each additional piece.
   */
  shippingAmountCents =
    600 +
    (
      Math.max(
        0,
        smallPotteryPieceCount - 1
      ) *
      100
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


/*
 * Made to Order requests
 * Customer PII is AES-256-GCM encrypted before it reaches GitHub.
 * Set MTO_ENCRYPTION_KEY to 64 hex characters in Render.
 * Optional notification: RESEND_API_KEY and MTO_NOTIFICATION_FROM.
 */
const MTO_FILE_PATH = "private-data/made-to-order.enc.json";
const MTO_STATUSES = new Set(["pending-review", "estimate-proposed", "declined", "awaiting-payment", "paid-ready-for-production", "in-production", "completed"]);
const mtoHeaders = token => ({
  Accept: "application/vnd.github+json",
  Authorization: "Bearer " + token,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "garden-shed-clay-mto",
  "Content-Type": "application/json"
});
function mtoKey() {
  const value = process.env.MTO_ENCRYPTION_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error("MTO_ENCRYPTION_KEY must be 64 hexadecimal characters.");
  return Buffer.from(value, "hex");
}
function mtoEncrypt(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", mtoKey(), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return JSON.stringify({version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: payload.toString("base64")}) + "\n";
}
function mtoDecrypt(payload) {
  const obj = JSON.parse(payload);
  if (obj.version !== 1) throw new Error("Unsupported request file version.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", mtoKey(), Buffer.from(obj.iv, "base64"));
  decipher.setAuthTag(Buffer.from(obj.tag, "base64"));
  const result = JSON.parse(Buffer.concat([decipher.update(Buffer.from(obj.data, "base64")), decipher.final()]).toString("utf8"));
  if (!Array.isArray(result)) throw new Error("Invalid request data.");
  return result;
}
async function mtoRead() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not configured.");
  const url = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + MTO_FILE_PATH + "?ref=" + GITHUB_BRANCH;
  const response = await fetch(url, {headers: mtoHeaders(token), cache: "no-store"});
  if (response.status === 404) return {items: [], sha: null};
  if (!response.ok) throw new Error("Request store unavailable: " + response.status);
  const file = await response.json();
  return {items: mtoDecrypt(Buffer.from(file.content.replace(/\\s/g, ""), "base64").toString("utf8")), sha: file.sha};
}
async function mtoWrite(items, sha, message) {
  const token = process.env.GITHUB_TOKEN;
  const url = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + MTO_FILE_PATH;
  const body = {message, content: Buffer.from(mtoEncrypt(items)).toString("base64"), branch: GITHUB_BRANCH};
  if (sha) body.sha = sha;
  const response = await fetch(url, {method: "PUT", headers: mtoHeaders(token), body: JSON.stringify(body)});
  if (response.status === 409 || response.status === 422) return false;
  if (!response.ok) throw new Error("Request store write failed: " + response.status);
  return true;
}
async function mtoMutate(change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const {items, sha} = await mtoRead();
    const result = change(items);
    if (await mtoWrite(items, sha, "Update encrypted Made to Order requests")) return result;
  }
  throw new Error("Concurrent request update; please retry.");
}
async function mtoNotify(request) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MTO_NOTIFICATION_FROM;
  if (!apiKey || !from) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {Authorization: "Bearer " + apiKey, "Content-Type": "application/json"},
    body: JSON.stringify({
      from, to: ["lester@gardenshedclay.com"],
      subject: (request.type === "international-shipping" ? "International shipping inquiry " : "Made to Order request ") + request.id,
      text: (request.type === "international-shipping" ? "An international shipping inquiry is awaiting review." : "A Made to Order inquiry is awaiting review.") + "\n\nItem: " + request.productName +
        "\nQuantity: " + request.quantity + "\nCustomer: " + request.name +
        "\nEmail: " + request.email + "\n\nReview it in the Garden Shed Clay admin."
    })
  });
  return response.ok;
}
const mtoRequestRate = new Map();
app.post("/api/made-to-order-requests", async (req, res) => {
  try {
    mtoKey();
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const recent = (mtoRequestRate.get(ip) || []).filter(t => now - t < 3600000);
    if (recent.length >= 5) return res.status(429).json({error: "Too many requests. Please try again later."});
    recent.push(now);
    mtoRequestRate.set(ip, recent);
    if (mtoRequestRate.size > 2000) for (const [key, values] of mtoRequestRate) {
      if (values.every(t => now - t >= 3600000)) mtoRequestRate.delete(key);
    }
    const input = req.body || {};
    // Honeypot: do not store automated submissions.
    if (input.website) return res.status(202).json({success: true});
    const name = String(input.name || "").trim().slice(0, 120);
    const email = String(input.email || "").trim().toLowerCase().slice(0, 254);
    const productId = String(input.productId || "").trim().slice(0, 120);
    const quantity = Number(input.quantity);
    const details = String(input.details || "").trim().slice(0, 2000);
    const desiredTiming = String(input.desiredTiming || "").trim().slice(0, 250);
    if (!name || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || !productId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
      return res.status(400).json({error: "Please enter your name, valid email, item, and a quantity from 1 to 100."});
    }
    const catalogResponse = await fetch("https://raw.githubusercontent.com/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/" + GITHUB_BRANCH + "/products.json", {cache: "no-store"});
    if (!catalogResponse.ok) throw new Error("Catalog unavailable.");
    const catalogPayload = await catalogResponse.json();
    const products = Array.isArray(catalogPayload) ? catalogPayload : catalogPayload.products;
    const product = (products || []).find(p => p && (p.id === productId || p.slug === productId));
    if (!product) return res.status(400).json({error: "That item is no longer in the catalog."});
    const request = {
      id: "MTO-" + crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      name, email, productId, productName: String(product.name || product.title || productId),
      quantity, details, desiredTiming, status: "pending-review", estimateReference: "",
      proposedPrice: null, proposedTiming: "", ownerNotes: "", customerApprovedAt: null,
      paymentConfirmedAt: null, notificationSent: false
    };
    await mtoMutate(items => {items.push(request); return request.id;});
    // Notification failure does not invalidate a safely stored request.
    try {
      if (await mtoNotify(request)) {
        await mtoMutate(items => {const saved = items.find(x => x.id === request.id); if (saved) saved.notificationSent = true;});
      }
    } catch (error) { console.error("Made to Order notification failed:", error); }
    return res.status(201).json({success: true, requestId: request.id, message: "Request received for studio review. This is not an order or a payment."});
  } catch (error) {
    console.error("Made to Order request error:", error);
    return res.status(503).json({error: "Unable to save your request. Please try again later or email the studio."});
  }
});

/* International shipping inquiries: encrypted storage, no checkout or stock mutation. */
app.post("/api/international-shipping-inquiries", async (req,res) => {
  try {
    mtoKey();
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const recent = (mtoRequestRate.get(ip) || []).filter(t => now-t < 3600000);
    if (recent.length >= 5) return res.status(429).json({error:"Too many requests. Please try again later."});
    recent.push(now);
    mtoRequestRate.set(ip,recent);
    const input = req.body || {};
    if (input.website) return res.status(202).json({success:true});
    const name = String(input.name || "").trim().slice(0,120);
    const email = String(input.email || "").trim().toLowerCase().slice(0,254);
    const country = String(input.country || "").trim().slice(0,100);
    const postalCode = String(input.postalCode || "").trim().slice(0,120);
    const notes = String(input.notes || "").trim().slice(0,1500);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !country || !postalCode ||
        !Array.isArray(input.items) || !input.items.length || input.items.length > 30) {
      return res.status(400).json({error:"Enter your contact details, destination and pottery selections."});
    }
    const response = await fetch("https://raw.githubusercontent.com/"+GITHUB_OWNER+"/"+GITHUB_REPO+"/"+GITHUB_BRANCH+"/products.json",{cache:"no-store"});
    if (!response.ok) throw new Error("Catalog unavailable");
    const payload = await response.json();
    const catalog = Array.isArray(payload) ? payload : payload.products;
    const items = input.items.map(item => {
      const id = String(item?.id || "").trim();
      const quantity = Number(item?.quantity);
      if (!id || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) return null;
      const product = (catalog || []).find(p => p && (String(p.id) === id || String(p.slug) === id));
      if (!product) return null;
      return {productId:String(product.id || product.slug),productName:String(product.name || product.title || id),quantity};
    });
    if (items.some(item => !item) || new Set(items.map(item=>item.productId)).size !== items.length) {
      return res.status(400).json({error:"An item in your cart is unavailable. Please refresh and try again."});
    }
    const request = {
      id:"INT-"+crypto.randomUUID(),type:"international-shipping",createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString(),name,email,country,postalCode,notes,items,
      productName:items.map(item=>item.productName).join(", "),quantity:items.reduce((n,item)=>n+item.quantity,0),
      status:"pending-review",estimateReference:"",proposedPrice:null,proposedTiming:"",
      ownerNotes:"",customerApprovedAt:null,paymentConfirmedAt:null,notificationSent:false
    };
    await mtoMutate(all => {all.push(request);return request.id;});
    try {
      if (await mtoNotify(request)) {
        await mtoMutate(all => {const saved=all.find(item=>item.id===request.id);if(saved)saved.notificationSent=true;});
      }
    } catch(error) {console.error("International inquiry notification failed:",error);}
    return res.status(201).json({success:true,requestId:request.id,message:"Inquiry received. No payment or order created."});
  } catch(error) {
    console.error("International inquiry error:",error);
    return res.status(503).json({error:"Unable to save your inquiry. Please try again or email the studio."});
  }
});

app.get("/api/admin/made-to-order-requests", requireAdmin, async (req, res) => {
  try {return res.json({requests: (await mtoRead()).items});}
  catch (error) {console.error("MTO admin read:", error); return res.status(503).json({error: "Unable to load requests."});}
});
app.patch("/api/admin/made-to-order-requests/:id", requireAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || "");
    if (!MTO_STATUSES.has(status)) return res.status(400).json({error: "Invalid request status."});
    // Payment and customer acceptance must be independently verified; this endpoint cannot assert either.
    if (["paid-ready-for-production", "in-production", "completed"].includes(status)) {
      return res.status(409).json({error: "Payment/approval verification is not implemented. Do not mark requests ready for production here."});
    }
    const id = String(req.params.id);
    const updated = await mtoMutate(items => {
      const request = items.find(x => x.id === id);
      if (!request) return null;
      if (request.paymentSessionId || request.paymentConfirmedAt) throw new Error("Payment-linked inquiries cannot be manually reclassified.");
      request.status = status;
      request.ownerNotes = String(req.body.ownerNotes || "").slice(0, 2000);
      request.proposedTiming = String(req.body.proposedTiming || "").slice(0, 250);
      request.estimateReference = String(req.body.estimateReference || "").slice(0, 150);
      const price = req.body.proposedPrice;
      request.proposedPrice = price === null || price === undefined || price === "" ? null : Number(price);
      if (request.proposedPrice !== null && (!Number.isFinite(request.proposedPrice) || request.proposedPrice < 0)) throw new Error("Invalid proposed price.");
      request.updatedAt = new Date().toISOString();
      return request;
    });
    if (!updated) return res.status(404).json({error: "Request not found."});
    return res.json({success: true, request: updated});
  } catch (error) {console.error("MTO admin update:", error); return res.status(503).json({error: "Unable to update request."});}
});


/*
 * International quote preparation (PR #94).
 * Deliberately disabled for live payment until webhook and inventory integration
 * have been end-to-end tested. No customer-facing payment URL is issued here.
 */
const INTERNATIONAL_QUOTE_STATUSES = new Set(["pending-review","estimate-proposed","declined"]);
app.post("/api/admin/international-quotes/:id/prepare", requireAdmin, async (req,res) => {
  try {
    const requestId = String(req.params.id || "");
    const countryCode = String(req.body?.countryCode || "").trim().toUpperCase();
    const shippingCents = Number(req.body?.shippingCents);
    const expiresAt = String(req.body?.expiresAt || "");
    if (!/^[A-Z]{2}$/.test(countryCode) || countryCode === "US" ||
        !Number.isSafeInteger(shippingCents) || shippingCents < 0 || shippingCents > 10000000 ||
        !/^\\d{4}-\\d{2}-\\d{2}$/.test(expiresAt) ||
        Date.parse(expiresAt + "T23:59:59Z") <= Date.now()) {
      return res.status(400).json({error:"Enter a non-US two-letter country code, shipping in cents, and a future expiration date."});
    }
    const store = await mtoRead();
    const inquiry = store.items.find(item => item.id === requestId && item.type === "international-shipping");
    if (!inquiry) return res.status(404).json({error:"International inquiry not found."});
    if (!INTERNATIONAL_QUOTE_STATUSES.has(inquiry.status) || inquiry.paymentConfirmedAt || inquiry.paymentSessionId) {
      return res.status(409).json({error:"This inquiry is not eligible for a new quote. Review its current state."});
    }
    const response = await fetch("https://raw.githubusercontent.com/"+GITHUB_OWNER+"/"+GITHUB_REPO+"/"+GITHUB_BRANCH+"/products.json",{cache:"no-store"});
    if (!response.ok) throw new Error("Catalog unavailable");
    const payload = await response.json();
    const catalog = Array.isArray(payload) ? payload : payload.products;
    const items = [];
    let merchandiseSubtotalCents = 0;
    for (const requested of inquiry.items || []) {
      const product = (catalog || []).find(p => p && String(p.id || p.slug) === String(requested.productId));
      if (!product || !product.stripePriceId || !Number.isSafeInteger(requested.quantity) || requested.quantity < 1 ||
          !Number.isSafeInteger(product.inventory) || product.inventory < requested.quantity) {
        return res.status(409).json({error:"Product, price or inventory changed. Review the inquiry before preparing a quote."});
      }
      // Price comes from Stripe, never from customer input.
      const price = await liveStripe.prices.retrieve(product.stripePriceId);
      if (!price.active || price.currency !== "usd" || !Number.isSafeInteger(price.unit_amount) || price.unit_amount < 1) {
        return res.status(409).json({error:"A product has an unavailable or unsupported Stripe price."});
      }
      merchandiseSubtotalCents += price.unit_amount * requested.quantity;
      items.push({productId:requested.productId,productName:requested.productName,
        stripePriceId:price.id,quantity:requested.quantity,unitAmountCents:price.unit_amount});
    }
    if (!items.length || !Number.isSafeInteger(merchandiseSubtotalCents)) {
      return res.status(409).json({error:"Quote cannot be prepared from this inquiry."});
    }
    const quote = {
      countryCode, shippingCents, merchandiseSubtotalCents,
      totalCents:merchandiseSubtotalCents + shippingCents,
      items, expiresAt, preparedAt:new Date().toISOString(),
      status:"prepared-not-payable"
    };
    const updated = await mtoMutate(all => {
      const current = all.find(item=>item.id===requestId && item.type==="international-shipping");
      if (!current || !INTERNATIONAL_QUOTE_STATUSES.has(current.status) || current.paymentSessionId || current.paymentConfirmedAt) return null;
      current.quote = quote;
      current.status = "estimate-proposed";
      current.updatedAt = new Date().toISOString();
      return current;
    });
    if (!updated) return res.status(409).json({error:"Inquiry changed while preparing the quote. Reload and retry."});
    return res.json({success:true,quote,notice:"Quote prepared for owner review only. No Stripe session or payment link has been created."});
  } catch(error) {
    console.error("International quote preparation error:",error);
    return res.status(503).json({error:"Unable to prepare the quote. No payment was created."});
  }
});


/*
 * PR #95: owner-controlled international payment links.
 * Feature stays OFF until end-to-end webhook and fulfillment tests are approved.
 */
const INTERNATIONAL_PAYMENT_COUNTRIES = new Set(
  "AU AT BE CA CH CZ DE DK ES FI FR GB GR HR HU IE IL IT JP LU MX NL NO NZ PL PT SE SG SK SI".split(" ")
);
app.post("/api/admin/international-quotes/:id/payment-link", requireAdmin, async (req,res) => {
  try {
    if (process.env.ENABLE_INTERNATIONAL_STRIPE_PAYMENTS !== "true") {
      return res.status(409).json({error:"International Stripe payments are not activated. Complete payment and webhook validation first."});
    }
    const id = String(req.params.id || "");
    const {items} = await mtoRead();
    const inquiry = items.find(x => x.id === id && x.type === "international-shipping");
    if (!inquiry || !inquiry.quote) return res.status(404).json({error:"Prepared international quote not found."});
    const q = inquiry.quote;
    if (inquiry.status !== "estimate-proposed" || inquiry.paymentSessionId || inquiry.paymentConfirmedAt ||
        q.status !== "prepared-not-payable" || !INTERNATIONAL_PAYMENT_COUNTRIES.has(q.countryCode) ||
        Date.parse(q.expiresAt + "T23:59:59Z") <= Date.now()) {
      return res.status(409).json({error:"Quote is expired, already linked, or destination is unsupported. Prepare a new quote."});
    }
    if (!Number.isSafeInteger(q.shippingCents) || q.shippingCents < 0 ||
        !Number.isSafeInteger(q.totalCents) || !Array.isArray(q.items) || !q.items.length) {
      return res.status(409).json({error:"Invalid quote totals."});
    }
    const response = await fetch("https://raw.githubusercontent.com/"+GITHUB_OWNER+"/"+GITHUB_REPO+"/"+GITHUB_BRANCH+"/products.json",{cache:"no-store"});
    if (!response.ok) throw new Error("Catalog unavailable");
    const catalogPayload = await response.json();
    const catalog = Array.isArray(catalogPayload) ? catalogPayload : catalogPayload.products;
    let subtotal = 0;
    const lineItems = [];
    for (const item of q.items) {
      const product = (catalog || []).find(p => p && String(p.id || p.slug) === String(item.productId));
      if (!product || product.stripePriceId !== item.stripePriceId ||
          !Number.isSafeInteger(product.inventory) || product.inventory < item.quantity) {
        return res.status(409).json({error:"Product or inventory changed. Prepare a new quote."});
      }
      const price = await liveStripe.prices.retrieve(item.stripePriceId);
      if (!price.active || price.currency !== "usd" || price.unit_amount !== item.unitAmountCents) {
        return res.status(409).json({error:"Price changed. Prepare a new quote."});
      }
      subtotal += price.unit_amount * item.quantity;
      lineItems.push({price:price.id,quantity:item.quantity});
    }
    if (subtotal !== q.merchandiseSubtotalCents || subtotal + q.shippingCents !== q.totalCents) {
      return res.status(409).json({error:"Quote totals changed. Prepare a new quote."});
    }
    // Deterministic idempotency key prevents duplicate Stripe sessions after a write failure.
    const quoteHash = crypto.createHash("sha256").update(JSON.stringify({id,quote:q})).digest("hex");
    const stripeExpiry = Math.min(
      Math.floor(Date.parse(q.expiresAt+"T23:59:59Z") / 1000),
      Math.floor(Date.now()/1000) + 24*3600
    );
    if (stripeExpiry < Math.floor(Date.now()/1000) + 1800) {
      return res.status(409).json({error:"Quote expires too soon to issue a payment link."});
    }
    const session = await liveStripe.checkout.sessions.create({
      mode:"payment",
      line_items:lineItems,
      customer_email:inquiry.email,
      client_reference_id:id,
      success_url:"https://gardenshedclay.com/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url:"https://gardenshedclay.com/cart.html",
      expires_at:stripeExpiry,
      shipping_address_collection:{allowed_countries:[q.countryCode]},
      shipping_options:[{shipping_rate_data:{
        type:"fixed_amount",
        fixed_amount:{amount:q.shippingCents,currency:"usd"},
        display_name:"Approved international shipping"
      }}],
      metadata:{
        internationalInquiryId:id,
        internationalQuoteHash:quoteHash,
        merchandiseSubtotalCents:String(subtotal),
        shippingAmountCents:String(q.shippingCents)
      }
    },{idempotencyKey:"gsc-int-"+quoteHash});
    const updated = await mtoMutate(all => {
      const current = all.find(x=>x.id===id && x.type==="international-shipping");
      if (!current || current.paymentSessionId || current.paymentConfirmedAt ||
          current.status !== "estimate-proposed" ||
          crypto.createHash("sha256").update(JSON.stringify({id,quote:current.quote})).digest("hex") !== quoteHash) return null;
      current.paymentSessionId = session.id;
      current.paymentUrl = session.url;
      current.paymentQuoteHash = quoteHash;
      current.paymentExpiresAt = new Date(stripeExpiry*1000).toISOString();
      current.status = "awaiting-payment";
      current.updatedAt = new Date().toISOString();
      return current;
    });
    if (!updated) {
      await liveStripe.checkout.sessions.expire(session.id).catch(err=>console.error("Could not expire conflicting international session:",err));
      return res.status(409).json({error:"Inquiry changed; Stripe payment session was cancelled. Reload and retry."});
    }
    return res.json({success:true,url:session.url,expiresAt:updated.paymentExpiresAt,
      notice:"Share this link with the customer only after confirming the quote."});
  } catch(error) {
    console.error("International payment link error:",error);
    return res.status(503).json({error:"Unable to create payment link. Review inquiry status before retrying."});
  }
});

app.listen(PORT, () => {
  console.log(
    `Garden Shed Clay checkout service listening on port ${PORT}`
  );
});
