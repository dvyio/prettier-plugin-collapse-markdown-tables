/** @fileoverview Runs mutation checks against parser-heavy normalizer code. */

export default {
  coverageAnalysis: 'perTest',
  mutate: [
    'src/normalizer/lineUtils.ts:180-260',
    'src/normalizer/mdxEsm.ts:248-381',
    'src/normalizer/mdxJsx.ts:76-147',
    'src/normalizer/protectedRegions.ts:43-188',
    'src/normalizer/tableRender.ts:81-353',
    'src/normalizer/tableRepair.ts:138-249',
    'src/normalizer/tableRows.ts:400-470',
  ],
  packageManager: 'npm',
  reporters: ['clear-text', 'progress'],
  testRunner: 'vitest',
  thresholds: {
    break: 60,
    high: 70,
    low: 60,
  },
  vitest: {
    configFile: 'vitest.config.mjs',
    related: true,
  },
};
