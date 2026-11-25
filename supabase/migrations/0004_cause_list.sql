-- Cause list support: the printed item number and the bench for a hearing.
-- Additive only (two nullable columns); nothing is rewritten or dropped.
alter table hearings add column if not exists item_number text;
alter table hearings add column if not exists bench text;
