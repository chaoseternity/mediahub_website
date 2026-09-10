DELETE FROM checkouts;
DELETE FROM equipment_tags;
DELETE FROM equipment;
DELETE FROM tags;

-- Tags
INSERT INTO tags (id, name) VALUES (1,   'Laptop');
INSERT INTO tags (id, name) VALUES (2, 'SD Card (Video)');
INSERT INTO tags (id, name) VALUES (3, 'SD Card (Photo)');

-- Equipment
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (1, 'Kamera', 'Primary filming laptop used for on-site recording and live preview', 'LP-KAM-001', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (2, 'DJ', 'Used for DJ sets, music playback and live sound mixing', 'LP-DJ-001', 'Working', 1, 'Media Room', 'Checked Out');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (3, 'Clapper', 'Used for production management, scripts and clapperboard software', 'LP-CLA-001', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (4, 'Bulbasaur', 'General-purpose laptop for presentations and event support', 'LP-BUL-001', 'Impaired', 1, 'Media Room', 'Checked Out');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (5, 'Middle Earth', 'High-performance editing laptop for post-production video work', 'LP-MID-001', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (6, 'Strawberry', 'Backup laptop; used when primary units are unavailable', 'LP-STR-001', 'Impaired', 1, 'Media Room', 'Unavailable (In Repairs)');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (7, 'SD-V-1', '128 GB UHS-I U3 V30 card rated for 4K video recording', 'SD-V-01', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (8, 'SD-V-2', '128 GB UHS-I U3 V30 card rated for 4K video recording', 'SD-V-02', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (9, 'SD-V-3', '128 GB UHS-I U3 V30 card rated for 4K video recording', 'SD-V-03', 'Working', 1, 'Media Room', 'Checked Out');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (10, 'SD-V-4', '128 GB UHS-I U3 V30 card rated for 4K video recording', 'SD-V-04', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (11, 'SD-V-5', '128 GB UHS-I U3 V30 card rated for 4K video recording', 'SD-V-05', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (12, 'SD-V-6', '128 GB UHS-I U3 V30 card rated for 4K video recording', 'SD-V-06', 'Working', 1, 'Media Room', 'Checked Out');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (13, 'SD-V-7', '128 GB UHS-I U3 V30 card rated for 4K video recording', 'SD-V-07', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (14, 'SD-V-8', '128 GB UHS-I U3 V30 card rated for 4K video recording', 'SD-V-08', 'Impaired', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (15, 'SD-V-9', '128 GB UHS-I U3 V30 card rated for 4K video recording', 'SD-V-09', 'Impaired', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (16, 'SD-V-10', '128 GB UHS-I U3 V30 card rated for 4K video recording', 'SD-V-10', 'Impaired', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (17, 'SD-P-1', '64 GB UHS-I U3 card for photography use', 'SD-P-01', 'Working', 1, 'Media Room', 'Checked Out');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (18, 'SD-P-2', '64 GB UHS-I U3 card for photography use', 'SD-P-02', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (19, 'SD-P-3', '64 GB UHS-I U3 card for photography use', 'SD-P-03', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (20, 'SD-P-4', '64 GB UHS-I U3 card for photography use', 'SD-P-04', 'Working', 1, 'Media Room', 'Checked Out');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (21, 'SD-P-5', '64 GB UHS-I U3 card for photography use', 'SD-P-05', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (22, 'SD-P-6', '64 GB UHS-I U3 card for photography use', 'SD-P-06', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (23, 'SD-P-7', '64 GB UHS-I U3 card for photography use', 'SD-P-07', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (24, 'SD-P-8', '64 GB UHS-I U3 card for photography use', 'SD-P-08', 'Working', 1, 'Media Room', 'Checked Out');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (25, 'SD-P-9', '64 GB UHS-I U3 card for photography use', 'SD-P-09', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (26, 'SD-P-10', '64 GB UHS-I U3 card for photography use', 'SD-P-10', 'Working', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (27, 'SD-P-11', '64 GB UHS-I U3 card for photography use', 'SD-P-11', 'Impaired', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (28, 'SD-P-12', '64 GB UHS-I U3 card for photography use', 'SD-P-12', 'Impaired', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (29, 'SD-P-13', '64 GB UHS-I U3 card for photography use', 'SD-P-13', 'Impaired', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (30, 'SD-P-14', '64 GB UHS-I U3 card for photography use', 'SD-P-14', 'Impaired', 1, 'Media Room', 'Available');
INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (31, 'SD-P-15', '64 GB UHS-I U3 card for photography use', 'SD-P-15', 'Impaired', 1, 'Media Room', 'Available');

-- Equipment tags
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (1, 1);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (2, 1);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (3, 1);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (4, 1);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (5, 1);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (6, 1);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (7, 2);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (8, 2);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (9, 2);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (10, 2);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (11, 2);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (12, 2);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (13, 2);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (14, 2);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (15, 2);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (16, 2);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (17, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (18, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (19, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (20, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (21, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (22, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (23, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (24, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (25, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (26, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (27, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (28, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (29, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (30, 3);
INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (31, 3);

-- Checkouts
INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, checked_out_at, expected_return_at, returned_at, notes) VALUES (2, null, 'AV Member', '2026-03-17 14:00:00', '2026-03-19 18:00:00', NULL, 'Borrowed for school concert on 19 Mar');
INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, checked_out_at, expected_return_at, returned_at, notes) VALUES (4, null, 'AV Member', '2026-03-18 09:00:00', '2026-03-18 22:00:00', NULL, 'Needed for CCA open house live stream');
INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, checked_out_at, expected_return_at, returned_at, notes) VALUES (9, null, 'AV Member', '2026-03-18 08:30:00', '2026-03-18 18:00:00', NULL, 'Filming school open house');
INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, checked_out_at, expected_return_at, returned_at, notes) VALUES (12, null, 'AV Admin', '2026-03-17 10:00:00', '2026-03-20 10:00:00', NULL, 'Documentary project footage');
INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, checked_out_at, expected_return_at, returned_at, notes) VALUES (17, null, 'AV Member', '2026-03-18 07:45:00', '2026-03-18 20:00:00', NULL, 'Open house photography');
INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, checked_out_at, expected_return_at, returned_at, notes) VALUES (20, null, 'AV Member', '2026-03-18 07:45:00', '2026-03-18 20:00:00', NULL, 'Open house photography (backup card)');
INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, checked_out_at, expected_return_at, returned_at, notes) VALUES (24, null, 'AV Admin', '2026-03-15 13:00:00', '2026-03-16 18:00:00', NULL, 'Sports day coverage');
INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, checked_out_at, expected_return_at, returned_at, notes) VALUES (1, null, 'AV Member', '2026-03-10 09:00:00', '2026-03-10 18:00:00', '2026-03-10 17:30:00', 'Used for Drama Night preview filming');
