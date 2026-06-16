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
      ? `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(testEmail)}&select=id,name,email,price`
      : `${SUPABASE_URL}/rest/v1/leads?followup1_sent=eq.true&followup2_sent=eq.true&followup3_sent=eq.true&followup_special=eq.false&status=neq.booked&select=id,name,email,price`;

    const leadsRes = await fetch(
      query,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    const leads = await leadsRes.json();

    if (!Array.isArray(leads) || leads.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No eligible leads found." }), {
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
<link href="https://fonts.googleapis.com/css2?family=Pacifico&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f3f4f6;font-family:'Inter',Arial,sans-serif;-webkit-font-smoothing:antialiased}
.outer{width:100%;background:#f3f4f6;padding:32px 16px}
.card{max-width:520px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden}
.hero{display:block;width:100%}
.promo-band{padding:36px 40px 28px;text-align:center;border-bottom:1px solid #f0f0f0}
.eyebrow{display:inline-block;background:#f0fdf4;color:#16a34a;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-radius:100px;padding:5px 16px;margin-bottom:16px}
.greeting{font-size:16px;color:#374151;margin-bottom:12px}
.big-price{font-size:72px;font-weight:800;color:#111827;letter-spacing:-3px;line-height:1}
.price-sub{font-size:14px;color:#6b7280;margin-top:10px}
.stat-strip{display:flex;align-items:center;justify-content:center;gap:24px;padding:20px 40px;background:#f9fafb;border-bottom:1px solid #f0f0f0}
.stat-item{text-align:center}
.stat-val{font-size:22px;font-weight:700;color:#111827}
.stat-val.muted{text-decoration:line-through;color:#9ca3af}
.stat-val.green{color:#16a34a}
.stat-label{font-size:10px;color:#9ca3af;margin-top:3px;font-weight:600;letter-spacing:.5px;text-transform:uppercase}
.stat-arrow{font-size:20px;color:#d1d5db}
.benefits{padding:28px 40px 8px}
.benefit-row{display:flex;align-items:flex-start;gap:14px;padding:11px 0;border-bottom:1px solid #f3f4f6}
.benefit-row:last-child{border:none}
.benefit-ico{width:34px;height:34px;border-radius:9px;background:#f0fdf4;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:17px;line-height:34px;text-align:center}
.benefit-txt{font-size:14px;color:#374151;font-weight:500;line-height:1.45;padding-top:8px}
.cta-section{padding:24px 40px}
.cta-btn{display:block;width:100%;background:#16a34a;color:#fff;text-decoration:none;text-align:center;font-size:16px;font-weight:700;padding:17px;border-radius:12px}
.terms{padding:0 40px 28px}
.terms-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;margin-bottom:10px}
.term-row{font-size:12px;color:#9ca3af;line-height:1.6;padding:2px 0 2px 12px;position:relative}
.term-row::before{content:'·';position:absolute;left:0}
.footer{display:flex;align-items:center;justify-content:space-between;padding:18px 40px;border-top:1px solid #f0f0f0}
.footer-logo{font-family:'Pacifico',cursive;font-size:15px;color:#16a34a}
.footer-url{font-size:11px;color:#9ca3af}
</style>
</head>
<body>
<div class="outer"><div class="card">

<svg class="hero" viewBox="0 0 520 260" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="rc"><rect width="520" height="260" rx="0"/></clipPath></defs>
  <g clip-path="url(#rc)">
    <rect width="520" height="260" fill="#29B5D8"/>
    <rect x="0" y="175" width="520" height="85" fill="#22A722"/>
    <rect x="0" y="175" width="48" height="85" fill="#1A8C1A"/>
    <rect x="96" y="175" width="48" height="85" fill="#1A8C1A"/>
    <rect x="192" y="175" width="48" height="85" fill="#1A8C1A"/>
    <rect x="288" y="175" width="48" height="85" fill="#1A8C1A"/>
    <rect x="384" y="175" width="48" height="85" fill="#1A8C1A"/>
    <rect x="480" y="175" width="48" height="85" fill="#1A8C1A"/>
    <path d="M0 175 Q65 158 130 175 Q195 192 260 175 Q325 158 390 175 Q455 192 520 175 L520 194 L0 194 Z" fill="#38C438"/>
    <circle cx="455" cy="44" r="54" fill="#F59E0B"/>
    <line x1="455" y1="-18" x2="455" y2="-32" stroke="#FCD34D" stroke-width="9" stroke-linecap="round"/>
    <line x1="455" y1="106" x2="455" y2="120" stroke="#FCD34D" stroke-width="9" stroke-linecap="round"/>
    <line x1="393" y1="44" x2="379" y2="44" stroke="#FCD34D" stroke-width="9" stroke-linecap="round"/>
    <line x1="517" y1="44" x2="531" y2="44" stroke="#FCD34D" stroke-width="9" stroke-linecap="round"/>
    <line x1="411" y1="0" x2="401" y2="-10" stroke="#FCD34D" stroke-width="7" stroke-linecap="round"/>
    <line x1="499" y1="0" x2="509" y2="-10" stroke="#FCD34D" stroke-width="7" stroke-linecap="round"/>
    <line x1="411" y1="88" x2="401" y2="98" stroke="#FCD34D" stroke-width="7" stroke-linecap="round"/>
    <line x1="499" y1="88" x2="509" y2="98" stroke="#FCD34D" stroke-width="7" stroke-linecap="round"/>
    <ellipse cx="70" cy="55" rx="50" ry="22" fill="white" opacity="0.92"/>
    <ellipse cx="96" cy="40" rx="40" ry="29" fill="white" opacity="0.92"/>
    <ellipse cx="44" cy="51" rx="32" ry="20" fill="white" opacity="0.92"/>
    <ellipse cx="250" cy="92" rx="32" ry="14" fill="white" opacity="0.60"/>
    <ellipse cx="274" cy="81" rx="26" ry="19" fill="white" opacity="0.60"/>
    <rect x="60" y="100" width="400" height="58" rx="14" fill="#1A6B1A" opacity="0.16"/>
    <text x="260" y="124" font-family="'Pacifico',cursive" font-size="50" fill="white" text-anchor="middle" dominant-baseline="middle" stroke="#0e5c1a" stroke-width="3" paint-order="stroke fill">That's Done Right</text>
    <text x="260" y="152" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="white" text-anchor="middle" letter-spacing="3" opacity="0.85">LAWN CARE  ·  KATY &amp; CROSBY TX</text>
    <rect x="222" y="196" width="66" height="22" rx="7" fill="#F59E0B"/>
    <rect x="215" y="214" width="80" height="7" rx="4" fill="#D97706"/>
    <circle cx="235" cy="225" r="12" fill="#14532D"/>
    <circle cx="235" cy="225" r="5" fill="#6EE7B7"/>
    <circle cx="275" cy="225" r="10" fill="#14532D"/>
    <circle cx="275" cy="225" r="4" fill="#6EE7B7"/>
    <line x1="279" y1="198" x2="304" y2="174" stroke="#F59E0B" stroke-width="5" stroke-linecap="round"/>
    <line x1="299" y1="172" x2="318" y2="172" stroke="#F59E0B" stroke-width="5" stroke-linecap="round"/>
  </g>
</svg>

<div class="promo-band">
  <div class="eyebrow">Special offer — just for you</div>
  <div class="greeting">Hey ${firstName}, we have something we think you'll love.</div>
  <div class="big-price">$19.99</div>
  <div class="price-sub">Your first mow — then ${quotedPrice}/visit after that</div>
</div>

<div class="stat-strip">
  <div class="stat-item">
    <div class="stat-val muted">$50+</div>
    <div class="stat-label">National avg</div>
  </div>
  <div class="stat-arrow">→</div>
  <div class="stat-item">
    <div class="stat-val green">$19.99</div>
    <div class="stat-label">Your first mow</div>
  </div>
  <div class="stat-arrow">→</div>
  <div class="stat-item">
    <div class="stat-val">${quotedPrice}</div>
    <div class="stat-label">Your quoted rate</div>
  </div>
</div>

<div class="benefits">
  <div class="benefit-row"><div class="benefit-ico">🛡️</div><div class="benefit-txt">Vetted local lawn care professional assigned to your home</div></div>
  <div class="benefit-row"><div class="benefit-ico">💳</div><div class="benefit-txt">Pay only after service is complete — no upfront charges</div></div>
  <div class="benefit-row"><div class="benefit-ico">📅</div><div class="benefit-txt">No contracts — skip, pause, or cancel anytime</div></div>
  <div class="benefit-row"><div class="benefit-ico">📍</div><div class="benefit-txt">Serving Katy TX, Crosby TX &amp; Greater Houston area</div></div>
</div>

<div class="cta-section">
  <a class="cta-btn" href="https://thatsdoneright.com">Get my $19.99 first mow &nbsp;→</a>
</div>

<div class="terms">
  <div class="terms-label">Offer terms</div>
  <div class="term-row">Requires a 3-cut minimum commitment. Standard rate applies after visit 1.</div>
  <div class="term-row">If grass exceeds 9 inches, a one-time long-grass fee (up to 100% of visit price) may apply.</div>
  <div class="term-row">Valid for new customers only. One per household.</div>
</div>

<div class="footer">
  <div class="footer-logo">That's Done Right</div>
  <div class="footer-url">thatsdoneright.com</div>
</div>

</div></div>
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
