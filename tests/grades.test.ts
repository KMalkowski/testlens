import { calculateGrade, gradeFromScore } from "../src/grading/grades.js";

describe("grading", () => {
  it("maps numeric scores to MVP letter grades", () => {
    expect(gradeFromScore(10)).toBe("A");
    expect(gradeFromScore(8)).toBe("B");
    expect(gradeFromScore(6)).toBe("C");
    expect(gradeFromScore(4)).toBe("D");
    expect(gradeFromScore(2)).toBe("F");
  });

  it("applies an untagged grade cap", () => {
    expect(calculateGrade(10, 10, "C")).toBe("C");
  });
});
