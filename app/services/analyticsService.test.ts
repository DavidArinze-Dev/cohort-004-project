import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getInstructorAnalytics } from "./analyticsService";

// Helpers to insert test data with explicit timestamps

function insertPurchase(
  courseId: number,
  pricePaid: number,
  createdAt: string
) {
  return testDb
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId, pricePaid, createdAt })
    .returning()
    .get();
}

function insertEnrollment(courseId: number, enrolledAt: string) {
  return testDb
    .insert(schema.enrollments)
    .values({ userId: base.user.id, courseId, enrolledAt })
    .returning()
    .get();
}

function insertRating(courseId: number, rating: number, createdAt: string) {
  return testDb
    .insert(schema.courseRatings)
    .values({
      userId: base.user.id,
      courseId,
      rating,
      createdAt,
      updatedAt: createdAt,
    })
    .returning()
    .get();
}

function insertCourse(
  instructorId: number,
  title: string,
  slug: string,
  price = 0
) {
  return testDb
    .insert(schema.courses)
    .values({
      title,
      slug,
      description: "A course",
      instructorId,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
      price,
    })
    .returning()
    .get();
}

const NOW = new Date().toISOString();
const OLD = "2020-01-01T00:00:00.000Z";

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  // ─── Empty State ───

  describe("instructor with no courses", () => {
    it("returns zeroed summary", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();

      const result = getInstructorAnalytics({
        instructorId: otherInstructor.id,
        period: "30d",
      });

      expect(result.summary.totalRevenue).toBe(0);
      expect(result.summary.totalEnrollments).toBe(0);
      expect(result.summary.averageRating).toBeNull();
      expect(result.summary.ratingCount).toBe(0);
    });

    it("returns empty timeSeries and courses arrays", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();

      const result = getInstructorAnalytics({
        instructorId: otherInstructor.id,
        period: "30d",
      });

      expect(result.timeSeries).toHaveLength(0);
      expect(result.courses).toHaveLength(0);
    });
  });

  // ─── Summary Totals ───

  describe("summary totals", () => {
    it("sums revenue across multiple purchases on one course", () => {
      insertPurchase(base.course.id, 4999, NOW);
      insertPurchase(base.course.id, 4999, NOW);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      expect(result.summary.totalRevenue).toBe(9998);
    });

    it("sums revenue across multiple courses", () => {
      const course2 = insertCourse(
        base.instructor.id,
        "Course 2",
        "course-2",
        2999
      );
      insertPurchase(base.course.id, 4999, NOW);
      insertPurchase(course2.id, 2999, NOW);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      expect(result.summary.totalRevenue).toBe(7998);
    });

    it("counts enrollments across courses", () => {
      const course2 = insertCourse(
        base.instructor.id,
        "Course 2",
        "course-2"
      );
      insertEnrollment(base.course.id, NOW);
      insertEnrollment(base.course.id, NOW);
      insertEnrollment(course2.id, NOW);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      expect(result.summary.totalEnrollments).toBe(3);
    });

    it("computes average rating across all courses", () => {
      const course2 = insertCourse(
        base.instructor.id,
        "Course 2",
        "course-2"
      );
      insertRating(base.course.id, 4, NOW);
      insertRating(course2.id, 2, NOW);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      // (4 + 2) / 2 = 3.0
      expect(result.summary.averageRating).toBe(3);
      expect(result.summary.ratingCount).toBe(2);
    });

    it("returns null averageRating when no ratings exist", () => {
      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      expect(result.summary.averageRating).toBeNull();
      expect(result.summary.ratingCount).toBe(0);
    });
  });

  // ─── Period Filtering ───

  describe("period filtering", () => {
    it("excludes purchases outside 7d window", () => {
      insertPurchase(base.course.id, 4999, NOW);
      insertPurchase(base.course.id, 9999, OLD);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "7d",
      });

      expect(result.summary.totalRevenue).toBe(4999);
    });

    it("excludes purchases outside 30d window", () => {
      insertPurchase(base.course.id, 4999, NOW);
      insertPurchase(base.course.id, 9999, OLD);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      expect(result.summary.totalRevenue).toBe(4999);
    });

    it("excludes purchases outside 12m window", () => {
      insertPurchase(base.course.id, 4999, NOW);
      insertPurchase(base.course.id, 9999, OLD);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "12m",
      });

      expect(result.summary.totalRevenue).toBe(4999);
    });

    it("includes all purchases for 'all' period", () => {
      insertPurchase(base.course.id, 4999, NOW);
      insertPurchase(base.course.id, 9999, OLD);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "all",
      });

      expect(result.summary.totalRevenue).toBe(14998);
    });

    it("excludes enrollments outside period", () => {
      insertEnrollment(base.course.id, NOW);
      insertEnrollment(base.course.id, OLD);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      expect(result.summary.totalEnrollments).toBe(1);
    });

    it("excludes ratings outside period", () => {
      insertRating(base.course.id, 5, NOW);
      insertRating(base.course.id, 1, OLD);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      expect(result.summary.averageRating).toBe(5);
      expect(result.summary.ratingCount).toBe(1);
    });
  });

  // ─── Time Series ───

  describe("time series", () => {
    it("returns 7 daily buckets for 7d period", () => {
      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "7d",
      });

      expect(result.timeSeries).toHaveLength(7);
    });

    it("returns 30 daily buckets for 30d period", () => {
      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      expect(result.timeSeries).toHaveLength(30);
    });

    it("returns monthly buckets for 12m period", () => {
      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "12m",
      });

      // 13 months: current month + 12 prior
      expect(result.timeSeries.length).toBeGreaterThanOrEqual(12);
      // All dates are YYYY-MM format
      for (const point of result.timeSeries) {
        expect(point.date).toMatch(/^\d{4}-\d{2}$/);
      }
    });

    it("fills zero-revenue days between purchases", () => {
      insertPurchase(base.course.id, 4999, NOW);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "7d",
      });

      expect(result.timeSeries).toHaveLength(7);
      const zeros = result.timeSeries.filter((p) => p.revenue === 0);
      expect(zeros.length).toBeGreaterThanOrEqual(1);
    });

    it("sums revenue for the correct date bucket", () => {
      insertPurchase(base.course.id, 4999, NOW);
      insertPurchase(base.course.id, 1000, NOW);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "7d",
      });

      const today = NOW.slice(0, 10);
      const todayPoint = result.timeSeries.find((p) => p.date === today);
      expect(todayPoint).toBeDefined();
      expect(todayPoint!.revenue).toBe(5999);
    });

    it("returns empty timeSeries for 'all' period with no purchases", () => {
      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "all",
      });

      expect(result.timeSeries).toHaveLength(0);
    });

    it("returns monthly buckets for 'all' period starting at earliest purchase", () => {
      insertPurchase(base.course.id, 4999, "2024-06-15T00:00:00.000Z");
      insertPurchase(base.course.id, 2000, NOW);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "all",
      });

      expect(result.timeSeries[0].date).toBe("2024-06");
      for (const point of result.timeSeries) {
        expect(point.date).toMatch(/^\d{4}-\d{2}$/);
      }
    });
  });

  // ─── Per-course Breakdown ───

  describe("per-course breakdown", () => {
    it("returns one entry per instructor course", () => {
      insertCourse(base.instructor.id, "Course 2", "course-2");

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      expect(result.courses).toHaveLength(2);
    });

    it("returns correct revenue and salesCount for a course", () => {
      insertPurchase(base.course.id, 4999, NOW);
      insertPurchase(base.course.id, 4999, NOW);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      const course = result.courses.find((c) => c.courseId === base.course.id)!;
      expect(course.revenue).toBe(9998);
      expect(course.salesCount).toBe(2);
    });

    it("returns zero revenue and salesCount for course with no purchases", () => {
      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      const course = result.courses.find((c) => c.courseId === base.course.id)!;
      expect(course.revenue).toBe(0);
      expect(course.salesCount).toBe(0);
    });

    it("returns correct enrollmentCount for a course", () => {
      insertEnrollment(base.course.id, NOW);
      insertEnrollment(base.course.id, NOW);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      const course = result.courses.find((c) => c.courseId === base.course.id)!;
      expect(course.enrollmentCount).toBe(2);
    });

    it("returns null averageRating and zero ratingCount for course with no ratings", () => {
      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      const course = result.courses.find((c) => c.courseId === base.course.id)!;
      expect(course.averageRating).toBeNull();
      expect(course.ratingCount).toBe(0);
    });

    it("returns correct averageRating and ratingCount for a course", () => {
      insertRating(base.course.id, 4, NOW);
      insertRating(base.course.id, 5, NOW);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      const course = result.courses.find((c) => c.courseId === base.course.id)!;
      expect(course.averageRating).toBe(4.5);
      expect(course.ratingCount).toBe(2);
    });

    it("includes listPrice from the course record", () => {
      const pricedCourse = insertCourse(
        base.instructor.id,
        "Priced Course",
        "priced-course",
        7999
      );

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      const course = result.courses.find((c) => c.courseId === pricedCourse.id)!;
      expect(course.listPrice).toBe(7999);
    });
  });

  // ─── Instructor Isolation ───

  describe("instructor isolation", () => {
    it("excludes courses and data belonging to other instructors", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();

      const otherCourse = insertCourse(
        otherInstructor.id,
        "Other Course",
        "other-course"
      );
      insertPurchase(otherCourse.id, 9999, NOW);
      insertEnrollment(otherCourse.id, NOW);
      insertRating(otherCourse.id, 1, NOW);

      // base instructor has no purchases
      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        period: "30d",
      });

      expect(result.summary.totalRevenue).toBe(0);
      expect(result.summary.totalEnrollments).toBe(0);
      expect(result.summary.averageRating).toBeNull();
      expect(result.courses.every((c) => c.courseId !== otherCourse.id)).toBe(
        true
      );
    });
  });
});
