# Implementation Plan: Instructor Analytics Dashboard

Based on: `prd/instructor-analytics-dashboard.md`

---

## Phase 1 — Analytics Service (Data Layer)

Build a single `analyticsService.ts` in `app/services/` that encapsulates all DB queries for the dashboard. No UI changes in this phase — purely the data layer.

### Tasks

1. **Revenue queries**
   - `getCourseRevenue(courseId, since?)` — total revenue + sales count from `purchases`, optionally filtered by `createdAt >= since`
   - `getRevenueOverTime(courseId, since?, granularity)` — revenue grouped by day or week for the chart

2. **Enrollment query**
   - `getCourseEnrollmentCount(courseId, since?)` — count of rows in `enrollments` for the course

3. **Completion / drop-off queries**
   - `getLessonCompletionRates(courseId, since?)` — for each lesson in the course, return `{ lessonId, lessonTitle, position, completedCount, totalEnrolled, completionRate }` ordered by lesson position

4. **Rating query**
   - `getCourseAverageRating(courseId, since?)` — average of `course_ratings.rating`, count of ratings

5. **Quiz performance query**
   - `getQuizScoresByLesson(courseId, since?)` — for each lesson with a quiz, return `{ lessonId, lessonTitle, avgScore, attemptCount }`

6. **Batch summary query (for course list)**
   - `getCoursesSummaryStats(courseIds)` — single query returning `{ courseId, totalRevenue, enrollmentCount, avgRating }` for all provided course IDs (avoids N+1 on the course list page)

7. **Write unit tests** for each function in `analyticsService.test.ts`

### Notes
- All `since` parameters accept a `Date | undefined`. When `undefined`, no date filter is applied (All time).
- Time range values map to: 7d → `subDays(now, 7)`, 30d → `subDays(now, 30)`, 90d → `subDays(now, 90)`, All time → `undefined`.
- Reuse the existing Drizzle `db` instance and schema imports used by other services.

---

## Phase 2 — Course List Summary Cards

Add revenue, enrollment, and rating stats to each course card on the instructor course list (`app/routes/instructor.tsx`).

### Tasks

1. **Update the loader** in `instructor.tsx`
   - After fetching the instructor's courses, call `getCoursesSummaryStats(courseIds)` from the analytics service
   - Merge stats into the course list data returned to the component

2. **Update the course card UI**
   - Add a three-item stats row beneath the existing course title/status: **Revenue** · **Enrollments** · **Avg Rating**
   - Use shadcn/ui `Badge` or simple styled `<span>` elements — keep it lightweight
   - Format currency as `$0.00`, rating as `★ 4.2` (or `—` if no ratings yet)
   - Show `—` for any metric with no data (zero-state)

### Notes
- No time range filter on the course list — these are all-time figures only.
- Stats are read-only; no interactivity beyond what already exists on the cards.

---

## Phase 3 — Analytics Tab Shell + Time Range Filter

Add the "Analytics" tab to the course editor and wire up the time range selector. No chart data yet — just the structural scaffolding.

### Tasks

1. **Add the Analytics tab trigger** in `instructor.$courseId.tsx`
   - Add `<TabsTrigger value="analytics">Analytics</TabsTrigger>` to the existing `<TabsList>` (after the "Students" tab)
   - Add the corresponding `<TabsContent value="analytics">` block

2. **Build the time range selector component**
   - A controlled dropdown (`Select` from shadcn/ui) with options: Last 7 days / Last 30 days / Last 90 days / All time
   - Default: Last 30 days
   - Render at the top of the Analytics tab content, above the sub-tabs
   - Store selected value in local component state (`useState`) — no URL persistence needed for v1

3. **Build the Analytics sub-tab structure**
   - Three sub-tabs inside the Analytics tab: **Overview**, **Engagement**, **Performance**
   - Use a nested `<Tabs>` component (shadcn/ui supports this)
   - Each sub-tab renders a placeholder for now

4. **Pass time range down** via props or context to all three sub-tab components

### Notes
- The time range filter is a single piece of state at the Analytics tab level — all three sub-tabs read from it.
- No loader changes needed in this phase.

---

## Phase 4 — Overview Sub-tab (Revenue & Sales)

Implement the Overview sub-tab: total revenue, sales count, and revenue-over-time chart.

### Tasks

