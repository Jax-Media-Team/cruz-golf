import { describe, it, expect } from "vitest";
import {
  partitionGroupCourses,
  filterTemplates,
  hasJgccInGroup,
  type RawCourse,
  type RawTemplate
} from "@/lib/courses-page";

const jgccAlive: RawCourse = {
  id: "g-jgcc",
  name: "Jacksonville Golf & Country Club",
  city: "Jacksonville",
  state: "FL",
  course_tees: [{ id: "t1" }, { id: "t2" }],
  deleted_at: null
};
const jgccArchived: RawCourse = {
  ...jgccAlive,
  id: "g-jgcc-old",
  deleted_at: "2026-04-01T00:00:00Z"
};
const tpcSawgrass: RawCourse = {
  id: "g-tpc",
  name: "TPC Sawgrass",
  city: "Ponte Vedra",
  state: "FL",
  course_tees: [{ id: "t3" }],
  deleted_at: null
};

describe("partitionGroupCourses", () => {
  it("handles an empty group", () => {
    const { alive, archived } = partitionGroupCourses([]);
    expect(alive).toEqual([]);
    expect(archived).toEqual([]);
  });

  it("splits alive vs. archived by deleted_at", () => {
    const { alive, archived } = partitionGroupCourses([
      jgccAlive,
      jgccArchived,
      tpcSawgrass
    ]);
    expect(alive.map((c) => c.id).sort()).toEqual(["g-jgcc", "g-tpc"]);
    expect(archived.map((c) => c.id)).toEqual(["g-jgcc-old"]);
  });

  it("treats null and undefined deleted_at the same as alive", () => {
    const { alive, archived } = partitionGroupCourses([
      { ...tpcSawgrass, deleted_at: undefined },
      { ...tpcSawgrass, id: "g-tpc-2", deleted_at: null }
    ]);
    expect(alive).toHaveLength(2);
    expect(archived).toHaveLength(0);
  });
});

