# Avery 5815 shared label queue — implementation contract

Status: **design and acceptance criteria only; no production behavior changed.**

## Non-regression
- Add to existing Admin. Keep existing packing worksheet, customer packing slip, 8160 mailing/order labels, 5815 single-label entry, customer import/edit, open/completed order sections, and Mark Shipped.
- Never modify order fulfillment, inventory, customer records, or consent as a side effect of adding/printing a label.
- Do not publish or merge until the new downloadable PDF passes a physical Avery 5815 alignment test.

## Queue
- Accept entries from an order, a saved customer, or manual address entry; record source and quantity (1–100).
- A missing shipping address must not prevent queue entry: mark it incomplete and require user to select an existing address or provide a complete address before export.
- Show each recipient and its editable quantity, allow remove, clear, and reorder; do not silently deduplicate recipients.
- Validate name, address1, city, state/province, postal code; optional address2 and country. Display errors without generating a partial PDF.
- Select starting position 1–8 on first sheet; fill left-to-right, top-to-bottom, eight labels per sheet; paginate as necessary.
- Generate a **downloadable PDF**, not a popup print window; support one job containing order and customer entries.
- Warn that partially used label sheets must be fed in the correct orientation and printed at Actual Size/100%.

## Approved visual specification
- Match the physically tested `GSC_Avery_5815_plain_paper_test_v3.pdf`: US Letter, 2 columns × 4 rows, each 4 × 2.5 inches; sheet left/right 0.25in, top/bottom 0.5in.
- Centered **black** Garden Shed Clay logo with return address, thin black divider, larger left-aligned EB Garamond delivery address.
- Ensure up to five address lines do not clip, including descenders, and retain a safe perimeter.
- Bundle logo and fonts reliably; no repeated upload and no runtime dependency on a third-party font/image URL.

## Validation
1. Two copies from open order A and two from customer B occupy positions 1–4.
2. Start position 5 fills 5–8; next copy starts page 2, position 1.
3. Incomplete special-commission order can be queued, but export blocked until address completed.
4. Print/export never changes order status, inventory, customer details, or consent.
5. Existing controls still function and 8160 behavior is unchanged.
6. Test PDF against physical Avery 5815 sheets at 100%, including 3-, 4-, and 5-line addresses.

## Release plan
1. Build queue UI and address-validation state as an additive component.
2. Implement and locally validate deterministic PDF generation with bundled artwork and font.
3. Connect new queue to Orders and Customers without replacing existing buttons.
4. Review draft PR, test physical print, then separately approve merge/deployment.
