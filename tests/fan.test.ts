import { expect, test } from 'claude-code/testing'

import { fanLine } from '../hooks/register'

test('fan-out connector puts the parent junction over the children', () => {
  expect(fanLine([2, 7, 12], 15)).toBe('  ┌────┼────┐  ')
  expect(fanLine([2, 9], 12)).toBe('  ┌───┴──┐  ')
})
