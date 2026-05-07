import type { Grade } from "../config/types.js";

const orderedGrades: Grade[] = ["A", "B", "C", "D", "F"];

export function gradeFromScore(score: number): Grade {
  if (score >= 9) {
    return "A";
  }

  if (score >= 7) {
    return "B";
  }

  if (score >= 5) {
    return "C";
  }

  if (score >= 3) {
    return "D";
  }

  return "F";
}

export function calculateGrade(
  usefulnessScore: number,
  flakinessScore: number,
  cap?: Grade,
): Grade {
  const score = Math.round((clampScore(usefulnessScore) + clampScore(flakinessScore)) / 2);
  const grade = gradeFromScore(score);

  if (!cap) {
    return grade;
  }

  return orderedGrades.indexOf(grade) > orderedGrades.indexOf(cap) ? grade : cap;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(10, score));
}
