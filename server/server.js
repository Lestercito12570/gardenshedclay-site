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
 * Protected Garden Shed Clay Admin
 *
 * We will place admin.html inside the
 * server folder in the next step.
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
            mode: "payment",

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
        url: session.url
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
