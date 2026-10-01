function priceForPlan(planId) {
  const prices = {
    starter: process.env.STRIPE_PRICE_STARTER,
    pro: process.env.STRIPE_PRICE_PRO,
    scale: process.env.STRIPE_PRICE_SCALE
  };
  return prices[planId] || "";
}

async function stripeRequest(path, form) {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) throw new Error("Stripe is not configured");
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error((data && data.error && data.error.message) || "Stripe request failed");
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

export async function createSubscriptionCheckout({ userId, email, planId, orderId }) {
  const baseUrl = process.env.PUBLIC_BASE_URL || "";
  const price = priceForPlan(planId);

  if (process.env.ENABLE_PAID_CHECKOUT !== "true" || !baseUrl || !price) {
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
  return stripeRequest("checkout/sessions", form);
}

export async function createCustomerPortal({ customerId }) {
  const baseUrl = process.env.PUBLIC_BASE_URL || "";
  if (!customerId || !baseUrl) throw new Error("Billing portal is not configured");
  const form = new URLSearchParams();
  form.set("customer", customerId);
  form.set("return_url", baseUrl + "/panel.html");
  return stripeRequest("billing_portal/sessions", form);
}

export async function cancelSubscriptionAtPeriodEnd({ subscriptionId }) {
  if (!subscriptionId) throw new Error("Subscription is not configured");
  const form = new URLSearchParams();
  form.set("cancel_at_period_end", "true");
  return stripeRequest("subscriptions/" + encodeURIComponent(subscriptionId), form);
}
