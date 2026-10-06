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
// Service-role key is provided automatically to edge functions. Used only for the referrals
// table, which is locked down so the public site key can't touch credits.
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_MIN_CHARGE_CENTS = 50; // Stripe can't charge less than $0.50 — a bill is either fully covered or ≥ this

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

const money = (cents: number) => (cents / 100).toFixed(2);

// ── REFERRALS ──
// A customer shares thatsdoneright.com/?ref=CODE. When the friend's first mow is paid, the
// referrer earns $5 (referrals.status pending → earned), which comes off their next bill after
// tax via the Stripe customer credit balance (earned → applied).

async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`db ${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
const normAddr  = (a: unknown) => String(a ?? "").split(",")[0].toLowerCase()
  .replace(/\b(street|st|drive|dr|lane|ln|road|rd|avenue|ave|court|ct|circle|cir|boulevard|blvd|way|wy|trail|trl|place|pl)\b/g, "")
  .replace(/[^a-z0-9]/g, "");
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

// All lead ids belonging to the same customer (one email can have several leads)
async function customerLeadIds(email: string): Promise<number[]> {
  const rows = await db(`leads?email=ilike.${encodeURIComponent(likeEscape(normEmail(email)))}&select=id`);
  return rows.map((r: { id: number }) => r.id);
}

// Record the referral the first time a referred customer is invoiced. Only brand-new customers
// count, and never the referrer's own email or address.
async function registerReferral(lead: any, myLeadIds: number[]) {
  const code = String(lead.referred_by_code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) return;
  const existing = await db(`referrals?referred_lead_id=in.(${myLeadIds.join(",")})&select=id`);
  if (existing.length) return;
  const prior = await db(`invoices?lead_id=in.(${myLeadIds.join(",")})&select=id&limit=1`);
  if (prior.length) return;

  const [referrer] = await db(`leads?referral_code=ilike.${code}&select=id,email,address&limit=1`);
  if (!referrer) return;
  if (normEmail(referrer.email) === normEmail(lead.email) || normAddr(referrer.address) === normAddr(lead.address)) {
    console.log("Referral rejected (same email/address):", code, lead.id);
    return;
  }
  await db("referrals", {
    method: "POST",
    body: JSON.stringify({ referrer_lead_id: referrer.id, referred_lead_id: lead.id }),
  });
  console.log("Referral registered:", code, "→ lead", lead.id);
}

// pending → earned, then tell the referrer. Filtered on status so it only ever fires once.
async function earnReferral(referralId: number, friendName: string) {
  const rows = await db(`referrals?id=eq.${referralId}&status=eq.pending&select=referrer_lead_id,reward_cents`, {
    method: "PATCH",
    body: JSON.stringify({ status: "earned", earned_at: new Date().toISOString() }),
  });
  if (!rows.length) return;
  const [referrer] = await db(`leads?id=eq.${rows[0].referrer_lead_id}&select=name,email`);
  if (!referrer?.email) return;
  const friend = String(friendName ?? "").split(" ")[0] || "Your friend";
  await sendEmail(
    referrer.email,
    `You just earned $${money(rows[0].reward_cents)} off your next mow 🎉`,
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1c1c1c;">
      <div style="background:#2e7d32;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:28px;">That's Done Right</h1>
        <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Lawn Service · Houston, TX</p>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #e8e2dc;border-top:none;border-radius:0 0 12px 12px;text-align:center;">
        <div style="font-size:48px;margin-bottom:12px;">🎉</div>
        <h2 style="margin:0 0 8px;font-size:22px;">Thanks for the referral, ${String(referrer.name ?? "").split(" ")[0] || "neighbor"}!</h2>
        <p style="color:#666;margin:0 0 24px;line-height:1.6;">${friend} just had their first mow with us.<br/><strong>$${money(rows[0].reward_cents)}</strong> will come off your next bill automatically.</p>
        <a href="${SITE_URL}/client.html" style="display:inline-block;background:#2e7d32;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:15px;">Refer another friend →</a>
        <p style="color:#999;font-size:12px;margin:24px 0 0;">No limit — every friend whose first mow is paid earns you another $5.</p>
      </div>
    </div>`
  );
}

