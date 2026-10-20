-- Set the school name shown in the app header.
alter table public.app_settings alter column school_name set default 'Valley View University';
update public.app_settings set school_name = 'Valley View University', updated_at = now();
