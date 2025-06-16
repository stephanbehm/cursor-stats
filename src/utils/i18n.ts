import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { log } from './logger';
import { LanguagePack } from '../interfaces/i18n';
import {
  getEnabledLanguageCodes,
  getLanguageNativeName,
  DEFAULT_LANGUAGE,
} from '../config/languages';

// Language pack storage
const languagePacks: { [key: string]: LanguagePack } = {};

let currentLanguage = DEFAULT_LANGUAGE;
let currentLanguagePack: LanguagePack;
let onLanguageChangeCallback: ((newLanguage: string, languageLabel: string) => void) | null = null;

/**
 * Initialize internationalization system
 */
export function initializeI18n(): void {
  loadLanguagePacks();

  // Set initial language pack
  if (!currentLanguagePack) {
    const config = vscode.workspace.getConfiguration('cursorStats');
    const language = config.get<string>('language', DEFAULT_LANGUAGE);
    currentLanguagePack = languagePacks[language] || languagePacks[DEFAULT_LANGUAGE];
    currentLanguage = language;

    if (!currentLanguagePack) {
      log('[I18n] Critical: No language pack available! Extension may not work properly.', true);
    }
  }

  updateCurrentLanguage();

  // Listen for language setting changes
  vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
    if (e.affectsConfiguration('cursorStats.language')) {
      updateCurrentLanguage();
      log('[I18n] Language setting changed, reloading language pack');
    }
  });
}

/**
 * Load language pack file
 */
function loadLanguagePackFromFile(languageCode: string): LanguagePack | null {
  try {
    // Get extension root directory path
    const extensionPath = vscode.extensions.getExtension('Dwtexe.cursor-stats')?.extensionPath;
    if (!extensionPath) {
      log(`[I18n] Extension path not found`, true);
      return null;
    }

    // Try multiple paths to handle both development and production scenarios
    const possiblePaths = [
      // Production path (when extension is packaged)
      path.join(extensionPath, 'src', 'locales', `${languageCode}.json`),
      // Alternative production path
      path.join(extensionPath, 'locales', `${languageCode}.json`),
      // Development path
      path.join(extensionPath, 'out', 'locales', `${languageCode}.json`),
    ];

    let localesPath: string | null = null;
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        localesPath = testPath;
        break;
      }
    }

    if (!localesPath) {
      log(`[I18n] Language file not found in any of these paths:`, possiblePaths, true);
      return null;
    }

    const fileContent = fs.readFileSync(localesPath, 'utf8');
    const languagePack = JSON.parse(fileContent) as LanguagePack;

    log(`[I18n] Loaded language pack for: ${languageCode} from ${localesPath}`);
    return languagePack;
  } catch (error) {
    log(
      `[I18n] Error loading language pack for ${languageCode}: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
    return null;
  }
}

/**
 * Load all language packs
 */
function loadLanguagePacks(): void {
  const supportedLanguages = getEnabledLanguageCodes();

  for (const lang of supportedLanguages) {
    const pack = loadLanguagePackFromFile(lang);
    if (pack) {
      languagePacks[lang] = pack;
    }
  }

  // Ensure default language pack is loaded (required fallback language)
  if (!languagePacks[DEFAULT_LANGUAGE]) {
    log(
      `[I18n] Critical: ${DEFAULT_LANGUAGE.toUpperCase()} language pack not loaded! Extension may not work properly.`,
      true,
    );
  }

  log(`[I18n] Language packs loaded for: ${supportedLanguages.join(', ')}`);
}

/**
 * Update current language
 */
function updateCurrentLanguage(): void {
  const config = vscode.workspace.getConfiguration('cursorStats');
  const newLanguage = config.get<string>('language', DEFAULT_LANGUAGE);

  if (newLanguage !== currentLanguage) {
    const oldLanguage = currentLanguage;
    currentLanguage = newLanguage;

    // Get language pack, fallback to default language if not available
    const languagePack = languagePacks[newLanguage] || languagePacks[DEFAULT_LANGUAGE];
    if (languagePack) {
      currentLanguagePack = languagePack;
      log(`[I18n] Language changed to: ${newLanguage}`);

      // Trigger language change callback
      if (onLanguageChangeCallback && oldLanguage !== DEFAULT_LANGUAGE) {
        // Avoid triggering during initialization
        const languageLabel = getLanguageNativeName(newLanguage);
        onLanguageChangeCallback(newLanguage, languageLabel);
      }
    } else {
      log(`[I18n] Warning: No language pack found for ${newLanguage} or ${DEFAULT_LANGUAGE}`, true);
    }
  }
}

/**
 * Get translated text with fallback mechanism
 * @param key Translation key (supports nesting, e.g., 'statusBar.premiumFastRequests')
 * @param params Replacement parameters
 */
export function t(key: string, params?: { [key: string]: string | number }): string {
  let value = getTranslationValue(key, currentLanguagePack);

  // If translation not found in current language and current language is not default, try default language fallback
  if (value === null && currentLanguage !== DEFAULT_LANGUAGE && languagePacks[DEFAULT_LANGUAGE]) {
    log(
      `[I18n] Translation key '${key}' not found in ${currentLanguage}, falling back to ${DEFAULT_LANGUAGE}`,
    );
    value = getTranslationValue(key, languagePacks[DEFAULT_LANGUAGE]);
  }

  // If still no translation found, return the key itself
  if (value === null) {
    log(`[I18n] Translation key not found in any language pack: ${key}`, true);
    return key;
  }

  if (typeof value !== 'string') {
    log(`[I18n] Translation value is not a string: ${key}`, true);
    return key;
  }

  // Replace parameters
  if (params) {
    Object.keys(params).forEach((param) => {
      value = value.replace(new RegExp(`{${param}}`, 'g'), params[param].toString());
    });
  }

  return value;
}

/**
 * Helper function to get translation value from a language pack
 * @param key Translation key
 * @param languagePack Language pack to search in
 * @returns Translation value or null if not found
 */
function getTranslationValue(key: string, languagePack: LanguagePack): any {
  if (!languagePack) {
    return null;
  }

  const keys = key.split('.');
  let value: any = languagePack;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      return null; // Key not found
    }
  }

  return value;
}

/**
 * Get current language
 */
export function getCurrentLanguage(): string {
  return currentLanguage;
}

/**
 * Get current language pack
 */
export function getCurrentLanguagePack(): LanguagePack {
  return currentLanguagePack;
}

/**
 * Set language change callback function
 */
export function setOnLanguageChangeCallback(
  callback: (newLanguage: string, languageLabel: string) => void,
): void {
  onLanguageChangeCallback = callback;
}
