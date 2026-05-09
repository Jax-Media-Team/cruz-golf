import { describe, expect, it } from "vitest";
import {
  validateCourseImport,
  type CourseImportResult
} from "../lib/ocr/course-import";

const PARS_18 = [4, 4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 5, 4, 3, 4, 4, 3, 5];
const SI_18 = [7, 11, 3, 13, 5, 15, 9, 17, 1, 8, 12, 4, 14, 6, 16, 10, 18, 2];

function baseResult(): CourseImportResult {
  return {
    course: { name: "Jacksonville Golf & CC", city: "Jacksonville", state: "FL" },
    holes: 18,
    pars: PARS_18.slice(),
    stroke_indexes: SI_18.slice(),
    stroke_indexes_ladies: null,
    tees: [
      {
        name: "Black",
        gender: "men",
        rating: 73.2,
        slope: 138,
        total_par: 72,
        front_par: 36,
        back_par: 36,
        total_yardage: 6800,
        front_yardage: 3400,
        back_yardage: 3400,
        yardages: PARS_18.map((p) => p * 90)
      }
    ],
    notes: null
  };
}

describe("validateCourseImport", () => {
  it("accepts a complete, well-formed result", () => {
    const v = validateCourseImport(baseResult());
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("requires a course name", () => {
    const r = baseResult();
    r.course.name = "";
    const v = validateCourseImport(r);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.toLowerCase().includes("name"))).toBe(true);
  });

  it("requires every hole to have a par", () => {
    const r = baseResult();
    r.pars[5] = null;
    const v = validateCourseImport(r);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("Hole 6 par"))).toBe(true);
  });

  it("flags duplicate stroke indexes as a hard error", () => {
    const r = baseResult();
    r.stroke_indexes[0] = 1;
    r.stroke_indexes[8] = 1; // already 1, but explicit dup
    const v = validateCourseImport(r);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.toLowerCase().includes("more than once"))).toBe(true);
  });

  it("flags missing stroke index entries", () => {
    const r = baseResult();
    r.stroke_indexes[3] = null;
    const v = validateCourseImport(r);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.toLowerCase().includes("stroke index"))).toBe(true);
  });

  it("flags out-of-range stroke index values", () => {
    const r = baseResult();
    r.stroke_indexes[2] = 99;
    const v = validateCourseImport(r);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("99"))).toBe(true);
  });

  it("requires at least one tee", () => {
    const r = baseResult();
    r.tees = [];
    const v = validateCourseImport(r);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.toLowerCase().includes("tee"))).toBe(true);
  });

  it("warns but does not block when rating/slope are blank", () => {
    const r = baseResult();
    r.tees[0].rating = null;
    r.tees[0].slope = null;
    const v = validateCourseImport(r);
    expect(v.ok).toBe(true);
    expect(v.warnings.length).toBeGreaterThan(0);
  });

  it("warns when slope is outside USGA 55–155", () => {
    const r = baseResult();
    r.tees[0].slope = 200;
    const v = validateCourseImport(r);
    expect(v.ok).toBe(true); // not a hard error — just unusual
    expect(v.warnings.some((w) => w.toLowerCase().includes("slope"))).toBe(true);
  });

  it("warns when a tee has blank yardages", () => {
    const r = baseResult();
    r.tees[0].yardages[10] = null;
    r.tees[0].yardages[11] = null;
    const v = validateCourseImport(r);
    expect(v.ok).toBe(true);
    expect(v.warnings.some((w) => w.toLowerCase().includes("blank"))).toBe(true);
  });

  it("validates a 9-hole course", () => {
    const r: CourseImportResult = {
      ...baseResult(),
      holes: 9,
      pars: PARS_18.slice(0, 9),
      stroke_indexes: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      tees: [
        {
          ...baseResult().tees[0],
          yardages: PARS_18.slice(0, 9).map((p) => p * 90)
        }
      ]
    };
    const v = validateCourseImport(r);
    expect(v.ok).toBe(true);
  });

  it("warns on unusual par values", () => {
    const r = baseResult();
    r.pars[0] = 7;
    const v = validateCourseImport(r);
    expect(v.ok).toBe(true);
    expect(v.warnings.some((w) => w.toLowerCase().includes("par is 7"))).toBe(true);
  });
});
