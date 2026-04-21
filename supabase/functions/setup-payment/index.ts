import Stripe from "npm:stripe@14";

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
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
      apiVersion: "2023-10-16",
    });

    const { stripe_customer_id, email, name, return_url, lead_id } =
      await req.json();

    let customerId = stripe_customer_id;

    // ── If this client has no Stripe customer yet, create one ──
    if (!customerId) {
      if (!email) {
        return new Response(
          JSON.stringify({ error: "Email is required to set up a payment method." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const customer = await stripe.customers.create({
        email,
        name: name || undefined,
        metadata: { source: "thats-done-right" },
      });
      customerId = customer.id;

      // Save the new Stripe customer ID back to the leads row
      if (lead_id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${lead_id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ stripe_customer_id: customerId }),
        });
      }
    }

    // ── Open the Stripe Customer Portal ──
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: return_url || "https://thatsdoneright.com/client.html",
    });

    return new Response(
      JSON.stringify({ url: session.url, stripe_customer_id: customerId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("billing-portal error:", err);
    return new Response(
      JSON.stringify({ error: String(err.message) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
