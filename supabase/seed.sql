insert into site_settings (key, version, value)
values ('stage0', 1, '{"sample":true}')
on conflict (key) do nothing;
