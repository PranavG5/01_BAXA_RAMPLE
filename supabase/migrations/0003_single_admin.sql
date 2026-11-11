-- The app now uses one hardcoded admin account instead of Supabase Auth, so
-- business_profiles.owner_id no longer points at auth.users.
alter table business_profiles drop constraint if exists business_profiles_owner_id_fkey;
