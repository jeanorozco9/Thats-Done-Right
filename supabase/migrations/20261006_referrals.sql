-- Refer-a-friend program
-- When a referred friend's first mow is paid, the referrer earns $5 off (after tax) their next bill.
-- Run once in Supabase → SQL Editor. Safe to re-run.

-- 1. Codes on leads
--    referral_code    — this customer's share code (generated the first time they open their portal)
--    referred_by_code — the code on the link a new customer signed up through
alter table public.leads add column if not exists referral_code    text;
alter table public.leads add column if not exists referred_by_code text;
create unique index if not exists leads_referral_code_key
  on public.leads (upper(referral_code)) where referral_code is not null;

-- 2. Referral ledger — one row per referred customer
--    pending → earned (friend's first mow paid) → applied (taken off the referrer's bill)
create table if not exists public.referrals (
  id                        bigint generated always as identity primary key,
  referrer_lead_id          bigint not null references public.leads(id) on delete cascade,
  referred_lead_id          bigint not null unique references public.leads(id) on delete cascade,
  status                    text   not null default 'pending' check (status in ('pending', 'earned', 'applied')),
  reward_cents              integer not null default 500,
  created_at                timestamptz not null default now(),
  earned_at                 timestamptz,
  applied_at                timestamptz,
  applied_stripe_invoice_id text
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_lead_id, status);

-- Credits are money: no policies on purpose, so the public site key can't read or write this table.
-- Only edge functions using the service-role key (send-invoice) can.
alter table public.referrals enable row level security;

-- 3. Portal: the logged-in customer's share code and referral stats
create or replace function public.get_my_referral_info()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  my_email  text := lower(auth.jwt() ->> 'email');
  my_ids    bigint[];
  first_id  bigint;
  first_nm  text;
  code      text;
begin
  if my_email is null then
    return null;
  end if;

  select array_agg(id::bigint order by id), min(id)::bigint into my_ids, first_id
    from leads where lower(email) = my_email;
  if first_id is null then
    return null;
  end if;

  select referral_code into code
    from leads where id = any(my_ids) and referral_code is not null
    order by id limit 1;

  if code is null then
    select name into first_nm from leads where id = first_id;
    loop
      -- e.g. MARIA4F2K — first name + 4 random characters
      code := left(upper(regexp_replace(split_part(coalesce(first_nm, ''), ' ', 1), '[^A-Za-z]', '', 'g')), 8)
              || upper(substr(md5(random()::text), 1, 4));
      if length(code) = 4 then code := 'TDR' || code; end if;
      exit when not exists (select 1 from leads where upper(referral_code) = code);
    end loop;
    update leads set referral_code = code where id = first_id;
  end if;

  return json_build_object(
    'code',          code,
    'signed_up',     (select count(distinct lower(l.email)) from leads l
                       where upper(l.referred_by_code) = upper(code)
                         and lower(l.email) <> my_email
                         and l.status not in ('started', 'cancelled')),
    'pending',       (select count(*) from referrals where referrer_lead_id = any(my_ids) and status = 'pending'),
    'earned_count',  (select count(*) from referrals where referrer_lead_id = any(my_ids) and status in ('earned', 'applied')),
    'available_cents', (select coalesce(sum(reward_cents), 0) from referrals where referrer_lead_id = any(my_ids) and status = 'earned'),
    'applied_cents', (select coalesce(sum(reward_cents), 0) from referrals where referrer_lead_id = any(my_ids) and status = 'applied')
  );
end;
$$;

revoke all on function public.get_my_referral_info() from public, anon;
grant execute on function public.get_my_referral_info() to authenticated;
