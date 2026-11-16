/**
 * Disable or re-enable the sign-in of a seeded demo account on Supabase,
 * without deleting the account or anything it owns.
 *
 *   npm run demo-access -w backend -- disable admin@automatalab.test
 *   npm run demo-access -w backend -- enable  admin@automatalab.test
 *
 * Only addresses from the demo seed are accepted, so this can never lock out a real user.
 */
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { SEED_USERS } from '../seed';

const [action, email] = process.argv.slice(2);
if ((action !== 'disable' && action !== 'enable') || !email) {
  console.error('Usage: demo-access <disable|enable> <demo email>');
  process.exit(1);
}
if (!SEED_USERS.some((u) => u.email === email)) {
  console.error(`${email} is not a seeded demo account. Refusing to touch it.`);
  process.exit(1);
}
const config = loadConfig();
if (config.mode !== 'supabase') {
  console.error('Supabase is not configured in backend/.env.');
  process.exit(1);
}

const admin = createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (error) throw new Error(error.message);
const user = data.users.find((u) => u.email === email);
if (!user) {
  console.error(`No auth user with the address ${email}.`);
  process.exit(1);
}
// A ban blocks new sign-ins; "none" lifts it. ~100 years is effectively permanent.
const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { ban_duration: action === 'disable' ? '876000h' : 'none' });
if (updateError) throw new Error(updateError.message);
console.log(`${email}: sign-in ${action}d.`);
