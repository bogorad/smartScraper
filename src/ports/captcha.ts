import type { CaptchaSolveInput, CaptchaSolveResult } from '../domain/models.js';

export interface CaptchaPort {
  solveIfPresent(input: CaptchaSolveInput): Promise<CaptchaSolveResult>;
}
