import express from "express";
import cors from "cors";
import Stripe from "stripe";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Garden Shed Clay Checkout",
    message: "Checkout service is running."
  });
});

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Cart items are required."
      });
    }

    const lineItems = items.map((item) => {
      if (!item.stripePriceId) {
        throw new Error(
          `Missing Stripe Price ID for ${item.name || "a cart item"}.`
        );
      }

      return {
        price: item.stripePriceId,
        quantity: Number(item.quantity || 1)
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      success_url:
        "https://gardenshedclay.com/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url:
        "https://gardenshedclay.com/cart.html",
      billing_address_collection: "auto",
      shipping_address_collection: {
        allowed_countries: ["US"]
      }
    });

    res.json({
      url: session.url
    });
  } catch (error) {
    console.error(
      "Unable to create Stripe Checkout Session:",
      error
    );

    res.status(500).json({
      error: "Unable to start checkout."
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `Garden Shed Clay checkout service listening on port ${PORT}`
  );
});
