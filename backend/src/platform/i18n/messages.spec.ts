import { languageFromHeader, MSG, translate } from './messages.js';

describe('messages', () => {
  it('has English and Bangla text for every key', () => {
    for (const key of Object.keys(MSG)) {
      expect(translate(key, 'en')).not.toBe(key);
      expect(translate(key, 'bn')).not.toBe(key);
      expect(translate(key, 'bn')).not.toBe(translate(key, 'en'));
    }
  });

  it('returns unknown text unchanged', () => {
    expect(translate('Some free text', 'bn')).toBe('Some free text');
  });

  it('picks the language from Accept-Language', () => {
    expect(languageFromHeader('bn-BD,bn;q=0.9')).toBe('bn');
    expect(languageFromHeader('en-US')).toBe('en');
    expect(languageFromHeader(undefined)).toBe('en');
  });
});
