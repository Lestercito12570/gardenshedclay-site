# Made to Order request workflow (PR #91)

## Deployment requirements

**Do not publish the customer form until Render is configured.**

1. In the Render checkout service, add `MTO_ENCRYPTION_KEY` as a secret environment variable containing **64 random hexadecimal characters** (32 bytes). Generate it with `openssl rand -hex 32`. Never commit or share this key. Keep a secure backup; losing it makes existing requests unreadable. Rotating it requires migrating/decrypting existing data.
2. Existing `GITHUB_TOKEN` must have permission to write the repository contents.
3. For email alerts, configure `RESEND_API_KEY` and `MTO_NOTIFICATION_FROM` (a verified sending address in Resend). Without these, submissions are still saved and visible in the admin queue, but **no email notification is sent**.
4. Redeploy Render. The first successful request creates `private-data/made-to-order.enc.json` in GitHub. It contains **encrypted** request data, not readable customer information. Do not put plaintext personal data in GitHub issues or PRs.

## Customer workflow

When the cart exceeds ready-to-ship inventory, **Request additional pieces** opens an inline form. A successful POST returns a reference number and does **not** charge the customer or adjust the cart. The studio can decline any request. The request is not a backorder or accepted commission.

## Owner workflow

Visit the protected Render `/admin` page and scroll to **Made to Order Requests**. Review requests, record proposed timing and price, and save status. Estimates and invoices are **manually** sent through QuickBooks; saving a review does not send customer messages.

Statuses supported by the admin UI: pending review, estimate proposed, awaiting payment, declined. The API intentionally rejects setting paid/production/completed statuses because customer approval and payment verification are not yet implemented. **Never start work based only on a status field.**

## Validation

- Missing encryption key: public submission returns a safe error and does not claim success.
- With key set: submit an overstock inquiry; verify reference and protected admin queue.
- Verify customer email/name/details are **not** readable in the GitHub encrypted file.
- Confirm notification if Resend is configured; otherwise check admin queue manually.
- Review and save a proposed estimate reference and timing; ensure no email or payment is automatically sent.
- Verify ordinary Stripe checkout still only purchases ready-to-ship inventory.
- Verify rapid submissions are limited, and empty/invalid fields are rejected.

## Next phase

Customer-facing written acceptance of versioned final design/specifications, QuickBooks estimate/payment confirmation, and production authorization require a separate integration. No automatic payment or production commitment is implemented in #91.
