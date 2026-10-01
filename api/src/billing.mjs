function priceForPlan(planId) {
  const prices = {
    starter: process.env.STRIPE_PRICE_STARTER,
    pro: process.env.STRIPE_PRICE_PRO,
    scale: process.env.STRIPE_PRICE_SCALE
  };
  return prices[planId] || "";
}

export async function createSubscriptionCheckout({ userId, email, planId, orderId }) {
  const key = process.env.STRIPE_SECRET_KEY || "";
  const baseUrl = process.env.PUBLIC_BASE_URL || "";
  const price = priceForPlan(planId);

  if (process.env.ENABLE_PAID_CHECKOUT !== "true" || !key || !price || !baseUrl) {
    const error = new Error("Paid checkout is not enabled");
    error.code = "CHECKOUT_DISABLED";
    throw error;
  }

  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("success_url", baseUrl + "/panel.html?checkout=success&order=" + encodeURIComponent(orderId));
  form.set("cancel_url", baseUrl + "/index.html#plans");
  form.set("client_reference_id", orderId);
  form.set("customer_email", email);
  form.set("line_items[0][price]", price);
  form.set("line_items[0][quantity]", "1");
  form.set("metadata[user_id]", userId);
  form.set("metadata[plan_id]", planId);
  form.set("metadata[order_id]", orderId);
  form.set("subscription_data[metadata][user_id]", userId);
  form.set("subscription_data[metadata][plan_id]", planId);
  form.set("subscription_data[metadata][order_id]", orderId);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error((data && data.error && data.error.message) || "Stripe checkout session creation failed");
    error.statusCode = response.status;
    throw error;
  }
  return data;
}
