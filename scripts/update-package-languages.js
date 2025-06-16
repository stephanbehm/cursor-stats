#!/usr/bin/env node

/**
 * Script to automatically update package.json language configuration
 * based on the centralized language configuration in src/config/languages.ts
 */

const fs = require('fs');
const path = require('path');

function extractLanguageConfigFromTS() {
  const configPath = path.join(__dirname, '../src/config/languages.ts');
  const content = fs.readFileSync(configPath, 'utf8');

  // Extract the SUPPORTED_LANGUAGES array
  const arrayMatch = content.match(
    /export const SUPPORTED_LANGUAGES: LanguageConfig\[\] = (\[[\s\S]*?\]);/,
  );
  if (!arrayMatch) {
    throw new Error('Could not find SUPPORTED_LANGUAGES array in languages.ts');
  }

  // Extract DEFAULT_LANGUAGE
  const defaultMatch = content.match(/export const DEFAULT_LANGUAGE = '([^']+)';/);
  if (!defaultMatch) {
    throw new Error('Could not find DEFAULT_LANGUAGE in languages.ts');
  }

  const arrayString = arrayMatch[1];
  const languageMatches = arrayString.match(
    /{\s*code:\s*'([^']+)',\s*nativeName:\s*'([^']+)',\s*englishName:\s*'([^']+)',?\s*}/g,
  );

  if (!languageMatches) {
    throw new Error('Could not parse language configurations');
  }

  const languages = languageMatches.map((match) => {
    const parts = match.match(
      /code:\s*'([^']+)',\s*nativeName:\s*'([^']+)',\s*englishName:\s*'([^']+)'/,
    );
    return {
      code: parts[1],
      nativeName: parts[2],
      englishName: parts[3],
    };
  });

  return {
    languages,
    defaultLanguage: defaultMatch[1],
  };
}

function generateLanguageConfig(languages, defaultLanguage) {
  const languageEnum = languages.map((lang) => lang.code);
  const enumDescriptions = languages.map((lang) =>
    lang.englishName !== lang.nativeName
      ? `${lang.nativeName} (${lang.englishName})`
      : lang.englishName,
  );

  return {
    type: 'string',
    default: defaultLanguage,
    enum: languageEnum,
    enumDescriptions: enumDescriptions,
    description: 'Language for the extension interface and messages.',
  };
}

function updatePackageJson() {
  const packagePath = path.join(__dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  const { languages, defaultLanguage } = extractLanguageConfigFromTS();
  const languageConfig = generateLanguageConfig(languages, defaultLanguage);

  // Update the language configuration in package.json
  packageJson.contributes.configuration[0].properties['cursorStats.language'] = languageConfig;

  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');

  console.log('✅ Package.json language configuration updated successfully!');
  console.log(`📝 Languages: ${languageConfig.enum.join(', ')}`);
  console.log(`🌐 Default: ${languageConfig.default}`);
}

try {
  updatePackageJson();
} catch (error) {
  console.error('❌ Error updating package.json:', error.message);
  process.exit(1);
}
