// Maps an exercise's analyzerKey (exercises.analyzer_key in the database) to its on-device
// analyzer module. To add an exercise: create a module exporting ANALYZER_KEY,
// DEFAULT_CONFIG, ERROR_CATALOG and createEvaluator(config, {targetReps}) — see
// docs/EXERCISE_ANALYSIS.md — register it here, and set analyzer_key on the exercise row.

import * as referenceDtw from "./referenceDtw.js";
import * as shoulderAbduction from "./shoulderAbduction.js";

const ANALYZERS = {
  [shoulderAbduction.ANALYZER_KEY]: shoulderAbduction,
  // Generic: compares the patient with a therapist reference recording (analysisConfig.reference).
  [referenceDtw.ANALYZER_KEY]: referenceDtw,
};

export function getAnalyzer(analyzerKey) {
  return analyzerKey ? ANALYZERS[analyzerKey] ?? null : null;
}

export function isSupported(analyzerKey) {
  return getAnalyzer(analyzerKey) !== null;
}

/**
 * @param {string} analyzerKey
 * @param {object|null} serverConfig analysisConfig from GET /api/exercises/{id}
 * @param {{targetReps:number}} options
 */
export function createEvaluatorFor(analyzerKey, serverConfig, options) {
  const analyzer = getAnalyzer(analyzerKey);
  if (!analyzer) throw new Error(`No on-device analyzer registered for "${analyzerKey}"`);
  return analyzer.createEvaluator(serverConfig || {}, options);
}

export const SUPPORTED_ANALYZERS = Object.keys(ANALYZERS);
