/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

module.exports = {
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  collectCoverage: true,
  // Floors seeded just below currently-measured coverage so the gate guards against
  // regressions. Coverage jumped after removing the unused nag-suppression helper
  // (measured: statements/lines ~98%, branches 75%, functions 100%).
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 70,
      functions: 100,
      lines: 95
    }
  }
};
