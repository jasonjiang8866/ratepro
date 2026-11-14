import { expect, it } from 'vitest';
import { transportArguments } from '../scripts/maybank-transport';
it('bounds transport comparisons without disabling certificate verification', () => {
  expect(transportArguments('default')).toEqual(['--http1.1']);
  expect(transportArguments('tls12')).toEqual(['--http1.1', '--tlsv1.2', '--tls-max', '1.2']);
  expect(() => transportArguments('--insecure')).toThrow('Unknown');
});
