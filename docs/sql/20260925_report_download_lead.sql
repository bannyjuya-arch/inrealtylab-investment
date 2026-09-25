-- 2026-09-25 보고서 PDF 출력 전 베타 사용 신청(리드) 저장 테이블
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run
create table if not exists public.report_download_lead (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  organization text not null check (char_length(organization) between 1 and 200),
  customer_type text not null check (char_length(customer_type) <= 50),
  review_timing text check (char_length(review_timing) <= 50),
  phone text check (char_length(phone) <= 50),
  privacy_agreed boolean not null check (privacy_agreed = true),
  marketing_agreed boolean not null default false,
  site_address text check (char_length(site_address) <= 300),
  pnus text[],
  referrer text check (char_length(referrer) <= 1000),
  utm_source text, utm_medium text, utm_campaign text,
  page_url text check (char_length(page_url) <= 1000),
  status text not null default '신청',  -- 신청 → 안내 발송 → 사용 → 피드백 → 유료 전환
  memo text
);
comment on table public.report_download_lead is '보고서 PDF 출력 전 수집하는 베타 사용 신청(리드). anon은 INSERT만, 조회는 로그인 관리자만.';
alter table public.report_download_lead enable row level security;
drop policy if exists "anon can submit lead" on public.report_download_lead;
create policy "anon can submit lead" on public.report_download_lead
  for insert to anon, authenticated with check (privacy_agreed = true and status = '신청' and memo is null);
drop policy if exists "admins read leads" on public.report_download_lead;
create policy "admins read leads" on public.report_download_lead
  for select to authenticated using (true);
drop policy if exists "admins update leads" on public.report_download_lead;
create policy "admins update leads" on public.report_download_lead
  for update to authenticated using (true) with check (true);
create index if not exists report_download_lead_created_idx on public.report_download_lead (created_at desc);
