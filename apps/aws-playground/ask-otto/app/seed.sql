CREATE TABLE IF NOT EXISTS guides (
    id      serial PRIMARY KEY,
    product text NOT NULL,
    topic   text NOT NULL,
    title   text NOT NULL,
    body    text NOT NULL
);

INSERT INTO guides (product, topic, title, body)
SELECT product, topic, title, body
FROM (VALUES
    ('hiking boots', 'warranty', 'Hiking boots warranty',
     'Our hiking boots carry a two-year warranty against sole separation and seam failure. Send a photo of the damage and your order number, and we will repair or replace the pair.'),
    ('sleeping bag', 'returns', 'Returning a sleeping bag',
     'Unused sleeping bags can be returned within 60 days. Pack the bag loosely in its storage sack, not its compression sack, and print the prepaid label from your order page.'),
    ('tent', 'specs', 'Tent storm rating',
     'The Fjord 2 tent is rated for sustained winds of 80 km/h and a 3000 mm hydrostatic head. Guy out all six points before a storm.'),
    ('rain jacket', 'warranty', 'Rain jacket warranty',
     'Rain jackets have a three-year warranty on taped seams and zippers. Delamination from normal use is covered.'),
    ('tent', 'returns', 'Returning a tent',
     'Tents can be returned within 60 days if they have not been pitched outdoors. Include all poles, pegs, and the footprint.'),
    ('hiking boots', 'returns', 'Returning hiking boots',
     'Boots worn only indoors can be returned within 30 days. Worn boots are covered by the warranty instead.'),
    ('rain jacket', 'specs', 'Rain jacket waterproof rating',
     'Our rain jackets use a 20000 mm waterproof membrane with fully taped seams and a storm hood.'),
    ('sleeping bag', 'specs', 'Sleeping bag temperature ratings',
     'Sleeping bag comfort ratings follow ISO 23537. Choose a bag rated 5 degrees below the coldest night you expect.'),
    ('hiking boots', 'specs', 'Hiking boots waterproofing',
     'Our hiking boots use a waterproof membrane and a gusseted tongue. Re-treat the leather every season.'),
    ('rain jacket', 'returns', 'Returning a rain jacket',
     'Unworn rain jackets with tags attached can be returned within 60 days for a full refund.')
) AS seed (product, topic, title, body)
WHERE NOT EXISTS (SELECT 1 FROM guides);
