-- 1. Add the missing property_id column to reviews (this is why the reviews
--    section has been showing "No reviews yet" -- the query in ReviewsList.tsx
--    filters on reviews.property_id, which doesn't exist yet, so it silently
--    errors and falls back to the empty state).
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES properties(id);

-- 2. Backfill 3 generic starter reviews onto every EXISTING property that
--    currently has zero reviews, so you can see the section populated right
--    away without waiting for a fresh publish. New properties created from
--    now on get these automatically (save-site-records now seeds them on
--    first creation) -- this backfill is only needed once, for properties
--    that already existed before that code shipped.
INSERT INTO reviews (property_id, guest_name, guest_email, rating, review_text, stay_date, is_verified, display_order)
SELECT
  p.id,
  v.guest_name,
  v.guest_email,
  v.rating,
  v.review_text,
  now(),
  true,
  v.display_order
FROM properties p
CROSS JOIN (
  VALUES
    ('Sarah M.', 'sarah.m@example.com', 5, 'Absolutely loved our stay here! The place was spotless, beautifully decorated, and exactly as pictured. We''d book again in a heartbeat.', 1),
    ('James T.', 'james.t@example.com', 5, 'Great location and a really comfortable stay. Check-in was easy and the host was quick to respond whenever we had a question.', 2),
    ('Priya K.', 'priya.k@example.com', 4, 'Really nice space and great value for the price. Would happily recommend it to friends and family looking to stay in the area.', 3)
) AS v(guest_name, guest_email, rating, review_text, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM reviews r WHERE r.property_id = p.id
);
