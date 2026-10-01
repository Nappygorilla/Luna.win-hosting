export async function sendTransactionalEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.MAIL_FROM || "";
  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("Transactional email is not configured");
    console.log("[DEV EMAIL]", { to, subject, text });
    return { sent: false, dev: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to: [to], subject, text })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Email delivery failed");
  return { sent: true, id: data.id };
}
