-- A paid tee order commits the reserved units as sold. Available stock
-- (on hand − reserved − sold) drops when checkout starts, and stays down
-- after payment instead of waiting for the order to be marked fulfilled.
-- Refunding a paid order puts those sold units back.

create or replace function public.on_shop_order_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item record;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    perform public.fulfil_shop_order_stock(new.id);
  elsif new.status = 'refunded' and old.status = 'paid' then
    for item in
      select i.product_id, i.colour, i.size, i.quantity
      from public.order_items i
      where i.order_id = new.id
    loop
      update public.product_variants
      set sold = sold - item.quantity
      where product_id = item.product_id
        and colour is not distinct from item.colour
        and size is not distinct from item.size
        and sold >= item.quantity;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists shop_order_stock on public.orders;

create trigger shop_order_stock
after update of status on public.orders
for each row
execute function public.on_shop_order_status();

do $$
declare
  paid_order uuid;
begin
  for paid_order in
    select id from public.orders where status = 'paid'
  loop
    perform public.fulfil_shop_order_stock(paid_order);
  end loop;
end;
$$;
