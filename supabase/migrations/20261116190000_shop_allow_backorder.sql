-- Allow shop checkout when shelf stock is 0 (made-to-order / longer delivery).
-- Reserved may exceed on_hand so paid holds still reduce "available" once stock arrives.

alter table public.product_variants
  drop constraint if exists product_variants_reserved_lte_on_hand;

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
  -- Ship it: clear the hold and take what we can off the shelf.
  -- Backorders may have reserved > on_hand; never go negative.
  update public.product_variants v
  set reserved = greatest(v.reserved - i.quantity, 0),
      on_hand = greatest(v.on_hand - i.quantity, 0),
      sold = v.sold + i.quantity
  from public.order_items i
  where i.order_id = p_order_id
    and v.product_id = i.product_id
    and v.colour is not distinct from i.colour
    and v.size is not distinct from i.size;
end;
$$;

create or replace function public.release_shop_order_stock(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.product_variants v
  set reserved = greatest(v.reserved - i.quantity, 0)
  from public.order_items i
  where i.order_id = p_order_id
    and v.product_id = i.product_id
    and v.colour is not distinct from i.colour
    and v.size is not distinct from i.size;
end;
$$;