describe("filterTemplates", () => {
  it("returns all templates when the group is empty", () => {
    const templates: RawTemplate[] = [
      {
        id: "tmpl-1",
        name: "Pebble Beach",
        city: "Pebble Beach",
        state: "CA",
        course_tees: [{ id: "x" }, { id: "y" }, { id: "z" }]
      }
    ];
    const out = filterTemplates(templates, []);
    expect(out).toEqual([
      {
        id: "tmpl-1",
        name: "Pebble Beach",
        city: "Pebble Beach",
        state: "CA",
        tee_count: 3
      }
    ]);
  });

  it("excludes templates whose id is already in the group", () => {
    // Same row flagged is_template AND in this group — should appear in
    // YOUR COURSES, never in COURSE LIBRARY.
    const sameRow: RawTemplate = {
      id: "g-jgcc",
      name: "Jacksonville Golf & Country Club",
      city: "Jacksonville",
      state: "FL",
      course_tees: [{ id: "t1" }]
    };
    const out = filterTemplates([sameRow], [jgccAlive]);
    expect(out).toEqual([]);
  });

  it("excludes templates whose name collides with an alive group course", () => {
    // Different row, but same name. This is the JGCC case: many groups
    // import their own JGCC; one of them is also flagged is_template.
    // Patrick's group should NOT see it again in the library.
    const otherGroupJgcc: RawTemplate = {
      id: "tmpl-jgcc",
      name: "Jacksonville Golf & Country Club",
      city: "Jacksonville",
      state: "FL",
      course_tees: [{ id: "x" }]
    };
    const out = filterTemplates([otherGroupJgcc], [jgccAlive]);
    expect(out).toEqual([]);
  });

  it("name collision is case-insensitive", () => {
    const lowered: RawTemplate = {
      id: "tmpl-lower",
      name: "jacksonville golf & country club",
      city: null,
      state: null,
      course_tees: []
    };
    const out = filterTemplates([lowered], [jgccAlive]);
    expect(out).toEqual([]);
  });

  it("does NOT exclude a template that only matches an archived course's name", () => {
    // If you archived JGCC, the template should be visible again so you
    // can re-clone it. Otherwise archiving locks you out.
    const tmpl: RawTemplate = {
      id: "tmpl-jgcc",
      name: "Jacksonville Golf & Country Club",
      city: null,
      state: null,
      course_tees: [{ id: "x" }]
    };
    const out = filterTemplates([tmpl], [jgccArchived]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("tmpl-jgcc");
  });

  it("returns tee_count 0 when course_tees is missing or null", () => {
    const tmpl: RawTemplate = {
      id: "tmpl-x",
      name: "Augusta National",
      city: null,
      state: null,
      course_tees: null
    };
    const out = filterTemplates([tmpl], []);
    expect(out[0].tee_count).toBe(0);
  });

  it("preserves shape of city/state nulls", () => {
    const tmpl: RawTemplate = {
      id: "tmpl-x",
      name: "Mystery Links",
      city: null,
      state: null,
      course_tees: []
    };
    const out = filterTemplates([tmpl], []);
    expect(out[0].city).toBeNull();
    expect(out[0].state).toBeNull();
  });
});

describe("hasJgccInGroup", () => {
  it("is false for an empty group", () => {
    expect(hasJgccInGroup([])).toBe(false);
  });

  it("is true when JGCC is alive in the group", () => {
    expect(hasJgccInGroup([jgccAlive])).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(
      hasJgccInGroup([{ ...jgccAlive, name: "JACKSONVILLE GOLF & CC" }])
    ).toBe(true);
  });

  it("matches via prefix even with trailing modifiers", () => {
    expect(
      hasJgccInGroup([{ ...jgccAlive, name: "Jacksonville Golf - Renovated 2026" }])
    ).toBe(true);
  });

  it("ignores unrelated courses", () => {
    expect(hasJgccInGroup([tpcSawgrass])).toBe(false);
  });

  it("only inspects the courses passed in (caller is responsible for filtering archived)", () => {
    // Helper trusts the caller to pass alive courses. If you pass an
    // archived JGCC in, it'll still report true — that's by design;
    // partitionGroupCourses + this helper compose at the call site.
    expect(hasJgccInGroup([jgccArchived])).toBe(true);
  });
});

describe("integration: dedup invariant", () => {
  it("a JGCC alive in the group never appears as both 'your course' AND a template", () => {
    const groupCourses = [jgccAlive, tpcSawgrass];
    const templates: RawTemplate[] = [
      {
        id: "tmpl-jgcc",
        name: "Jacksonville Golf & Country Club",
        city: "Jacksonville",
        state: "FL",
        course_tees: [{ id: "x" }]
      },
      {
        id: "tmpl-pebble",
        name: "Pebble Beach",
        city: "Pebble Beach",
        state: "CA",
        course_tees: []
      }
    ];
    const { alive } = partitionGroupCourses(groupCourses);
    const visibleTemplates = filterTemplates(templates, groupCourses);
    const aliveIds = alive.map((c) => c.id);
    const tmplIds = visibleTemplates.map((t) => t.id);

    // No id appears in both lists.
    expect(aliveIds.some((id) => tmplIds.includes(id))).toBe(false);
    // No name appears in both lists.
    const aliveNames = alive.map((c) => c.name.toLowerCase());
    const tmplNames = visibleTemplates.map((t) => t.name.toLowerCase());
    expect(aliveNames.some((n) => tmplNames.includes(n))).toBe(false);

    // Quick Add tile would be suppressed.
    expect(hasJgccInGroup(alive)).toBe(true);
    // Pebble Beach still appears in the library.
    expect(tmplIds).toEqual(["tmpl-pebble"]);
  });

  it("a group with no JGCC sees the JGCC template AND the Quick Add tile is allowed", () => {
    const groupCourses = [tpcSawgrass];
    const templates: RawTemplate[] = [
      {
        id: "tmpl-jgcc",
        name: "Jacksonville Golf & Country Club",
        city: "Jacksonville",
        state: "FL",
        course_tees: [{ id: "x" }]
      }
    ];
    const { alive } = partitionGroupCourses(groupCourses);
    const visibleTemplates = filterTemplates(templates, groupCourses);
    expect(visibleTemplates).toHaveLength(1);
    expect(hasJgccInGroup(alive)).toBe(false);
  });
});
