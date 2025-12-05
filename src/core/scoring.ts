import type { ElementDetails } from '../domain/models.js';
import { SCORING } from '../constants.js';

export function scoreElement(details: ElementDetails): number {
  let score = 0;

  if (details.textLength > SCORING.MIN_CONTENT_CHARS) {
    score += 0.3;
  }

  if (details.linkDensity < 0.3) {
    score += 0.2;
  }

  if (details.paragraphCount >= 3) {
    score += 0.15;
  }

  if (details.headingCount >= 1) {
    score += 0.1;
  }

  if (details.semanticScore > 0) {
    score += 0.15;
  }

  if (details.unwantedTagScore > 0) {
    score -= 0.3;
  }

  if (details.domDepth > 3 && details.domDepth < 10) {
    score += 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

export function rankXPathCandidates(
  candidates: Array<{ xpath: string; details: ElementDetails | null }>
): Array<{ xpath: string; score: number }> {
  return candidates
    .map(({ xpath, details }) => ({
      xpath,
      score: details ? scoreElement(details) : 0
    }))
    .sort((a, b) => b.score - a.score);
}
