import { useState, useEffect } from "react";
import { Link } from "react-router";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn, formatPrice } from "~/lib/utils";
import type { InstructorAnalytics, AnalyticsPeriod } from "~/services/analyticsService";

type SortKey = keyof Pick<
  InstructorAnalytics["courses"][number],
  | "title"
  | "listPrice"
  | "revenue"
  | "salesCount"
  | "enrollmentCount"
  | "averageRating"
  | "ratingCount"
>;
type SortDir = "asc" | "desc";

interface Props {
  analytics: InstructorAnalytics;
  period: AnalyticsPeriod;
}

const PERIODS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "12m", label: "12mo" },
  { value: "all", label: "All" },
];

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDateLabel(date: string, period: AnalyticsPeriod): string {
  if (period === "7d" || period === "30d") {
    const [, month, day] = date.split("-");
    return `${MONTH_ABBR[Number(month) - 1]} ${Number(day)}`;
  }
  const [year, month] = date.split("-");
  return `${MONTH_ABBR[Number(month) - 1]} '${year.slice(2)}`;
}

function formatRevenue(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const TABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "title", label: "Course" },
  { key: "listPrice", label: "List Price" },
  { key: "revenue", label: "Revenue" },
  { key: "salesCount", label: "Sales" },
  { key: "enrollmentCount", label: "Enrollments" },
  { key: "averageRating", label: "Avg Rating" },
  { key: "ratingCount", label: "Ratings" },
];

function SortIndicator({
  col,
  sortKey,
  sortDir,
}: {
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  if (col !== sortKey) {
    return <ChevronUp className="size-3 opacity-30" />;
  }
  return sortDir === "asc" ? (
    <ChevronUp className="size-3" />
  ) : (
    <ChevronDown className="size-3" />
  );
}

export function AnalyticsDashboard({ analytics, period }: Props) {
  const { summary, timeSeries, courses } = analytics;
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const isEmpty =
    courses.length === 0 ||
    (summary.totalRevenue === 0 &&
      summary.totalEnrollments === 0 &&
      summary.ratingCount === 0);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedCourses = [...courses].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity;
    const bv = b[sortKey] ?? -Infinity;
    if (typeof av === "string" && typeof bv === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortDir === "asc"
      ? (av as number) - (bv as number)
      : (bv as number) - (av as number);
  });

  const chartData = timeSeries.map((pt) => ({
    label: formatDateLabel(pt.date, period),
    revenue: pt.revenue / 100,
  }));

  return (
    <div className="space-y-6">
      <div className="flex gap-1">
        {PERIODS.map((p) => (
          <Link
            key={p.value}
            to={`?period=${p.value}`}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              period === p.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {isEmpty ? (
        <div className="flex items-center justify-center rounded-xl border py-24 text-muted-foreground">
          <p>No revenue data yet. Publish a course to start tracking analytics.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatRevenue(summary.totalRevenue)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Enrollments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {summary.totalEnrollments.toLocaleString()}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Average Rating
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {summary.averageRating !== null
                    ? `${summary.averageRating} / 5`
                    : "—"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {summary.ratingCount > 0
                    ? `${summary.ratingCount} rating${summary.ratingCount !== 1 ? "s" : ""}`
                    : "No ratings yet"}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Revenue Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              {mounted ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart
                    data={chartData}
                    margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                    />
                    <Tooltip
                      formatter={(value) => [
                        typeof value === "number"
                          ? `$${value.toFixed(2)}`
                          : value,
                        "Revenue",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px]" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Courses</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    {TABLE_COLUMNS.map(({ key, label }) => (
                      <th
                        key={key}
                        className="px-6 py-3 text-left text-xs font-medium text-muted-foreground"
                      >
                        <button
                          onClick={() => handleSort(key)}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          {label}
                          <SortIndicator
                            col={key}
                            sortKey={sortKey}
                            sortDir={sortDir}
                          />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedCourses.map((course) => (
                    <tr
                      key={course.courseId}
                      className="border-b last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-6 py-3 font-medium">{course.title}</td>
                      <td className="px-6 py-3">{formatPrice(course.listPrice)}</td>
                      <td className="px-6 py-3">{formatRevenue(course.revenue)}</td>
                      <td className="px-6 py-3">{course.salesCount}</td>
                      <td className="px-6 py-3">{course.enrollmentCount}</td>
                      <td className="px-6 py-3">
                        {course.averageRating !== null ? course.averageRating : "—"}
                      </td>
                      <td className="px-6 py-3">{course.ratingCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
