import Stripe from "npm:stripe@18";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireEnv } from "./http.ts";

export const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  httpClient: Stripe.createFetchHttpClient(),
});

// The service role bypasses RLS, so this client must never be exposed to the browser.
export const db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

export { Stripe };
