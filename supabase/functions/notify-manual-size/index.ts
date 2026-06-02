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
    const { name, email, phone, address, lot_size, home_size, price, lead_id } =
      await req.json();

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";

    const html = `
      <h2>Manual Size Entry Alert</h2>
      <p>A client entered their own property size during the booking flow because their address was not found in our database.</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px;">
        <tr><td style="padding:6px 12px;font-weight:600;color:#555;">Name</td><td style="padding:6px 12px;">${name || "—"}</td></tr>
        <tr style="background:#f9f9f9;"><td style="padding:6px 12px;font-weight:600;color:#555;">Email</td><td style="padding:6px 12px;">${email || "—"}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:600;color:#555;">Phone</td><td style="padding:6px 12px;">${phone || "—"}</td></tr>
        <tr style="background:#f9f9f9;"><td style="padding:6px 12px;font-weight:600;color:#555;">Address</td><td style="padding:6px 12px;">${address || "—"}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:600;color:#555;">Lot Size</td><td style="padding:6px 12px;">${lot_size ? lot_size.toLocaleString() + " sqft" : "—"}</td></tr>
        <tr style="background:#f9f9f9;"><td style="padding:6px 12px;font-weight:600;color:#555;">Home Size</td><td style="padding:6px 12px;">${home_size ? home_size.toLocaleString() + " sqft" : "—"}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:600;color:#555;">Quoted Price</td><td style="padding:6px 12px;">$${price || "—"}/visit</td></tr>
        ${lead_id ? `<tr style="background:#f9f9f9;"><td style="padding:6px 12px;font-weight:600;color:#555;">Lead ID</td><td style="padding:6px 12px;">${lead_id}</td></tr>` : ""}
      </table>
      <p style="margin-top:1rem;font-size:13px;color:#888;">You may want to verify this address and add it to the properties database.</p>
    `;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "That's Done Right <noreply@thatsdoneright.com>",
        to: ["team@thatsdoneright.com"],
        subject: `Manual Size Entry — ${name || email || "Unknown"} (${address || "No address"})`,
        html,
      }),
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-manual-size error:", err);
    return new Response(JSON.stringify({ error: String(err.message) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
