/**
 * Centralized language configuration
 * This is the single source of truth for all supported languages
 */

export interface LanguageConfig {
  /** Language code (ISO 639-1) */
  code: string;
  /** Native language name */
  nativeName: string;
  /** English language name */
  englishName: string;
}

/**
 * Supported languages configuration
 * Add new languages here and they will be automatically available throughout the extension
 */
export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
  {
    code: 'en',
    nativeName: 'English',
    englishName: 'English',
  },
  {
    code: 'de',
    nativeName: 'Deutsch',
    englishName: 'German',
  },
  {
    code: 'ru',
    nativeName: 'Русский',
    englishName: 'Russian',
  },
  {
    code: 'zh',
    nativeName: '中文',
    englishName: 'Chinese',
  },
  {
    code: 'ko',
    nativeName: '한국어',
    englishName: 'Korean',
  },
  {
    code: 'ja',
    nativeName: '日本語',
    englishName: 'Japanese',
  },
  {
    code: 'kk',
    nativeName: 'Қазақша',
    englishName: 'Kazakh',
  },
];

/**
 * Get all language codes
 */
export function getEnabledLanguageCodes(): string[] {
  return SUPPORTED_LANGUAGES.map((lang) => lang.code);
}

/**
 * Get language configuration by code
 */
export function getLanguageConfig(code: string): LanguageConfig | undefined {
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === code);
}

/**
 * Get language native name by code
 */
export function getLanguageNativeName(code: string): string {
  const config = getLanguageConfig(code);
  return config?.nativeName || code;
}

/**
 * Get language English name by code
 */
export function getLanguageEnglishName(code: string): string {
  const config = getLanguageConfig(code);
  return config?.englishName || code;
}

/**
 * Get all languages as label-value pairs for UI selection
 */
export function getLanguageSelectionItems(): Array<{
  label: string;
  value: string;
  description?: string;
}> {
  return SUPPORTED_LANGUAGES.map((lang) => ({
    label: lang.nativeName,
    value: lang.code,
    description: lang.englishName !== lang.nativeName ? lang.englishName : undefined,
  }));
}

/**
 * Get package.json compatible enum configuration
 */
export function getPackageJsonLanguageEnum(): {
  enum: string[];
  enumDescriptions: string[];
} {
  return {
    enum: SUPPORTED_LANGUAGES.map((lang) => lang.code),
    enumDescriptions: SUPPORTED_LANGUAGES.map((lang) =>
      lang.englishName !== lang.nativeName
        ? `${lang.nativeName} (${lang.englishName})`
        : lang.englishName,
    ),
  };
}

/**
 * Default language code
 */
export const DEFAULT_LANGUAGE = 'en';

/**
 * Language codes type for type safety
 */
export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];
