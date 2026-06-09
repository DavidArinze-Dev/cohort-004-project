import { eq, sql, and, gte, inArray } from "drizzle-orm";
import { db } from "~/db";
import { courses, purchases, enrollments, courseRatings } from "~/db/schema";

// ─── Analytics Service ───
// Encapsulates all query logic for the instructor analytics dashboard.
// Returns all data needed in a single call behind a simple interface.

export type AnalyticsPeriod = "7d" | "30d" | "12m" | "all";

export type InstructorAnalytics = {
  summary: {
    totalRevenue: number;
    totalEnrollments: number;
    averageRating: number | null;
    ratingCount: number;
  };
  timeSeries: Array<{ date: string; revenue: number }>;
  courses: Array<{
    courseId: number;
    title: string;
    listPrice: number;
    revenue: number;
    salesCount: number;
    enrollmentCount: number;
    averageRating: number | null;
    ratingCount: number;
  }>;
};

function getStartDate(period: AnalyticsPeriod): string | null {
  if (period === "all") return null;
  const now = new Date();
  if (period === "7d") now.setDate(now.getDate() - 7);
  else if (period === "30d") now.setDate(now.getDate() - 30);
  else now.setFullYear(now.getFullYear() - 1);
  return now.toISOString();
}

function buildDateBuckets(
  period: AnalyticsPeriod,
  earliestDate: string | null
): string[] {
  const now = new Date();

  if (period === "7d" || period === "30d") {
    const days = period === "7d" ? 7 : 30;
    const buckets: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      buckets.push(d.toISOString().slice(0, 10));
    }
    return buckets;
  }

  // Monthly buckets for 12m / all
  let startYear: number;
  let startMonth: number;

  if (period === "12m") {
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - 1);
    startYear = start.getFullYear();
    startMonth = start.getMonth();
  } else {
    if (!earliestDate) return [];
    const start = new Date(earliestDate);
    startYear = start.getFullYear();
    startMonth = start.getMonth();
  }

  const buckets: string[] = [];
  let year = startYear;
  let month = startMonth;
  const endYear = now.getFullYear();
  const endMonth = now.getMonth();

  while (year < endYear || (year === endYear && month <= endMonth)) {
    buckets.push(`${year}-${String(month + 1).padStart(2, "0")}`);
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }

  return buckets;
}

export function getInstructorAnalytics(opts: {
  instructorId: number;
  period: AnalyticsPeriod;
}): InstructorAnalytics {
  const { instructorId, period } = opts;
  const startDate = getStartDate(period);

  const instructorCourses = db
    .select({ id: courses.id, title: courses.title, listPrice: courses.price })
    .from(courses)
    .where(eq(courses.instructorId, instructorId))
    .all();

  if (instructorCourses.length === 0) {
    return {
      summary: {
        totalRevenue: 0,
        totalEnrollments: 0,
        averageRating: null,
        ratingCount: 0,
      },
      timeSeries: [],
      courses: [],
    };
  }

  const courseIds = instructorCourses.map((c) => c.id);

  const purchaseWhere = startDate
    ? and(inArray(purchases.courseId, courseIds), gte(purchases.createdAt, startDate))
    : inArray(purchases.courseId, courseIds);

  const enrollmentWhere = startDate
    ? and(inArray(enrollments.courseId, courseIds), gte(enrollments.enrolledAt, startDate))
    : inArray(enrollments.courseId, courseIds);

  const ratingWhere = startDate
    ? and(inArray(courseRatings.courseId, courseIds), gte(courseRatings.createdAt, startDate))
    : inArray(courseRatings.courseId, courseIds);

  // ─── Per-course aggregates ───

  const purchaseAggs = db
    .select({
      courseId: purchases.courseId,
      revenue: sql<number>`coalesce(sum(${purchases.pricePaid}), 0)`,
      salesCount: sql<number>`count(*)`,
    })
    .from(purchases)
    .where(purchaseWhere)
    .groupBy(purchases.courseId)
    .all();

  const enrollmentAggs = db
    .select({
      courseId: enrollments.courseId,
      enrollmentCount: sql<number>`count(*)`,
    })
    .from(enrollments)
    .where(enrollmentWhere)
    .groupBy(enrollments.courseId)
    .all();

  const ratingAggs = db
    .select({
      courseId: courseRatings.courseId,
      averageRating: sql<number | null>`avg(${courseRatings.rating})`,
      ratingCount: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(ratingWhere)
    .groupBy(courseRatings.courseId)
    .all();

  // ─── Summary totals ───

  const summaryRating = db
    .select({
      averageRating: sql<number | null>`avg(${courseRatings.rating})`,
      ratingCount: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(ratingWhere)
    .get();

  // ─── Time series ───

  const bucketExpr =
    period === "7d" || period === "30d"
      ? sql<string>`strftime('%Y-%m-%d', ${purchases.createdAt})`
      : sql<string>`strftime('%Y-%m', ${purchases.createdAt})`;

  const timeSeriesRows = db
    .select({
      date: bucketExpr,
      revenue: sql<number>`sum(${purchases.pricePaid})`,
    })
    .from(purchases)
    .where(purchaseWhere)
    .groupBy(bucketExpr)
    .all();

  // ─── Assemble per-course data ───

  const purchaseMap = new Map(purchaseAggs.map((r) => [r.courseId, r]));
  const enrollmentMap = new Map(enrollmentAggs.map((r) => [r.courseId, r]));
  const ratingMap = new Map(ratingAggs.map((r) => [r.courseId, r]));

  const courseData = instructorCourses.map((course) => {
    const p = purchaseMap.get(course.id);
    const e = enrollmentMap.get(course.id);
    const r = ratingMap.get(course.id);
    const rawAvg = r?.averageRating;
    return {
      courseId: course.id,
      title: course.title,
      listPrice: course.listPrice,
      revenue: p?.revenue ?? 0,
      salesCount: p?.salesCount ?? 0,
      enrollmentCount: e?.enrollmentCount ?? 0,
      averageRating: rawAvg != null ? Math.round(rawAvg * 10) / 10 : null,
      ratingCount: r?.ratingCount ?? 0,
    };
  });

  // ─── Assemble summary ───

  const totalRevenue = courseData.reduce((s, c) => s + c.revenue, 0);
  const totalEnrollments = courseData.reduce((s, c) => s + c.enrollmentCount, 0);
  const rawSummaryAvg = summaryRating?.averageRating;
  const averageRating =
    rawSummaryAvg != null ? Math.round(rawSummaryAvg * 10) / 10 : null;
  const ratingCount = summaryRating?.ratingCount ?? 0;

  // ─── Assemble time series with gap filling ───

  const revenueByDate = new Map(timeSeriesRows.map((r) => [r.date, r.revenue]));

  let earliestDate: string | null = null;
  if (period === "all" && timeSeriesRows.length > 0) {
    const minBucket = timeSeriesRows.reduce(
      (min, r) => (r.date < min ? r.date : min),
      timeSeriesRows[0].date
    );
    earliestDate = `${minBucket}-01`;
  }

  const buckets = buildDateBuckets(period, earliestDate);
  const timeSeries = buckets.map((date) => ({
    date,
    revenue: revenueByDate.get(date) ?? 0,
  }));

  return {
    summary: { totalRevenue, totalEnrollments, averageRating, ratingCount },
    timeSeries,
    courses: courseData,
  };
}
