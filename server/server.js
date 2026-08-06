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

app.listen(PORT, () => {
  console.log(
    `Garden Shed Clay checkout service listening on port ${PORT}`
  );
});
