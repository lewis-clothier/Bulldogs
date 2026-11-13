-- Reserved covers unpaid checkout AND paid (to fulfil) holds.
-- Paying leaves the hold in place; marking fulfilled drops counted (on_hand).
-- Sold is a shipped counter and does not affect shop availability.

create or replace function public.fulfil_shop_order_stock(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Ship it: clear the hold and take it off the shelf.
  update public.product_variants v
  set reserved = reserved - i.quantity,
      on_hand = on_hand - i.quantity,
      sold = sold + i.quantity
  from public.order_items i
  where i.order_id = p_order_id
    and v.product_id = i.product_id
    and v.colour is not distinct from i.colour
    and v.size is not distinct from i.size
    and v.reserved >= i.quantity
    and v.on_hand >= i.quantity;
end;
$$;

create or replace function public.on_shop_order_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item record;
begin
  -- Paid: keep reserved so the shop stays reduced until you pack it.
  if new.status = 'fulfilled' and old.status is distinct from 'fulfilled' then
    perform public.fulfil_shop_order_stock(new.id);
  elsif new.status = 'refunded' and old.status = 'paid' then
    perform public.release_shop_order_stock(new.id);
  elsif new.status = 'refunded' and old.status = 'fulfilled' then
    for item in
      select i.product_id, i.colour, i.size, i.quantity
      from public.order_items i
      where i.order_id = new.id
    loop
      update public.product_variants
      set sold = greatest(sold - item.quantity, 0),
          on_hand = on_hand + item.quantity
      where product_id = item.product_id
        and colour is not distinct from item.colour
        and size is not distinct from item.size;
    end loop;
  end if;
  return new;
end;
$$;

-- Undo premature stock take for paid orders that are still waiting to pack.
update public.product_variants v
set
  on_hand = v.on_hand + i.quantity,
  reserved = v.reserved + i.quantity,
  sold = greatest(v.sold - i.quantity, 0)
from public.orders o
join public.order_items i on i.order_id = o.id
where o.status = 'paid'
  and v.product_id = i.product_id
  and v.colour is not distinct from i.colour
  and v.size is not distinct from i.size;
