import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { log } from './logger';

// Language pack interface definition
export interface LanguagePack {
  // Status bar related
  statusBar: {
    premiumFastRequests: string;
    usageBasedPricing: string;
    teamUsage: string;
    period: string;
    utilized: string;
    used: string;
    remaining: string;
    limit: string;
    spent: string;
    of: string;
    perDay: string;
    dailyRemaining: string;
    weekdaysOnly: string;
    today: string;
    isWeekend: string;
    cursorUsageStats: string;
    errorState: string;
    enabled: string;
    disabled: string;
    noUsageRecorded: string;
    usageBasedDisabled: string;
    errorCheckingStatus: string;
    unableToCheckStatus: string;
    unpaidAmount: string;
    youHavePaid: string;
    accountSettings: string;
    currency: string;
    extensionSettings: string;
    refresh: string;
    months: {
      january: string;
      february: string;
      march: string;
      april: string;
      may: string;
      june: string;
      july: string;
      august: string;
      september: string;
      october: string;
      november: string;
      december: string;
    };
  };

  // Notification related
  notifications: {
    usageThresholdReached: string;
    usageExceededLimit: string;
    spendingThresholdReached: string;
    unpaidInvoice: string;
    enableUsageBasedTitle: string;
    enableUsageBasedDetail: string;
    viewSettingsTitle: string;
    viewSettingsDetail: string;
    manageLimitTitle: string;
    manageLimitDetail: string;
    nextNotificationAt: string;
    currentTotalCost: string;
    payInvoiceToContinue: string;
    openBillingPage: string;
    dismiss: string;
  };

  // Command related
  commands: {
    updateToken: string;
    refreshStats: string;
    openSettings: string;
    setLimit: string;
    selectCurrency: string;
    createReport: string;
    enableUsageBased: string;
    setMonthlyLimit: string;
    disableUsageBased: string;
    selectLanguage: string;
    languageChanged: string;
  };

  // Settings related
  settings: {
    enableUsageBasedPricing: string;
    changeMonthlyLimit: string;
    disableUsageBasedPricing: string;
    enableUsageBasedDescription: string;
    setLimitDescription: string;
    disableUsageBasedDescription: string;
    currentLimit: string;
    enterNewLimit: string;
    invalidLimit: string;
    limitUpdated: string;
    signInRequired: string;
    updateFailed: string;
  };

  // Error messages
  errors: {
    tokenNotFound: string;
    apiError: string;
    databaseError: string;
    networkError: string;
    updateFailed: string;
    unknownError: string;
  };

  // Time related
  time: {
    day: string;
    days: string;
    hour: string;
    hours: string;
    minute: string;
    minutes: string;
    second: string;
    seconds: string;
    ago: string;
    refreshing: string;
    lastUpdated: string;
  };

  // Currency related
  currency: {
    usd: string;
    eur: string;
    gbp: string;
    jpy: string;
    cny: string;
  };
}

// Language pack storage
const languagePacks: { [key: string]: LanguagePack } = {};

let currentLanguage = 'en';
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
    const language = config.get<string>('language', 'en');
    currentLanguagePack = languagePacks[language] || languagePacks['en'];
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

    const localesPath = path.join(extensionPath, 'src', 'locales', `${languageCode}.json`);
    
    if (!fs.existsSync(localesPath)) {
      log(`[I18n] Language file not found: ${localesPath}`, true);
      return null;
    }

    const fileContent = fs.readFileSync(localesPath, 'utf8');
    const languagePack = JSON.parse(fileContent) as LanguagePack;
    
    log(`[I18n] Loaded language pack for: ${languageCode}`);
    return languagePack;
  } catch (error) {
    log(`[I18n] Error loading language pack for ${languageCode}: ${error instanceof Error ? error.message : String(error)}`, true);
    return null;
  }
}

/**
 * Load all language packs
 */
function loadLanguagePacks(): void {
  const supportedLanguages = ['en', 'zh', 'ko'];
  
  for (const lang of supportedLanguages) {
    const pack = loadLanguagePackFromFile(lang);
    if (pack) {
      languagePacks[lang] = pack;
    }
  }

  // Ensure English language pack is loaded (required default language)
  if (!languagePacks['en']) {
    log('[I18n] Critical: English language pack not loaded! Extension may not work properly.', true);
  }

  log('[I18n] Language packs loaded');
}

/**
 * Update current language
 */
function updateCurrentLanguage(): void {
  const config = vscode.workspace.getConfiguration('cursorStats');
  const newLanguage = config.get<string>('language', 'en');
  
  if (newLanguage !== currentLanguage) {
    const oldLanguage = currentLanguage;
    currentLanguage = newLanguage;
    
    // Get language pack, fallback to English if not available
    const languagePack = languagePacks[newLanguage] || languagePacks['en'];
    if (languagePack) {
      currentLanguagePack = languagePack;
      log(`[I18n] Language changed to: ${newLanguage}`);
      
      // Trigger language change callback
      if (onLanguageChangeCallback && oldLanguage !== 'en') { // Avoid triggering during initialization
        const languageLabels: { [key: string]: string } = {
          'en': 'English',
          'zh': '中文',
          'ko': '한국어'
        };
        onLanguageChangeCallback(newLanguage, languageLabels[newLanguage] || newLanguage);
      }
    } else {
      log(`[I18n] Warning: No language pack found for ${newLanguage} or English`, true);
    }
  }
}



/**
 * Get translated text
 * @param key Translation key (supports nesting, e.g., 'statusBar.premiumFastRequests')
 * @param params Replacement parameters
 */
export function t(key: string, params?: { [key: string]: string | number }): string {
  const keys = key.split('.');
  let value: any = currentLanguagePack;
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      log(`[I18n] Translation key not found: ${key}`, true);
      return key; // Return original key as default value
    }
  }
  
  if (typeof value !== 'string') {
    log(`[I18n] Translation value is not a string: ${key}`, true);
    return key;
  }
  
  // Replace parameters
  if (params) {
    Object.keys(params).forEach(param => {
      value = value.replace(new RegExp(`{${param}}`, 'g'), params[param].toString());
    });
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
export function setOnLanguageChangeCallback(callback: (newLanguage: string, languageLabel: string) => void): void {
  onLanguageChangeCallback = callback;
} 