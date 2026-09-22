/**
 * Thresholds shared between the loop and the agents.
 *
 * They live here rather than in either module because both need the same number
 * and a disagreement between them would show up as an account that one stage
 * calls researched and the next calls unknown.
 */

/**
 * Below this, the Company Twin holds essentially nothing, and any score derived
 * from it is a measurement of our own ignorance rather than of the company. An
 * account under it is research-failed, not researched — the distinction matters,
 * because "researched, scored 10" reads as a real finding and "we learned
 * nothing" does not.
 */
export const MIN_UNDERSTANDING_TO_SCORE = 10;
