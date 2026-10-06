// One-time "we launched refer-a-friend" email to current customers, each with their personal link.
//   { token, mode: "preview" }                 → who would get it (sends nothing)
//   { token, mode: "test" }                    → one sample email to ADMIN_EMAIL
//   { token, mode: "send", confirm: "SEND" }   → emails every current customer once
//   { mode: "unsubscribe", email, sig }        → opt out of promotional email (from unsubscribe.html)
// Customers already emailed (leads.referral_launch_sent_at) are skipped, so a re-run never double-sends.
// Customers who unsubscribed (leads.marketing_unsubscribed_at) are never emailed.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!; // never commit — this repo is public
const LAUNCH_TOKEN   = Deno.env.get('REFERRAL_LAUNCH_TOKEN')!;
const FROM_EMAIL     = "team@thatsdoneright.com";
const SUPABASE_URL   = "https://djigwfatupycyfozivuu.supabase.co";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL       = Deno.env.get("SITE_URL") ?? "https://thatsdoneright.com";
const ADMIN_EMAIL    = Deno.env.get("ADMIN_EMAIL") ?? "team@thatsdoneright.com";
const UNSUB_SECRET   = Deno.env.get('UNSUBSCRIBE_SECRET')!; // signs unsubscribe links so nobody can unsubscribe someone else
// CAN-SPAM requires a physical postal address in promotional email (street, P.O. box, or private mailbox)
const BUSINESS_ADDRESS = Deno.env.get("BUSINESS_ADDRESS") ?? "2529 Kennings Rd, Crosby, TX 77532";
const ACTIVE_STATUSES = ["booked", "rescheduled", "completed", "paid", "invoiced"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

async function unsubSig(email: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(UNSUB_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(mac)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function unsubscribeUrl(email: string) {
  return `${SITE_URL}/unsubscribe.html?e=${encodeURIComponent(email)}&s=${await unsubSig(email)}`;
}

async function sendEmail(to: string, subject: string, html: string, unsubUrl: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL, to, subject, html,
      // Lets Gmail/Apple Mail show their built-in "Unsubscribe" button
      headers: { "List-Unsubscribe": `<${unsubUrl}>, <mailto:${FROM_EMAIL}?subject=unsubscribe>` },
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(`Resend: ${JSON.stringify(data)}`);
  return data.id;
}

// Same as send-invoice / the portal: first name + 4 characters, stored on the customer's oldest lead
async function ensureReferralCode(leadIds: number[], name: string): Promise<string | null> {
  const ids = leadIds.join(",");
  const [existing] = await db(`leads?id=in.(${ids})&referral_code=not.is.null&select=referral_code&order=id.asc&limit=1`);
  if (existing) return existing.referral_code;
  const ownerId = Math.min(...leadIds);
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
      // taken by another customer — try another
    }
  }
  return null;
}

const SUBJECT = "Get $5 off your next mow — refer a neighbor 🎁";

function launchEmail(firstName: string, code: string, unsubUrl: string) {
  const link = `${SITE_URL}/?ref=${code}`;
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1c1c1c;">
    <div style="background:#2e7d32;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:28px;">That's Done Right</h1>
      <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Lawn Service · Houston, TX</p>
    </div>
    <div style="background:#fff;padding:32px;border:1px solid #e8e2dc;border-top:none;border-radius:0 0 12px 12px;text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">🎁</div>
      <h2 style="margin:0 0 8px;font-size:22px;">Hi ${firstName}, share the love — get $5 off</h2>
      <p style="color:#666;margin:0 0 24px;line-height:1.6;">Thanks for trusting us with your lawn! We just launched our Refer a Friend program.<br/>Share your personal link with neighbors, friends or family. <strong>Every friend whose first mow is paid takes $5 off your next bill</strong> &mdash; no limit.</p>
      <div style="background:#FBF5E9;border:1px solid #e8dcc4;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0 0 6px;font-size:12px;color:#987947;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Your personal link</p>
        <a href="${link}" style="font-size:17px;font-weight:bold;color:#2e7d32;word-break:break-all;">thatsdoneright.com/?ref=${code}</a>
      </div>
      <div style="text-align:left;font-size:14px;color:#444;line-height:1.7;margin-bottom:24px;">
        <strong>How it works</strong><br/>
        1. Send your link to a friend (text, Facebook, Nextdoor &mdash; anywhere).<br/>
        2. They get an instant price and book their first mow.<br/>
        3. Once it's paid, $5 comes off your next bill automatically, after tax.
      </div>
      <a href="${SITE_URL}/client.html" style="display:inline-block;background:#2e7d32;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold;font-size:15px;">See my referral credits →</a>
      <p style="color:#999;font-size:12px;margin:24px 0 0;">That's Done Right · Houston, TX<br/>Questions? Reply to this email anytime.</p>
    </div>
    <p style="color:#aaa;font-size:11px;line-height:1.6;text-align:center;margin:16px 0 0;">
      You're receiving this because you're a That's Done Right customer.<br/>
      ${BUSINESS_ADDRESS ? `That's Done Right · ${BUSINESS_ADDRESS}<br/>` : ""}
      <a href="${unsubUrl}" style="color:#aaa;">Unsubscribe from promotional emails</a> &mdash; you'll still get your service receipts.
    </p>
  </div>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { token, mode, confirm, email, sig } = await req.json();

    // Public: called from unsubscribe.html. The signature proves the link came from our email.
    if (mode === "unsubscribe") {
      if (!email || !sig || sig !== await unsubSig(String(email))) return json({ error: "invalid link" }, 400);
      const e = String(email).trim().toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c);
      await db(`leads?email=ilike.${encodeURIComponent(e)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ marketing_unsubscribed_at: new Date().toISOString() }),
      });
      return json({ ok: true });
    }

    if (!LAUNCH_TOKEN || token !== LAUNCH_TOKEN) return json({ error: "forbidden" }, 403);

    // Current customers, grouped by email (one customer can have several leads)
    const leads = await db(`leads?select=id,name,email,status,referral_code,referral_launch_sent_at,marketing_unsubscribed_at&email=not.is.null&order=id.asc`);
    const byEmail = new Map<string, any[]>();
    for (const l of leads) {
      const key = String(l.email).trim().toLowerCase();
      if (!key.includes("@")) continue;
      if (!byEmail.has(key)) byEmail.set(key, []);
      byEmail.get(key)!.push(l);
    }
    const recipients = [...byEmail.entries()]
      .filter(([, ls]) => ls.some((l) => ACTIVE_STATUSES.includes(l.status)))
      .filter(([, ls]) => !ls.some((l) => l.marketing_unsubscribed_at))
      .map(([email, ls]) => ({
        email,
        name: (ls.find((l) => ACTIVE_STATUSES.includes(l.status)) ?? ls[0]).name ?? "",
        leadIds: ls.map((l) => l.id),
        alreadySent: ls.some((l) => l.referral_launch_sent_at),
      }));
    const toSend = recipients.filter((r) => !r.alreadySent);

    if (mode === "preview") {
      return json({
        will_email: toSend.length,
        already_emailed: recipients.length - toSend.length,
        recipients: toSend.map((r) => ({ name: r.name, email: r.email })),
      });
    }

    if (mode === "test") {
      const unsub = await unsubscribeUrl("test@example.com");
      const id = await sendEmail(ADMIN_EMAIL, `[TEST] ${SUBJECT}`, launchEmail("Maria", "MARIA4F2K", unsub), unsub);
      return json({ ok: true, sent_test_to: ADMIN_EMAIL, resend_id: id });
    }

    if (mode === "send" && confirm === "SEND") {
      if (!BUSINESS_ADDRESS) return json({ error: "Set BUSINESS_ADDRESS first — promotional email needs a postal address" }, 400);
      const sent: string[] = [];
      const failed: { email: string; error: string }[] = [];
      for (const r of toSend) {
        try {
          const code = await ensureReferralCode(r.leadIds, r.name);
          if (!code) throw new Error("no referral code");
          const unsub = await unsubscribeUrl(r.email);
          await sendEmail(r.email, SUBJECT, launchEmail(String(r.name).split(" ")[0] || "there", code, unsub), unsub);
          await db(`leads?id=in.(${r.leadIds.join(",")})`, {
            method: "PATCH",
            body: JSON.stringify({ referral_launch_sent_at: new Date().toISOString() }),
          });
          sent.push(r.email);
        } catch (e) {
          failed.push({ email: r.email, error: String(e) });
        }
        await new Promise((res) => setTimeout(res, 600)); // stay under Resend's rate limit
      }
      return json({ ok: true, sent: sent.length, failed });
    }

    return json({ error: 'mode must be "preview", "test", or "send" (with confirm: "SEND")' }, 400);
  } catch (err) {
    console.error("referral-launch error:", err);
    return json({ error: String(err) }, 500);
  }
});
