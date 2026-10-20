-- LOCAL DEVELOPMENT SAMPLE DATA ONLY.
-- All names are fictional. Do not load this into a production project.
-- Student IDs are DEMO0001-DEMO0060. Type one and press Enter on the check-in screen to simulate a scan.
-- DEMO0059 and DEMO0060 are inactive, to demonstrate the inactive-student message.

update public.app_settings set school_name = 'Valley View University', timezone = 'UTC';

insert into public.students (student_code, first_name, last_name, active) values
  ('DEMO0001', 'Zara', 'Example', true),
  ('DEMO0002', 'Ama', 'Placeholder', true),
  ('DEMO0003', 'Kojo', 'Demo', true),
  ('DEMO0004', 'Abena', 'Example', true),
  ('DEMO0005', 'Ethan', 'Specimen', true),
  ('DEMO0006', 'Esi', 'Dummy', true),
  ('DEMO0007', 'Fiifi', 'Sample', true),
  ('DEMO0008', 'Ama', 'Example', true),
  ('DEMO0009', 'Akosua', 'Demo', true),
  ('DEMO0010', 'Maya', 'Dummy', true),
  ('DEMO0011', 'Ama', 'Specimen', true),
  ('DEMO0012', 'Akosua', 'Specimen', true),
  ('DEMO0013', 'Fiifi', 'Demo', true),
  ('DEMO0014', 'Yaa', 'Dummy', true),
  ('DEMO0015', 'Adwoa', 'Sample', true),
  ('DEMO0016', 'Ivy', 'Testperson', true),
  ('DEMO0017', 'Lina', 'Mockley', true),
  ('DEMO0018', 'Efua', 'Placeholder', true),
  ('DEMO0019', 'Abena', 'Demo', true),
  ('DEMO0020', 'Ivy', 'Fakename', true),
  ('DEMO0021', 'Kwame', 'Example', true),
  ('DEMO0022', 'Afua', 'Example', true),
  ('DEMO0023', 'Kwaku', 'Fakename', true),
  ('DEMO0024', 'Noah', 'Placeholder', true),
  ('DEMO0025', 'Theo', 'Sample', true),
  ('DEMO0026', 'Omar', 'Trial', true),
  ('DEMO0027', 'Leo', 'Example', true),
  ('DEMO0028', 'Jonah', 'Mockley', true),
  ('DEMO0029', 'Esi', 'Specimen', true),
  ('DEMO0030', 'Kwabena', 'Dummy', true),
  ('DEMO0031', 'Nia', 'Fakename', true),
  ('DEMO0032', 'Sofia', 'Demo', true),
  ('DEMO0033', 'Lina', 'Example', true),
  ('DEMO0034', 'Kofi', 'Demo', true),
  ('DEMO0035', 'Ivy', 'Placeholder', true),
  ('DEMO0036', 'Esi', 'Demo', true),
  ('DEMO0037', 'Felix', 'Example', true),
  ('DEMO0038', 'Afua', 'Placeholder', true),
  ('DEMO0039', 'Yaa', 'Fakename', true),
  ('DEMO0040', 'Yaw', 'Fakename', true),
  ('DEMO0041', 'Kwaku', 'Demo', true),
  ('DEMO0042', 'Ethan', 'Placeholder', true),
  ('DEMO0043', 'Lina', 'Example', true),
  ('DEMO0044', 'Noah', 'Testperson', true),
  ('DEMO0045', 'Leo', 'Demo', true),
  ('DEMO0046', 'Yaw', 'Trial', true),
  ('DEMO0047', 'Afua', 'Placeholder', true),
  ('DEMO0048', 'Jonah', 'Specimen', true),
  ('DEMO0049', 'Kojo', 'Fakename', true),
  ('DEMO0050', 'Ruby', 'Sample', true),
  ('DEMO0051', 'Kojo', 'Sample', true),
  ('DEMO0052', 'Theo', 'Fakename', true),
  ('DEMO0053', 'Afua', 'Placeholder', true),
  ('DEMO0054', 'Esi', 'Demo', true),
  ('DEMO0055', 'Jonah', 'Dummy', true),
  ('DEMO0056', 'Nia', 'Fakename', true),
  ('DEMO0057', 'Akosua', 'Trial', true),
  ('DEMO0058', 'Afua', 'Trial', true),
  ('DEMO0059', 'Abena', 'Placeholder', false),
  ('DEMO0060', 'Abena', 'Demo', false)
on conflict (student_code) do nothing;

-- Feeding plans: a mix of once / twice / thrice a day. DEMO0057-DEMO0060 are
-- left without a plan to show unassigned students.
update public.students
set plan_code = (array['once', 'twice', 'thrice', 'thrice'])[(substring(student_code from 5)::int % 4) + 1]
where student_code like 'DEMO%' and substring(student_code from 5)::int <= 56;
