import { describe, expect, it } from 'vitest';
import { translate } from './i18n';

describe('translate', () => {
  it('Bangla and English, with values filled in', () => {
    expect(translate('en', 'home.hello', { name: 'Rafi' })).toBe('Hello, Rafi');
    expect(translate('bn', 'leave.available', { n: '৭' })).toBe('৭ দিন বাকি');
  });

  it('falls back to English, then to the key', () => {
    expect(translate('bn', 'no.such.key')).toBe('no.such.key');
    expect(translate('en', 'att.late')).toBe('Late {m} min');
  });
});
