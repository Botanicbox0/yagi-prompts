-- Fix `you-are-a-prom-queen` ("하이틴 영화 주인공 되보기") aspect_default from 9:16 to 16:9.
-- The actual encoded film and poster are 16:9 (1280x720 / 1920x1080), which was mislabelled in 0016.
update prompt_items
set aspect_default = '16:9',
    featured = true,
    media = case
      when jsonb_typeof(media->'video') = 'object' and jsonb_typeof(media->'poster') = 'object' then
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(media, '{video,w}', '1280'::jsonb),
              '{video,h}', '720'::jsonb
            ),
            '{poster,w}', '1920'::jsonb
          ),
          '{poster,h}', '1080'::jsonb
        )
      else media
    end
where slug = 'you-are-a-prom-queen';

update prompt_items
set aspect_default = '4:3',
    featured = false,
    media = case
      when jsonb_typeof(media->'video') = 'object' and jsonb_typeof(media->'poster') = 'object' then
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(media, '{video,w}', '1664'::jsonb),
              '{video,h}', '1248'::jsonb
            ),
            '{poster,w}', '1664'::jsonb
          ),
          '{poster,h}', '1248'::jsonb
        )
      else media
    end
where slug = 'city-fashion-montage';
