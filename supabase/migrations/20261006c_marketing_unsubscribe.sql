-- Promotional-email opt-out (set from unsubscribe.html via the referral-launch function).
-- Any future marketing email must skip customers with this set. Receipts are not affected.
alter table public.leads add column if not exists marketing_unsubscribed_at timestamptz;
