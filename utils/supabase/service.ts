import { createClient } from '@supabase/supabase-js'

// Note: supabaseAdmin uses the SERVICE_ROLE_KEY which you must only use in secure server-side environments
// as it bypasses all RLS policies!
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
