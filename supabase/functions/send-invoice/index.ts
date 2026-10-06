import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STRIPE_SECRET   = Deno.env.get('STRIPE_SECRET_KEY')!;
const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY')!; // set in Supabase → Edge Functions → Secrets (never commit it — this repo is public)
const TAX_RATE_ID     = "txr_1Tf65t0T6k1KLZeB9UXrz5PR"; // ← paste your txr_ here
const FROM_EMAIL      = "team@thatsdoneright.com";
const SUPABASE_URL    = "https://djigwfatupycyfozivuu.supabase.co";
const SUPABASE_KEY    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqaWd3ZmF0dXB5Y3lmb3ppdnV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwODY2ODEsImV4cCI6MjA4ODY2MjY4MX0.0uXHYTscK4VlX5pFcdR-mfmdMEyoxJocsT_xyAbls4M";
const SITE_URL        = Deno.env.get("SITE_URL") ?? "https://thatsdoneright.com";
const ADMIN_EMAIL     = Deno.env.get("ADMIN_EMAIL") ?? "team@thatsdoneright.com";

async function stripePost(endpoint: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  return res.json();
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  const data = await res.json();
  console.log("Resend response:", JSON.stringify(data));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { lead_id, amount_override } = await req.json();
    if (!lead_id) return new Response("missing lead_id", { status: 400 });

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${lead_id}&select=*`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const leads = await res.json();
    const lead  = leads[0];
    if (!lead) return new Response("lead not found", { status: 404 });

    console.log("Lead data:", JSON.stringify(lead));

    if (!lead.price) {
      return new Response(JSON.stringify({ error: "Lead has no price" }), { status: 400 });
    }

    // Price breakdown (Stripe adds tax on top of base price)
    const basePrice = amount_override ? Number(amount_override) : Number(lead.price);
    const taxAmount    = (basePrice * 0.0825).toFixed(2);
    const totalWithTax = (basePrice * 1.0825).toFixed(2);

    const freqLabel = lead.frequency === "weekly" ? "Weekly mowing"
                    : lead.frequency === "twice"  ? "Twice a month mowing"
                    : "One-time mowing";

    const serviceDate = lead.scheduled_date
      ? new Date(lead.scheduled_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : null;

    const photoHtml = lead.photo_url
      ? `<div style="margin-bottom:20px;border-radius:10px;overflow:hidden;border:1px solid #e8e2dc;">
           <img src="${lead.photo_url}" alt="Your completed lawn" style="width:100%;display:block;max-height:300px;object-fit:cover;"/>
           <div style="background:#f9f9f7;padding:8px 12px;font-size:12px;color:#999;text-align:center;">Photo taken by your lawn care professional</div>
         </div>`
      : "";

    // Ensure Stripe customer exists
    let customerId = lead.stripe_customer_id;
    if (!customerId) {
      const newCustomer = await stripePost("customers", {
        name:  lead.name,
        email: lead.email,
        phone: lead.phone || "",
        "metadata[lead_id]":  String(lead.id),
        "metadata[address]":  lead.address,
      });
      customerId = newCustomer.id;
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ stripe_customer_id: customerId }),
      });
    }
    console.log("Stripe customer:", customerId);

    let paymentLink: string;
    let invoiceId: string | null = null;
    let autoCharged = false;

    if (lead.stripe_payment_method_id) {
      // ── AUTO-CHARGE PATH: Invoice with charge_automatically + tax breakdown ──
      const invoice = await stripePost("invoices", {
        customer:                  customerId,
        default_payment_method:    lead.stripe_payment_method_id,
        collection_method:         "charge_automatically",
        "default_tax_rates[]":     TAX_RATE_ID,
        "metadata[lead_id]":       String(lead.id),
      });
      invoiceId = invoice.id;

      await stripePost("invoiceitems", {
        customer:    customerId,
        invoice:     invoice.id,
        amount:      String(Math.round(basePrice * 100)),
        currency:    "usd",
        description: `${freqLabel} — ${lead.address}`,
      });

      await fetch(`https://api.stripe.com/v1/invoices/${invoice.id}/finalize`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${STRIPE_SECRET}` },
      });

      const paid = await fetch(`https://api.stripe.com/v1/invoices/${invoice.id}/pay`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${STRIPE_SECRET}` },
      }).then(r => r.json());

      console.log("Invoice pay result:", paid.id, paid.status);

      paymentLink = paid.hosted_invoice_url ?? `https://dashboard.stripe.com/invoices/${paid.id}`;

      if (paid.status === "paid") {
        autoCharged = true;
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ status: "paid" }),
        });
      }

    } else {
      // ── MANUAL INVOICE PATH: Send invoice email with tax breakdown ──
      const invoice = await stripePost("invoices", {
        customer:              customerId,
        collection_method:     "send_invoice",
        days_until_due:        "3",
        "default_tax_rates[]": TAX_RATE_ID,
        "metadata[lead_id]":   String(lead.id),
      });
      invoiceId = invoice.id;

      await stripePost("invoiceitems", {
        customer:    customerId,
        invoice:     invoice.id,
        amount:      String(Math.round(basePrice * 100)),
        currency:    "usd",
        description: `${freqLabel} — ${lead.address}`,
      });

      await fetch(`https://api.stripe.com/v1/invoices/${invoice.id}/finalize`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${STRIPE_SECRET}` },
      });

      const sentInvoice = await fetch(`https://api.stripe.com/v1/invoices/${invoice.id}/send`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${STRIPE_SECRET}` },
      }).then(r => r.json());

      console.log("Sent invoice:", JSON.stringify(sentInvoice));

      paymentLink = sentInvoice.hosted_invoice_url
        ?? sentInvoice.invoice_pdf
        ?? `https://invoice.stripe.com/i/${sentInvoice.id}`;
    }

    // ── EMAILS ──
    if (autoCharged) {
      await sendEmail(
        lead.email,
        `Payment received — Thank you! ✅`,
        `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1c1c1c;">
          <div style="background:#2e7d32;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;">That's Done Right</h1>
            <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Lawn Service · Houston, TX</p>
          </div>
          <div style="background:#fff;padding:32px;border:1px solid #e8e2dc;border-top:none;border-radius:0 0 12px 12px;text-align:center;">
            <div style="font-size:48px;margin-bottom:12px;">✅</div>
            <h2 style="margin:0 0 8px;font-size:22px;">Payment received, ${lead.name.split(" ")[0]}!</h2>
            <p style="color:#666;margin:0 0 24px;line-height:1.6;">Your payment has been processed.<br/>Thank you for choosing That's Done Right!</p>
            ${photoHtml}
            <div style="background:#f9f9f7;border:1px solid #e8e2dc;border-radius:8px;padding:14px 20px;margin-bottom:24px;text-align:left;font-size:14px;">
              <p style="margin:0 0 4px;"><strong>Address:</strong> ${lead.address}</p>
              ${serviceDate ? `<p style="margin:0 0 4px;"><strong>Service Date:</strong> ${serviceDate}</p>` : ""}
              <p style="margin:0 0 4px;"><strong>Service:</strong> $${basePrice.toFixed(2)}</p>
              <p style="margin:0 0 4px;"><strong>Texas Sales Tax (8.25%):</strong> $${taxAmount}</p>
              <p style="margin:0;font-weight:bold;"><strong>Total charged:</strong> $${totalWithTax}</p>
            </div>
            <p style="color:#999;font-size:12px;margin:0;">That's Done Right · Houston, TX<br/>Questions? Reply to this email anytime.</p>
          </div>
        </div>`
      );

      await sendEmail(
        ADMIN_EMAIL,
        `💰 Charged: ${lead.name} — $${totalWithTax}`,
        `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
          <div style="background:#1b5e20;padding:20px 32px;border-radius:12px 12px 0 0;">
            <h2 style="color:#fff;margin:0;">💰 Auto-charge Successful</h2>
          </div>
          <div style="background:#fff;padding:28px 32px;border:1px solid #e8e2dc;border-top:none;border-radius:0 0 12px 12px;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:8px 0;color:#999;width:140px;">Customer</td><td style="padding:8px 0;font-weight:bold;">${lead.name}</td></tr>
              <tr><td style="padding:8px 0;color:#999;">Address</td><td style="padding:8px 0;">${lead.address}</td></tr>
              <tr><td style="padding:8px 0;color:#999;">Service</td><td style="padding:8px 0;">$${basePrice.toFixed(2)}</td></tr>
              <tr><td style="padding:8px 0;color:#999;">Tax (8.25%)</td><td style="padding:8px 0;">$${taxAmount}</td></tr>
              <tr><td style="padding:8px 0;color:#999;">Total</td><td style="padding:8px 0;font-weight:bold;color:#1b5e20;font-size:18px;">$${totalWithTax}</td></tr>
            </table>
          </div>
        </div>`
      );

    } else {
      await sendEmail(
        lead.email,
        `Your lawn is done! Invoice for $${totalWithTax} 🌿`,
        `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1c1c1c;">
          <div style="background:#2e7d32;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;">That's Done Right</h1>
            <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Lawn Service · Houston, TX</p>
          </div>
          <div style="background:#fff;padding:32px;border:1px solid #e8e2dc;border-top:none;border-radius:0 0 12px 12px;text-align:center;">
            <div style="font-size:48px;margin-bottom:12px;">🌿</div>
            <h2 style="margin:0 0 8px;font-size:22px;">Your lawn is done, ${lead.name.split(" ")[0]}!</h2>
            <p style="color:#666;margin:0 0 24px;line-height:1.6;">Great news — your lawn has been taken care of.<br/>Please complete your payment below.</p>
            ${photoHtml}
            <div style="background:#f9f9f7;border:1px solid #e8e2dc;border-left:4px solid #2e7d32;border-radius:8px;padding:16px 20px;margin-bottom:24px;text-align:left;">
              <p style="margin:0 0 6px;font-size:14px;"><strong>Address:</strong> ${lead.address}</p>
              ${serviceDate ? `<p style="margin:0 0 6px;font-size:14px;"><strong>Service Date:</strong> ${serviceDate}</p>` : ""}
              <p style="margin:0 0 6px;font-size:14px;"><strong>Service:</strong> ${freqLabel}</p>
              <p style="margin:0 0 6px;font-size:14px;"><strong>Subtotal:</strong> $${basePrice.toFixed(2)}</p>
              <p style="margin:0 0 6px;font-size:14px;"><strong>Texas Sales Tax (8.25%):</strong> $${taxAmount}</p>
              <p style="margin:0;font-size:14px;font-weight:bold;"><strong>Total due:</strong> $${totalWithTax}</p>
            </div>
            <div style="margin-bottom:24px;">
              <a href="${paymentLink}" style="display:inline-block;background:#2e7d32;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:bold;font-size:16px;">Pay $${totalWithTax} Now →</a>
            </div>
            <p style="color:#999;font-size:12px;margin:0;">Payment due within 3 days.<br/>Questions? Reply to this email anytime.<br/>That's Done Right · Houston, TX</p>
          </div>
        </div>`
      );
    }

    // ── Save to invoices table ──
    await fetch(`${SUPABASE_URL}/rest/v1/invoices`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        lead_id:           lead.id,
        contractor_id:     lead.contractor_id,
        amount_cents:      Math.round(Number(totalWithTax) * 100),
        status:            autoCharged ? "paid" : "sent",
        stripe_invoice_id: invoiceId,
        invoice_url:       paymentLink,
        due_date:          new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0],
      }),
    });

    if (!autoCharged) {
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead_id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ status: "invoiced", invoice_url: paymentLink }),
      });
    }

    return new Response(
      JSON.stringify({ ok: true, charged: autoCharged, invoice_id: invoiceId, payment_link: paymentLink }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("send-invoice error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