// Pay-by-link invoices get paid later on Stripe's page, so before billing anyone, check whether
// any pending referral involving this customer has a paid invoice by now.
async function settlePendingReferrals(myLeadIds: number[]) {
  const ids = myLeadIds.join(",");
  const pending = await db(
    `referrals?status=eq.pending&or=(referrer_lead_id.in.(${ids}),referred_lead_id.in.(${ids}))&select=id,referred_lead_id`
  );
  for (const ref of pending) {
    const invs = await db(`invoices?lead_id=eq.${ref.referred_lead_id}&stripe_invoice_id=not.is.null&select=stripe_invoice_id,status&order=id.asc&limit=10`);
    for (const inv of invs) {
      const paid = inv.status === "paid" || (await fetch(`https://api.stripe.com/v1/invoices/${inv.stripe_invoice_id}`, {
        headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
      }).then((r) => r.json())).status === "paid";
      if (paid) {
        const [friend] = await db(`leads?id=eq.${ref.referred_lead_id}&select=name`);
        await earnReferral(ref.id, friend?.name);
        break;
      }
    }
  }
}

// The customer's share code, creating one if they don't have it yet (same format as the portal:
// first name + 4 characters, stored on their oldest lead). Lets every receipt carry their link.
async function ensureReferralCode(myLeadIds: number[], name: string): Promise<string | null> {
  const ids = myLeadIds.join(",");
  const [existing] = await db(`leads?id=in.(${ids})&referral_code=not.is.null&select=referral_code&order=id.asc&limit=1`);
  if (existing) return existing.referral_code;
  const ownerId = Math.min(...myLeadIds);
  const first = String(name ?? "").split(" ")[0].replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 8) || "TDR";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = first + crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
    try {
      const rows = await db(`leads?id=eq.${ownerId}&referral_code=is.null&select=referral_code`, {
        method: "PATCH",
        body: JSON.stringify({ referral_code: candidate }),
      });
      if (rows.length) return candidate;
      const [fresh] = await db(`leads?id=eq.${ownerId}&select=referral_code`);
      return fresh?.referral_code ?? null;
    } catch (_) {
      // code taken by another customer (unique index) — try another
    }
  }
  return null;
}

const referralPromo = (code: string | null) => code
  ? `<div style="background:#FBF5E9;border:1px solid #e8dcc4;border-radius:8px;padding:16px 20px;margin-bottom:24px;text-align:center;">
       <p style="margin:0 0 6px;font-size:15px;font-weight:bold;color:#1c1c1c;">🎁 Give a neighbor a great lawn — get $5 off</p>
       <p style="margin:0 0 12px;font-size:13px;color:#666;line-height:1.5;">Share your link. Every friend whose first mow is paid takes $5 off your next bill — no limit.</p>
       <a href="${SITE_URL}/?ref=${code}" style="font-size:14px;font-weight:bold;color:#2e7d32;">thatsdoneright.com/?ref=${code}</a>
     </div>`
  : "";

