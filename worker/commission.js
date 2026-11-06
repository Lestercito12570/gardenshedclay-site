// Garden Shed Clay commission inquiries. Sends only to a fixed, verified owner inbox.
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const emailPattern = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/commission-inquiry") {
      return env.ASSETS.fetch(request);
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "invalid_content_type" }, 415);
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).hostname !== url.hostname) return json({ error: "invalid_origin" }, 403);
    const size = Number(request.headers.get("content-length") || 0);
    if (size > 12000) return json({ error: "too_large" }, 413);
    let data;
    try {
      const raw = await request.text();
      if (raw.length > 12000) return json({ error: "too_large" }, 413);
      data = JSON.parse(raw);
    } catch { return json({ error: "invalid_json" }, 400); }
    if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "invalid_payload" }, 400);
    // Honeypot: silently accept spam without sending it.
    if (data.website) return json({ ok: true });
    const name = clean(data.customerName, 120);
    const customerEmail = clean(data.customerEmail, 254);
    const description = clean(data.description, 3000);
    const quantity = Number(data.quantity);
    const timeframe = clean(data.timeframe, 160);
    const budget = clean(data.budget, 160);
    if (!name || !emailPattern.test(customerEmail) || !description || !Number.isInteger(quantity) || quantity < 1 || quantity > 100 || data.acknowledged !== true) {
      return json({ error: "invalid_fields" }, 400);
    }
    if (!env.COMMISSION_EMAIL) {
      console.error("Commission email binding missing");
      return json({ error: "not_configured" }, 503);
    }
    const message = [
      "NEW SPECIAL COMMISSION INQUIRY — GARDEN SHED CLAY",
      "Name: " + name, "Email: " + customerEmail,
      "Quantity: " + quantity, "Preferred timeframe: " + (timeframe || "Not specified"),
      "Budget: " + (budget || "Not specified"), "",
      "Description:", description, "",
      "Customer acknowledged commission terms: Yes",
      "This is an inquiry only. No commission has been accepted or paid for.",
      "Please personally respond to the customer whether or not the commission can be accepted."
    ].join("\\n");
    try {
      await env.COMMISSION_EMAIL.send({
        from: "studio@gardenshedclay.com",
        to: "lester.morris@gmail.com",
        replyTo: customerEmail,
        subject: "Garden Shed Clay commission inquiry — " + name.replace(/[\\r\\n]/g, " "),
        text: message
      });
      return json({ ok: true });
    } catch (error) {
      console.error("Commission email send failed", error?.code || "unknown");
      return json({ error: "delivery_failed" }, 503);
    }
  }
};
