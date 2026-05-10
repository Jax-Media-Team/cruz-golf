/**
 * Pure helpers for the /courses page list — extracted so the dedup rules
 * can be regression-tested without booting Supabase or Next.js.
 *
 * Bug history: JGCC was rendering twice when present in the user's group:
 * once as the "Already added" hero tile, once in the regular alive-courses
 * list. Templates that shared a name with a group course also rendered
 * alongside the group's own course. These helpers enforce: a course never
 * appears in more than one section at a time.
 */

export type RawCourse = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  course_tees?: Array<{ id: string }> | null;
  deleted_at?: string | null;
};

export type RawTemplate = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  course_tees?: Array<{ id: string }> | null;
};

export type TemplateCardData = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  tee_count: number;
};

/** Split group courses into alive vs. archived buckets. */
export function partitionGroupCourses(courses: RawCourse[]) {
  const alive = courses.filter((c) => !c.deleted_at);
  const archived = courses.filter((c) => !!c.deleted_at);
  return { alive, archived };
}

/**
 * Filter cross-group templates so they NEVER collide with the group's own
 * courses. Excludes by id (same row flagged template + in-group) AND by
 * lowercased name (a separate template row that happens to share a name
 * with a group course — common for JGCC since multiple groups may have
 * imported it).
 */
export function filterTemplates(
  templates: RawTemplate[],
  groupCourses: RawCourse[]
): TemplateCardData[] {
  const groupIds = new Set(groupCourses.map((c) => c.id));
  const aliveNames = new Set(
    groupCourses
      .filter((c) => !c.deleted_at)
      .map((c) => c.name.toLowerCase())
  );
  return templates
    .filter((t) => !groupIds.has(t.id) && !aliveNames.has(t.name.toLowerCase()))
    .map((t) => ({
      id: t.id,
      name: t.name,
      city: t.city,
      state: t.state,
      tee_count: (t.course_tees ?? []).length
    }));
}

/**
 * Has the group already added a Jacksonville Golf & Country Club course?
 * Used to suppress the Quick Add tile so JGCC never appears twice.
 */
export function hasJgccInGroup(aliveGroupCourses: RawCourse[]): boolean {
  return aliveGroupCourses.some((c) =>
    c.name.toLowerCase().includes("jacksonville golf")
  );
}
