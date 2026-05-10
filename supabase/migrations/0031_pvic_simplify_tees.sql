-- 0031 — slim Ponte Vedra Inn & Club templates to one tee per color.
--
-- Patrick (2026-05-10): "I really just want the main tee boxes of every
-- course. Don't overcomplicate."
--
-- 0030 created Men's + Ladies' duplicates for shared tees (White, Green,
-- Red) on both Ocean and Lagoon. This drops the Ladies' rows and renames
-- the Men's rows to bare color names. Net: cleaner picker, less noise.
--
-- ONLY touches courses where is_template = true. Any user who has
-- already cloned PVIC into their group keeps every tee — their copy is
-- in their group, not in the template library, and is_template = false.
--
-- The course_holes for the dropped tees cascade-delete via the
-- course_tees → course_holes FK (set up in 0001).
--
-- Idempotent: re-running is a no-op once the Ladies' tees are gone.

do $SLIM$
declare
  v_dropped int := 0;
begin
  -- Drop every Ladies'-suffixed tee on PVIC templates.
  delete from public.course_tees t
   using public.courses c
   where t.course_id = c.id
     and c.is_template = true
     and lower(c.name) like '%ponte vedra%'
     and t.name ilike '%(Ladies'')%';
  get diagnostics v_dropped = row_count;
  raise notice 'Dropped % Ladies'' tees from PVIC templates', v_dropped;

  -- Rename surviving "Men's" tees to bare color names — there's nothing
  -- to disambiguate against anymore.
  update public.course_tees t
     set name = trim(replace(t.name, ' (Men''s)', ''))
   from public.courses c
   where t.course_id = c.id
     and c.is_template = true
     and lower(c.name) like '%ponte vedra%'
     and t.name like '%(Men''s)%';
end;
$SLIM$;
