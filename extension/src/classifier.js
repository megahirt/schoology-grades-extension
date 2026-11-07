// classifier.js — real-vs-skip class classifier (pure JS, no browser APIs).
// Real classes have real grades posted; advisory / study-hall / house-group
// type sections have very little grade information. The setup wizard shows
// the recommendation; the user makes the final call.

const SKIP_PATTERNS = ['advisory', 'study hall', 'house group', 'homeroom', 'mentor'];

export function classifySection(section = {}) {
  const name = String(section.name || '');
  const gradedItemCount = Number(section.gradedItemCount) || 0;
  const assignmentCount = Number(section.assignmentCount) || 0;
  const hasPeriodGrade = Boolean(section.hasPeriodGrade);

  let score = 0;
  const reasons = [];

  if (hasPeriodGrade) {
    score += 40;
    reasons.push('Period grade posted (+40)');
  }
  const gradedPoints = Math.min(gradedItemCount * 3, 30);
  if (gradedPoints > 0) {
    score += gradedPoints;
    reasons.push(`${gradedItemCount} graded item(s) (+${gradedPoints})`);
  }
  const assignmentPoints = Math.min(assignmentCount, 10);
  if (assignmentPoints > 0) {
    score += assignmentPoints;
    reasons.push(`${assignmentCount} assignment(s) (+${assignmentPoints})`);
  }
  const lower = name.toLowerCase();
  if (SKIP_PATTERNS.some((p) => lower.includes(p))) {
    score -= 15;
    reasons.push('Name matches advisory/study-hall/house-group pattern (−15)');
  }

  let recommendation;
  if (score >= 60) recommendation = 'include';
  else if (score >= 25) recommendation = 'check';
  else recommendation = 'skip';

  return { recommendation, score, reasons };
}
