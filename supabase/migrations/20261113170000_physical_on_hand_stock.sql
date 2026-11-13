-- Counted (on_hand) is physical stock on the shelf.
-- Paying reduces on_hand; sold stays as a lifetime counter for the admin UI.
-- Available to buy = on_hand − reserved.

-- Move existing sold units out of on_hand so shelf counts match reality.
update public.product_variants
set on_hand = on_hand - sold
where sold > 0;

alter table public.product_variants
  drop constraint product_variants_check;

alter table public.product_variants
  add constraint product_variants_reserved_lte_on_hand
  check (reserved <= on_hand);

create or replace function public.list_shop_catalog()
returns table (
  id text,
  name text,
  description text,
  price_pence integer,
  currency text,
  variants jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.description,
    p.price_pence,
    p.currency,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'colour', v.colour,
        'size', v.size,
        'available', greatest(v.on_hand - v.reserved, 0)
      ) order by v.colour, v.size)
      from public.product_variants v
      where v.product_id = p.id
    ), '[]'::jsonb)
  from public.products p
  where p.is_active
  order by p.name;
$$;

create or replace function public.create_shop_order(
  p_user_id uuid,
  p_email text,
  p_newsletter_opt_in boolean,
  p_items jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_line jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_colour text;
  v_size text;
  v_available integer;
  v_subtotal integer := 0;
  v_currency text;
  v_order_id uuid;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'bag_empty';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'too_many_items';
  end if;

  for v_line in select * from jsonb_array_elements(p_items)
  loop
    select * into v_product from public.products
    where id = v_line->>'product_id' and is_active
    for update;
    if not found then
      raise exception 'item_unavailable';
    end if;
    if v_currency is null then
      v_currency := v_product.currency;
    elsif v_currency is distinct from v_product.currency then
      raise exception 'mixed_currency';
    end if;

    v_qty := (v_line->>'quantity')::integer;
    v_colour := lower(nullif(trim(v_line->>'colour'), ''));
    v_size := upper(nullif(trim(v_line->>'size'), ''));
    if v_qty is null or v_qty < 1 or v_qty > 10 then
      raise exception 'bad_quantity';
    end if;

    perform 1 from public.product_variants
    where product_id = v_product.id and colour = v_colour and size = v_size
    for update;
    if not found then
      raise exception 'item_unavailable';
    end if;

    select on_hand - reserved into v_available
    from public.product_variants
    where product_id = v_product.id and colour = v_colour and size = v_size;

    if v_available < v_qty then
      raise exception 'out_of_stock';
    end if;

    update public.product_variants
    set reserved = reserved + v_qty
    where product_id = v_product.id and colour = v_colour and size = v_size;

    v_subtotal := v_subtotal + v_product.price_pence * v_qty;
  end loop;

  insert into public.orders (
    user_id, customer_email, newsletter_opt_in, amount_subtotal_pence, currency
  )
  values (p_user_id, lower(nullif(p_email, '')), coalesce(p_newsletter_opt_in, false), v_subtotal, v_currency)
  returning id into v_order_id;

  insert into public.order_items (
    order_id, product_id, product_name, colour, size, quantity, unit_price_pence
  )
  select
    v_order_id,
    p.id,
    p.name,
    lower(nullif(trim(line->>'colour'), '')),
    upper(nullif(trim(line->>'size'), '')),
    (line->>'quantity')::integer,
    p.price_pence
  from jsonb_array_elements(p_items) as line
  join public.products p on p.id = line->>'product_id';

  return v_order_id;
end;
$$;

create or replace function public.fulfil_shop_order_stock(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
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
  if new.status = 'paid' and old.status is distinct from 'paid' then
    perform public.fulfil_shop_order_stock(new.id);
  elsif new.status = 'refunded' and old.status in ('paid', 'fulfilled') then
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
