-- Tracks who got the one-time refer-a-friend launch email, so it's never sent twice.
alter table public.leads add column if not exists referral_launch_sent_at timestamptz;
