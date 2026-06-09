import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import {
  quizzes,
  quizQuestions,
  quizOptions,
  quizAttempts,
  quizAnswers,
} from "~/db/schema";

type QuestionResult = {
  questionId: number;
  correct: boolean;
  selectedOptionId: number | null;
  correctOptionId: number | null;
};

export type ComputeResultOutput = {
  attemptId: number;
  score: number;
  passed: boolean;
  grade: string;
  totalCorrect: number;
  totalQuestions: number;
  questionResults: QuestionResult[];
};

function gradeFromScore(score: number): string {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.7) return "C";
  if (score >= 0.6) return "D";
  return "F";
}

export function computeResult(
  userId: number,
  quizId: number,
  selectedAnswers: Record<number, number>
): ComputeResultOutput | null {
  const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
  if (!quiz) return null;

  const questions = db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(quizQuestions.position)
    .all();

  let correct = 0;
  const total = questions.length;
  const questionResults: QuestionResult[] = [];

  for (const q of questions) {
    const selectedOptionId = selectedAnswers[q.id] ?? null;

    const correctOpt = db
      .select()
      .from(quizOptions)
      .where(and(eq(quizOptions.questionId, q.id), eq(quizOptions.isCorrect, true)))
      .get();

    const correctOptionId = correctOpt?.id ?? null;
    const isCorrect = selectedOptionId !== null && selectedOptionId === correctOptionId;
    if (isCorrect) correct++;

    questionResults.push({
      questionId: q.id,
      correct: isCorrect,
      selectedOptionId,
      correctOptionId,
    });
  }

  const score = total > 0 ? correct / total : 0;
  const passed = score >= quiz.passingScore;
  const grade = gradeFromScore(score);

  const attempt = db
    .insert(quizAttempts)
    .values({ userId, quizId, score, passed })
    .returning()
    .get();

  for (const result of questionResults) {
    if (result.selectedOptionId !== null) {
      db.insert(quizAnswers)
        .values({
          attemptId: attempt.id,
          questionId: result.questionId,
          selectedOptionId: result.selectedOptionId,
        })
        .run();
    }
  }

  return {
    attemptId: attempt.id,
    score,
    passed,
    grade,
    totalCorrect: correct,
    totalQuestions: total,
    questionResults,
  };
}
