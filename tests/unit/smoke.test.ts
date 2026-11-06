import { test, expect } from 'vitest';
import { APP_ID } from '../../src/app-id';

test('app id', () => expect(APP_ID).toBe('lumen'));
