-- Seed data for development
-- Run after migrations

-- Default materials are included in the scene graph default, not the catalog.
-- This seeds the furniture catalog with placeholder items.

insert into public.catalog_items (name, category, subcategory, gltf_url, thumbnail_url, metadata)
values
    ('Modern Sofa', 'furniture', 'seating', null, null, '{"width":2.0,"depth":0.9,"height":0.85}'::jsonb),
    ('Dining Table', 'furniture', 'tables', null, null, '{"width":1.6,"depth":0.9,"height":0.75}'::jsonb),
    ('Single Bed', 'furniture', 'beds', null, null, '{"width":0.9,"depth":2.0,"height":0.5}'::jsonb),
    ('Double Bed', 'furniture', 'beds', null, null, '{"width":1.6,"depth":2.0,"height":0.5}'::jsonb),
    ('Wardrobe', 'furniture', 'storage', null, null, '{"width":1.2,"depth":0.6,"height":2.2}'::jsonb),
    ('Kitchen Counter', 'furniture', 'kitchen', null, null, '{"width":1.8,"depth":0.6,"height":0.9}'::jsonb),
    ('Bathtub', 'furniture', 'bathroom', null, null, '{"width":1.7,"depth":0.8,"height":0.55}'::jsonb),
    ('Toilet', 'furniture', 'bathroom', null, null, '{"width":0.35,"depth":0.7,"height":0.4}'::jsonb)
on conflict do nothing;
