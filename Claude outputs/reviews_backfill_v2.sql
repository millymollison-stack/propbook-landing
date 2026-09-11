-- Round 6 backfill: add the 3 generic starter reviews to EVERY property that
-- doesn't already have them -- including properties (like Surf House Baja)
-- that already have their own real reviews. The first backfill (already run)
-- only added them to properties with ZERO reviews, which skipped Surf House
-- Baja since it had real reviews -- David wants both showing together so he
-- can delete the generic ones himself from Admin later. This is safe to
-- re-run: it checks for these 3 specific guest_emails per property, not a
-- total review count, so it will never duplicate.
--
-- Dates are staggered (38 / 97 / 163 days ago) instead of all "now()", so
-- they read as a mix of real, separate stays.
INSERT INTO reviews (property_id, guest_name, guest_email, rating, review_text, stay_date, is_verified, display_order)
SELECT
  p.id,
  v.guest_name,
  v.guest_email,
  v.rating,
  v.review_text,
  now() - (v.days_ago || ' days')::interval,
  true,
  v.display_order
FROM properties p
CROSS JOIN (
  VALUES
    ('Sarah M.', 'sarah.m@example.com', 5, 'Absolutely loved our stay here! The place was spotless, beautifully decorated, and exactly as pictured. We''d book again in a heartbeat.', 1, 38),
    ('James T.', 'james.t@example.com', 5, 'Great location and a really comfortable stay. Check-in was easy and the host was quick to respond whenever we had a question.', 2, 97),
    ('Priya K.', 'priya.k@example.com', 4, 'Really nice space and great value for the price. Would happily recommend it to friends and family looking to stay in the area.', 3, 163)
) AS v(guest_name, guest_email, rating, review_text, display_order, days_ago)
WHERE NOT EXISTS (
  SELECT 1 FROM reviews r
  WHERE r.property_id = p.id
    AND r.guest_email = v.guest_email
);

-- Also fix the dates on generic reviews from the FIRST backfill (already
-- run earlier today) -- those all got the identical "now()" timestamp.
-- Matches on stay_date's date part = today, so it only touches the rows
-- that backfill just created and leaves alone anything since edited by hand.
UPDATE reviews SET stay_date = now() - interval '38 days'
WHERE guest_email = 'sarah.m@example.com' AND stay_date::date = CURRENT_DATE;

UPDATE reviews SET stay_date = now() - interval '97 days'
WHERE guest_email = 'james.t@example.com' AND stay_date::date = CURRENT_DATE;

UPDATE reviews SET stay_date = now() - interval '163 days'
WHERE guest_email = 'priya.k@example.com' AND stay_date::date = CURRENT_DATE;
