alter table public.clinics add column if not exists op_fee_amount numeric(10,2) not null default 300;
update public.clinics set op_fee_amount = 300 where op_fee_amount is null or op_fee_amount <= 0;
