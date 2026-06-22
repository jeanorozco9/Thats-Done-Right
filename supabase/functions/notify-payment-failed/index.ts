const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";

    const { name, email, address, amount, lead_id } = await req.json();

    const html = `
      <h2 style="color:#880e4f;margin-top:0;">⚠️ Payment Failed — Action Required</h2>
      <p style="color:#374151;">A client's payment could not be processed. They have been removed from the contractor schedule until the balance is resolved.</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px;margin-top:1rem;">
        <tr><td style="padding:8px 12px;font-weight:600;color:#555;background:#fce4ec;">Client</td><td style="padding:8px 12px;background:#fce4ec;">${name || "—"}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;color:#555;">Email</td><td style="padding:8px 12px;">${email || "—"}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;color:#555;background:#fce4ec;">Address</td><td style="padding:8px 12px;background:#fce4ec;">${address || "—"}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;color:#555;">Amount Owed</td><td style="padding:8px 12px;font-weight:700;color:#880e4f;">${amount ? "$" + amount : "—"}</td></tr>
        ${lead_id ? `<tr><td style="padding:8px 12px;font-weight:600;color:#555;background:#fce4ec;">Lead ID</td><td style="padding:8px 12px;background:#fce4ec;">${lead_id}</td></tr>` : ""}
      </table>
      <p style="margin-top:1.5rem;font-size:13px;color:#555;">
        <strong>Next steps:</strong><br/>
        1. Contact the client to update their payment method.<br/>
        2. Retry the invoice from the admin dashboard once resolved.<br/>
        3. Service will resume automatically once payment clears.
      </p>
      <p style="margin-top:1rem;">
        <a href="https://thatsdoneright.com/admin.html" style="display:inline-block;background:#880e4f;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px;">Open Admin Dashboard</a>
      </p>
      <hr style="margin:1.5rem 0;border:none;border-top:1px solid #f0f0f0;"/>
      <p style="font-size:11px;color:#9ca3af;">That's Done Right · thatsdoneright.com</p>
    `;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "That's Done Right <noreply@thatsdoneright.com>",
        to: ["team@thatsdoneright.com"],
        subject: `⚠️ Payment Failed — ${name || email || "Unknown Client"} (${address || "No address"})`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error(`Resend error: ${errText}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-payment-failed error:", err);
    return new Response(JSON.stringify({ error: String(err.message) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