1. **Update the course editor loader**
   - Accept an optional `timeRange` search param (7d / 30d / 90d / all)
   - Call `getCourseRevenue()` and `getRevenueOverTime()` from the analytics service
   - Return `{ totalRevenue, salesCount, revenueChartData }` alongside existing loader data

2. **Build the Overview sub-tab component**
   - Two stat cards at the top: **Total Revenue** and **Total Sales**
   - A line or bar chart below using shadcn/ui's `ChartContainer` + Recharts `BarChart` / `LineChart`
   - X-axis: dates, Y-axis: revenue in dollars
   - Zero-state: "No sales data for this period" when `revenueChartData` is empty

3. **Wire time range filter to loader**
   - When the time range dropdown changes, append `?timeRange=30d` (etc.) to the URL via `useNavigate` or a form submission so the loader re-runs with the new filter

### Notes
- Revenue should be displayed in dollars (divide stored cents by 100 if stored as integers, or format as-is if stored as decimals — check `purchases.amount` type in schema).
- Chart granularity: daily for 7d/30d, weekly for 90d/all-time.

---

## Phase 5 — Engagement Sub-tab (Completion & Drop-off)

Implement the Engagement sub-tab: per-lesson completion rates and drop-off visualisation.

### Tasks

1. **Update the loader**
   - Call `getLessonCompletionRates(courseId, since)` from the analytics service
   - Return `lessonCompletionData: { lessonId, lessonTitle, position, completionRate }[]`

2. **Build the Engagement sub-tab component**
   - A single horizontal bar chart (Recharts `BarChart` with `layout="vertical"`)
   - Y-axis: lesson titles (ordered by position), X-axis: completion rate as a percentage (0–100%)
   - Bars are coloured on a gradient (green at high completion, amber/red at low) to make drop-off visually obvious
   - A summary stat at the top: **Overall Course Completion Rate** (% of enrolled students who completed all lessons)
   - Zero-state: "No engagement data for this period" when no lesson progress records exist

### Notes
- Lesson titles should be truncated if long (max ~40 chars) to keep the chart readable.
- Drop-off is implied by the bar chart — no separate "drop-off" metric needed; a steep fall between two consecutive lessons is the signal.

---

## Phase 6 — Performance Sub-tab (Ratings & Quiz Scores)

Implement the Performance sub-tab: average course rating and per-lesson quiz scores.

### Tasks

1. **Update the loader**
   - Call `getCourseAverageRating(courseId, since)` and `getQuizScoresByLesson(courseId, since)`
   - Return `{ avgRating, ratingCount, quizData: { lessonId, lessonTitle, avgScore, attemptCount }[] }`

2. **Build the Performance sub-tab component**

   **Ratings section:**
   - A large stat card showing average rating (e.g. `★ 4.2`) and total number of ratings
   - Zero-state: "No ratings yet" if `ratingCount === 0`

   **Quiz scores section:**
   - A grouped bar chart or table showing average score per lesson quiz
   - Each entry: lesson title + average score (%) + number of attempts
   - Zero-state: "No quiz attempts for this period" when `quizData` is empty
   - If a course has no quizzes at all, show: "This course has no quizzes"

### Notes
- Average score should be displayed as a percentage.
- Lessons without quizzes are excluded from the quiz scores section entirely.

---

## Phase 7 — Polish & Zero States

Final hardening pass across all phases before shipping.

### Tasks

1. **Zero states** — audit every chart and stat card; ensure every empty/null case renders a friendly message rather than a broken UI or `$NaN`
2. **Loading states** — add skeleton loaders (shadcn/ui `Skeleton`) to charts while the loader is resolving on tab navigation
3. **Responsive layout** — verify the analytics tab renders correctly on narrower viewports; stack cards vertically on mobile
4. **Accessibility** — ensure all charts have accessible labels; stat cards use semantic HTML
5. **Test coverage** — write tests for the analytics service functions if not already complete from Phase 1

---

## Dependency Order

```
Phase 1 (service)
    └── Phase 2 (course list cards)
    └── Phase 3 (tab shell)
            └── Phase 4 (overview)
            └── Phase 5 (engagement)
            └── Phase 6 (performance)
                    └── Phase 7 (polish)
```

Phases 2, 4, 5, and 6 can begin as soon as Phase 1 is done. Phases 4–6 can be built in parallel once Phase 3's shell is in place.
