-- LOCAL DEVELOPMENT SAMPLE DATA ONLY.
-- All names are fictional. Do not load this into a production project.
-- Student IDs are DEMO0001-DEMO0060. Type one and press Enter on the check-in screen to simulate a scan.
-- DEMO0059 and DEMO0060 are inactive, to demonstrate the inactive-student message.

update public.app_settings set school_name = 'Demo Primary School', timezone = 'UTC';

insert into public.students (student_code, first_name, last_name, class_name, active) values
  ('DEMO0001', 'Zara', 'Example', '4A', true),
  ('DEMO0002', 'Ama', 'Placeholder', '4B', true),
  ('DEMO0003', 'Kojo', 'Demo', '5A', true),
  ('DEMO0004', 'Abena', 'Example', '5B', true),
  ('DEMO0005', 'Ethan', 'Specimen', '6A', true),
  ('DEMO0006', 'Esi', 'Dummy', '6B', true),
  ('DEMO0007', 'Fiifi', 'Sample', '4A', true),
  ('DEMO0008', 'Ama', 'Example', '4B', true),
  ('DEMO0009', 'Akosua', 'Demo', '5A', true),
  ('DEMO0010', 'Maya', 'Dummy', '5B', true),
  ('DEMO0011', 'Ama', 'Specimen', '6A', true),
  ('DEMO0012', 'Akosua', 'Specimen', '6B', true),
  ('DEMO0013', 'Fiifi', 'Demo', '4A', true),
  ('DEMO0014', 'Yaa', 'Dummy', '4B', true),
  ('DEMO0015', 'Adwoa', 'Sample', '5A', true),
  ('DEMO0016', 'Ivy', 'Testperson', '5B', true),
  ('DEMO0017', 'Lina', 'Mockley', '6A', true),
  ('DEMO0018', 'Efua', 'Placeholder', '6B', true),
  ('DEMO0019', 'Abena', 'Demo', '4A', true),
  ('DEMO0020', 'Ivy', 'Fakename', '4B', true),
  ('DEMO0021', 'Kwame', 'Example', '5A', true),
  ('DEMO0022', 'Afua', 'Example', '5B', true),
  ('DEMO0023', 'Kwaku', 'Fakename', '6A', true),
  ('DEMO0024', 'Noah', 'Placeholder', '6B', true),
  ('DEMO0025', 'Theo', 'Sample', '4A', true),
  ('DEMO0026', 'Omar', 'Trial', '4B', true),
  ('DEMO0027', 'Leo', 'Example', '5A', true),
  ('DEMO0028', 'Jonah', 'Mockley', '5B', true),
  ('DEMO0029', 'Esi', 'Specimen', '6A', true),
  ('DEMO0030', 'Kwabena', 'Dummy', '6B', true),
  ('DEMO0031', 'Nia', 'Fakename', '4A', true),
  ('DEMO0032', 'Sofia', 'Demo', '4B', true),
  ('DEMO0033', 'Lina', 'Example', '5A', true),
  ('DEMO0034', 'Kofi', 'Demo', '5B', true),
  ('DEMO0035', 'Ivy', 'Placeholder', '6A', true),
  ('DEMO0036', 'Esi', 'Demo', '6B', true),
  ('DEMO0037', 'Felix', 'Example', '4A', true),
  ('DEMO0038', 'Afua', 'Placeholder', '4B', true),
  ('DEMO0039', 'Yaa', 'Fakename', '5A', true),
  ('DEMO0040', 'Yaw', 'Fakename', '5B', true),
  ('DEMO0041', 'Kwaku', 'Demo', '6A', true),
  ('DEMO0042', 'Ethan', 'Placeholder', '6B', true),
  ('DEMO0043', 'Lina', 'Example', '4A', true),
  ('DEMO0044', 'Noah', 'Testperson', '4B', true),
  ('DEMO0045', 'Leo', 'Demo', '5A', true),
  ('DEMO0046', 'Yaw', 'Trial', '5B', true),
  ('DEMO0047', 'Afua', 'Placeholder', '6A', true),
  ('DEMO0048', 'Jonah', 'Specimen', '6B', true),
  ('DEMO0049', 'Kojo', 'Fakename', '4A', true),
  ('DEMO0050', 'Ruby', 'Sample', '4B', true),
  ('DEMO0051', 'Kojo', 'Sample', '5A', true),
  ('DEMO0052', 'Theo', 'Fakename', '5B', true),
  ('DEMO0053', 'Afua', 'Placeholder', '6A', true),
  ('DEMO0054', 'Esi', 'Demo', '6B', true),
  ('DEMO0055', 'Jonah', 'Dummy', '4A', true),
  ('DEMO0056', 'Nia', 'Fakename', '4B', true),
  ('DEMO0057', 'Akosua', 'Trial', '5A', true),
  ('DEMO0058', 'Afua', 'Trial', '5B', true),
  ('DEMO0059', 'Abena', 'Placeholder', '6A', false),
  ('DEMO0060', 'Abena', 'Demo', '6B', false)
on conflict (student_code) do nothing;

-- Feeding plans: a mix of once / twice / thrice a day. DEMO0057-DEMO0060 are
-- left without a plan to show the "No plan set" section.
update public.students
set plan_code = (array['once', 'twice', 'thrice', 'thrice'])[(substring(student_code from 5)::int % 4) + 1]
where student_code like 'DEMO%' and substring(student_code from 5)::int <= 56;
