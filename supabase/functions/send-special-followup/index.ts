const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

    const body = await req.json().catch(() => ({}));
    const testEmail: string | null = body.test_email ?? null;

    // If test_email is provided, only fetch that one record (ignores followup flags so no SQL changes needed)
    const query = testEmail
      ? `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(testEmail)}&select=id,name,email,price,lot_size,home_size`
      : `${SUPABASE_URL}/rest/v1/leads?followup1_sent=eq.true&followup2_sent=eq.true&followup3_sent=eq.true&followup_special=eq.false&status=neq.booked&select=id,name,email,price,lot_size,home_size`;

    const leadsRes = await fetch(
      query,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    const allLeads = await leadsRes.json();

    if (!Array.isArray(allLeads) || allLeads.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No eligible leads found." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // $39.99 first-mow offer is only honored for lawns under 6,000 sqft (lot_size minus home_size)
    const leads = allLeads.filter((lead: any) => {
      if (!lead.lot_size || !lead.home_size) return false;
      const yardSize = lead.lot_size - lead.home_size;
      return yardSize > 0 && yardSize < 6000;
    });

    if (leads.length === 0) {
      return new Response(JSON.stringify({ sent: 0, total: allLeads.length, message: "No leads with lawns under 6,000 sqft." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    const errors: string[] = [];

    for (const lead of leads) {
      if (!lead.email) continue;

      const firstName = lead.name ? lead.name.split(" ")[0] : "there";
      const quotedPrice = lead.price ? `$${lead.price}` : "your quoted rate";

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>A special offer just for you — That's Done Right</title>
<link href="https://fonts.googleapis.com/css2?family=Pacifico&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;">

  <!-- HERO: Sky -->
  <tr>
    <td bgcolor="#29B5D8" style="padding:20px 28px 0;text-align:right;font-size:58px;line-height:1;">&#x2600;&#xFE0F;</td>
  </tr>
  <tr>
    <td bgcolor="#29B5D8" style="padding:0 28px 6px;font-size:32px;line-height:1;">&#x26C5;</td>
  </tr>
  <tr>
    <td bgcolor="#29B5D8" style="padding:8px 24px 24px;text-align:center;">
      <div style="font-family:'Pacifico',cursive;font-size:42px;color:#ffffff;line-height:1.2;text-shadow:2px 2px 0 rgba(0,60,0,0.25);">That&#39;s Done Right</div>
      <div style="font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.88);letter-spacing:3px;margin-top:10px;font-weight:bold;">LAWN CARE &nbsp;&middot;&nbsp; KATY &amp; CROSBY TX</div>
    </td>
  </tr>

  <!-- Lawn photo (cropped to grass section) -->
  <tr>
    <td style="padding:0;line-height:0;">
      <div style="height:130px;overflow:hidden;font-size:0;line-height:0;">
        <img src="https://thatsdoneright.com/hero-bkg-2026-07-04-v2.jpg" alt="Fresh mowed lawn" width="520" style="display:block;width:100%;max-width:520px;margin-top:-162px;"/>
      </div>
    </td>
  </tr>

  <!-- Promo band -->
  <tr>
    <td bgcolor="#EAF3DE" style="padding:28px 40px 24px;text-align:center;border-bottom:1px solid #d8eed8;">
      <div style="display:inline-block;background:#c8e6c9;color:#1a6b1a;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-radius:100px;padding:5px 16px;margin-bottom:14px;">Special offer &mdash; just for you</div>
      <div style="font-size:15px;color:#374151;margin-bottom:10px;">Hey ${firstName}, we have something we think you&#39;ll love.</div>
      <div style="font-size:68px;font-weight:800;color:#111827;letter-spacing:-3px;line-height:1;">$39.99</div>
      <div style="font-size:14px;color:#6b7280;margin-top:8px;">Your first mow &mdash; then just $49.99 + tax per visit</div>
    </td>
  </tr>

  <!-- Stat strip -->
  <tr>
    <td bgcolor="#f9fafb" style="padding:18px 40px;border-bottom:1px solid #f0f0f0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#9ca3af;text-decoration:line-through;">$50+</div>
            <div style="font-size:10px;color:#9ca3af;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-top:3px;">National avg</div>
          </td>
          <td style="text-align:center;font-size:20px;color:#d1d5db;">&rarr;</td>
          <td style="text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#16a34a;">$39.99</div>
            <div style="font-size:10px;color:#9ca3af;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-top:3px;">Your first mow</div>
          </td>
          <td style="text-align:center;font-size:20px;color:#d1d5db;">&rarr;</td>
          <td style="text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#111827;">$49.99</div>
            <div style="font-size:10px;color:#9ca3af;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-top:3px;">+ tax after promo</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Benefits -->
  <tr>
    <td style="padding:24px 40px 8px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:40px;font-size:20px;vertical-align:top;padding-top:2px;">&#x1F6E1;&#xFE0F;</td>
            <td style="font-size:14px;color:#374151;font-weight:500;line-height:1.5;">Vetted local lawn care professional assigned to your home</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:40px;font-size:20px;vertical-align:top;padding-top:2px;">&#x1F4B3;</td>
            <td style="font-size:14px;color:#374151;font-weight:500;line-height:1.5;">Pay only after service is complete &mdash; no upfront charges</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:40px;font-size:20px;vertical-align:top;padding-top:2px;">&#x1F4C5;</td>
            <td style="font-size:14px;color:#374151;font-weight:500;line-height:1.5;">No contracts &mdash; skip, pause, or cancel anytime</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:10px 0;">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:40px;font-size:20px;vertical-align:top;padding-top:2px;">&#x1F4CD;</td>
            <td style="font-size:14px;color:#374151;font-weight:500;line-height:1.5;">Serving Katy TX, Crosby TX &amp; Greater Houston area</td>
          </tr></table>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- CTA -->
  <tr>
    <td style="padding:20px 40px 24px;">
      <a href="https://thatsdoneright.com?promo=first-mow" style="display:block;background:#16a34a;color:#ffffff;text-decoration:none;text-align:center;font-size:16px;font-weight:700;padding:17px;border-radius:12px;">Get my $39.99 first mow &nbsp;&rarr;</a>
    </td>
  </tr>

  <!-- Terms -->
  <tr>
    <td style="padding:0 40px 28px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;margin-bottom:8px;">Offer terms</div>
      <div style="font-size:12px;color:#9ca3af;line-height:1.7;">
        &middot; Requires a 3-cut minimum commitment. $49.99 + tax per visit after visit 1.<br/>
        &middot; Valid for lawns under 6,000 sqft.<br/>
        &middot; If grass exceeds 9 inches, a one-time long-grass fee (up to 100% of visit price) may apply.<br/>
        &middot; Valid for new customers only. One per household.
      </div>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:18px 40px;border-top:1px solid #f0f0f0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-family:'Pacifico',cursive;font-size:15px;color:#16a34a;">That&#39;s Done Right</td>
          <td style="text-align:right;font-size:11px;color:#9ca3af;">thatsdoneright.com</td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "That's Done Right <noreply@thatsdoneright.com>",
          to: [lead.email],
          subject: `${firstName}, here's something we've never offered before 🌿`,
          html,
        }),
      });

      // Pause 500ms between sends to stay within Resend rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (emailRes.ok) {
        // Mark followup_special as sent
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ followup_special: true }),
        });
        sent++;
      } else {
        const errText = await emailRes.text();
        errors.push(`${lead.email}: ${errText}`);
      }
    }

    return new Response(
      JSON.stringify({ sent, total: leads.length, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-special-followup error:", err);
    return new Response(JSON.stringify({ error: String(err.message) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
