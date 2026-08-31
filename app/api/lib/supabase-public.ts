const SEOUL_SUPABASE_URL = "https://igiltlrafwiszkhvtspb.supabase.co";
const SEOUL_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Gy4GhKbuZU9vV3hEoPQ5Og_5P4_5_9e";

export function supabasePublicConfig() {
  const url = (process.env.SUPABASE_SEOUL_URL?.trim() || SEOUL_SUPABASE_URL).replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SEOUL_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    SEOUL_SUPABASE_PUBLISHABLE_KEY;

  return { url, key };
}

export function supabasePublicHeaders(extra?: Record<string, string>) {
  const { key } = supabasePublicConfig();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}
