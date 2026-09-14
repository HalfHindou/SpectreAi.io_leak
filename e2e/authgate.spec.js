import { test, expect } from '@playwright/test'

// AuthGate smoke scaffold. Both apps sit behind a sessionStorage team-password
// gate (AuthGate.jsx), auto-bypassed on localhost. These are placeholders for
// a human to flesh out - the goal here is a runnable structure, not coverage.

// Full AuthGate flow: needs the TEAM_GATE_PASSWORD and a running server. Left
// skipped so CI / a bare checkout never fails on a missing secret or port.
test.skip('AuthGate accepts the team password (TODO)', async ({ page }) => {
  // TODO: set TEAM_GATE_PASSWORD, start a dev server, then:
  //   - navigate to baseURL
  //   - fill the password field
  //   - submit and assert the app shell renders
  expect(process.env.TEAM_GATE_PASSWORD).toBeTruthy()
})

// One real navigation test, guarded so it only runs when E2E_BASE_URL is set
// (i.e. a server is actually up). No assertions on app internals yet - just
// proves the harness can reach the app and load a document.
test('app root responds when E2E_BASE_URL is set', async ({ page }) => {
  test.skip(!process.env.E2E_BASE_URL, 'set E2E_BASE_URL to run against a live server')
  const response = await page.goto('/')
  expect(response, 'expected a navigation response').toBeTruthy()
})
