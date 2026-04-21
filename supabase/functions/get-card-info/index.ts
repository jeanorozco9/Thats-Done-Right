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

    const { stripe_customer_id } = await req.json();

    // No customer yet — nothing to show
    if (!stripe_customer_id) {
      return new Response(
        JSON.stringify({ card: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch customer with default payment method expanded
    const customer = await stripe.customers.retrieve(stripe_customer_id, {
      expand: ["invoice_settings.default_payment_method"],
    });

    if ((customer as any).deleted) {
      return new Response(
        JSON.stringify({ card: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let pm: Stripe.PaymentMethod | null = null;
    const defaultPm = (customer as Stripe.Customer).invoice_settings
      ?.default_payment_method;

    if (defaultPm && typeof defaultPm !== "string") {
      pm = defaultPm as Stripe.PaymentMethod;
    }

    // Fallback: list the most recent card if no default is set
    if (!pm) {
      const methods = await stripe.paymentMethods.list({
        customer: stripe_customer_id,
        type: "card",
        limit: 1,
      });
      pm = methods.data[0] ?? null;
    }

    if (!pm || pm.type !== "card" || !pm.card) {
      return new Response(
        JSON.stringify({ card: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        card: {
          last4: pm.card.last4,
          brand: pm.card.brand,
          exp_month: pm.card.exp_month,
          exp_year: pm.card.exp_year,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("get-card-info error:", err);
    return new Response(
      JSON.stringify({ card: null, error: String(err.message) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