// Take earned $5 credits off this bill (after tax) by crediting the Stripe customer balance,
// which Stripe applies to the invoice total when it's finalized. Must run before finalize.
// Credits that don't fit this bill stay earned for the next one.
async function applyReferralCredits(myLeadIds: number[], customerId: string, invoiceId: string, totalCents: number) {
  const earned = await db(
    `referrals?referrer_lead_id=in.(${myLeadIds.join(",")})&status=eq.earned&select=id,reward_cents&order=earned_at.asc`
  );
  const pick: number[] = [];
  let sum = 0;
  for (const r of earned) {
    const left = totalCents - (sum + r.reward_cents);
    if (left === 0 || left >= STRIPE_MIN_CHARGE_CENTS) { pick.push(r.id); sum += r.reward_cents; }
  }
  if (!pick.length) return 0;

  // Claim atomically — status filter means a credit can't be spent on two bills
  const claimed = await db(`referrals?id=in.(${pick.join(",")})&status=eq.earned&select=id,reward_cents`, {
    method: "PATCH",
    body: JSON.stringify({ status: "applied", applied_at: new Date().toISOString(), applied_stripe_invoice_id: invoiceId }),
  });
  const cents = claimed.reduce((s: number, r: { reward_cents: number }) => s + r.reward_cents, 0);
  if (!cents) return 0;

  const txn = await stripePost(`customers/${customerId}/balance_transactions`, {
    amount:      String(-cents),
    currency:    "usd",
    description: `Referral credit — ${claimed.length} friend${claimed.length === 1 ? "" : "s"}`,
    "metadata[invoice_id]": invoiceId,
  });
  if (txn.error) {
    console.error("Referral credit failed, releasing credits:", JSON.stringify(txn.error));
    await db(`referrals?id=in.(${claimed.map((r: { id: number }) => r.id).join(",")})`, {
      method: "PATCH",
      body: JSON.stringify({ status: "earned", applied_at: null, applied_stripe_invoice_id: null }),
    });
    return 0;
  }
  console.log(`Applied referral credit: $${money(cents)} to ${invoiceId}`);
  return cents;
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
    const totalCents   = Math.round(basePrice * 100) + Math.round(basePrice * 100 * 0.0825);
    // Referral credit comes off after tax; set below once credits are applied
    let creditCents    = 0;
    let totalWithTax   = money(totalCents);

    // Referral bookkeeping must never block billing — on any error, bill normally
    let myLeadIds: number[] = [lead.id];
    try {
      myLeadIds = await customerLeadIds(lead.email);
      if (!myLeadIds.includes(lead.id)) myLeadIds.push(lead.id);
      await registerReferral(lead, myLeadIds);
      await settlePendingReferrals(myLeadIds);
    } catch (e) {
      console.error("Referral pre-check failed:", e);
    }
    const applyCredits = async (invoiceId: string) => {
      try {
        creditCents = await applyReferralCredits(myLeadIds, customerId, invoiceId, totalCents);
      } catch (e) {
        console.error("Referral credit failed:", e);
      }
      totalWithTax = money(totalCents - creditCents);
    };
    const creditRow = (style: string) => creditCents
      ? `<p style="${style}color:#2e7d32;"><strong>Referral credit:</strong> −$${money(creditCents)}</p>`
      : "";

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

      await applyCredits(invoice.id);

      const finalized = await fetch(`https://api.stripe.com/v1/invoices/${invoice.id}/finalize`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${STRIPE_SECRET}` },
      }).then(r => r.json());

      // A bill fully covered by referral credit is already paid at finalize — nothing to charge
      const paid = finalized.status === "paid" ? finalized : await fetch(`https://api.stripe.com/v1/invoices/${invoice.id}/pay`, {
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

      await applyCredits(invoice.id);

      const finalized = await fetch(`https://api.stripe.com/v1/invoices/${invoice.id}/finalize`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${STRIPE_SECRET}` },
      }).then(r => r.json());

      if (finalized.status === "paid") {
        // Fully covered by referral credit — nothing to send
        autoCharged = true;
        paymentLink = finalized.hosted_invoice_url ?? `https://dashboard.stripe.com/invoices/${finalized.id}`;
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
      } else {
        const sentInvoice = await fetch(`https://api.stripe.com/v1/invoices/${invoice.id}/send`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${STRIPE_SECRET}` },
        }).then(r => r.json());

        console.log("Sent invoice:", JSON.stringify(sentInvoice));

        paymentLink = sentInvoice.hosted_invoice_url
          ?? sentInvoice.invoice_pdf
          ?? `https://invoice.stripe.com/i/${sentInvoice.id}`;
      }
    }

    // Friend's first mow just got paid → the person who referred them earns their $5
    if (autoCharged) {
      try {
        const [ref] = await db(`referrals?referred_lead_id=eq.${lead.id}&status=eq.pending&select=id`);
        if (ref) await earnReferral(ref.id, lead.name);
      } catch (e) {
        console.error("Referral earn failed:", e);
      }
    }

    let myReferralCode: string | null = null;
    try {
      myReferralCode = await ensureReferralCode(myLeadIds, lead.name);
    } catch (e) {
      console.error("Referral code failed:", e);
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
              ${creditRow("margin:0 0 4px;")}
              <p style="margin:0;font-weight:bold;"><strong>Total charged:</strong> $${totalWithTax}</p>
            </div>
            ${referralPromo(myReferralCode)}
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
              ${creditCents ? `<tr><td style="padding:8px 0;color:#999;">Referral credit</td><td style="padding:8px 0;color:#2e7d32;">−$${money(creditCents)}</td></tr>` : ""}
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
              ${creditRow("margin:0 0 6px;font-size:14px;")}
              <p style="margin:0;font-size:14px;font-weight:bold;"><strong>Total due:</strong> $${totalWithTax}</p>
            </div>
            <div style="margin-bottom:24px;">
              <a href="${paymentLink}" style="display:inline-block;background:#2e7d32;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:bold;font-size:16px;">Pay $${totalWithTax} Now →</a>
            </div>
            ${referralPromo(myReferralCode)}
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
