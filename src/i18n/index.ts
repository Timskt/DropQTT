export type { Translations } from './types';
import type { Translations } from './types';
import { zhCN } from './locales/zhCN';
import { en } from './locales/en';
import { zhTW } from './locales/zhTW';
import { ja } from './locales/ja';

export type Language = 'zh-CN' | 'en' | 'zh-TW' | 'ja';

/** Every locale the UI ships, in switcher order. */
export const LANGUAGES: Language[] = ['zh-CN', 'en', 'zh-TW', 'ja'];

export const translations: Record<Language, Translations> = {
  'zh-CN': zhCN,
  en,
  'zh-TW': zhTW,
  ja,
};

/**
 * Translations for hooks that must report a problem themselves and have no
 * `t` prop (they are not React components). Reads the same persisted language
 * the app writes, so a toast never comes out in the wrong language.
 */
export const currentTranslations = (): Translations => {
  if (typeof localStorage === 'undefined') return translations['zh-CN'];
  const raw = localStorage.getItem('dropqtt_lang');
  const lang = (raw === 'en' || raw === 'zh-TW' || raw === 'ja' || raw === 'zh-CN') ? raw : 'zh-CN';
  return translations[lang] ?? translations['zh-CN'];
};

/**
 * Fill `{placeholder}` slots in a translated string.
 *
 * Placeholders are named per string across four locales (`{count}`, `{ms}`,
 * `{delivered}` …), so this accepts whatever the string actually contains rather
 * than keeping a central list in sync. A slot with no matching parameter is left
 * as written: a missing value has to stay visible in the sentence, because
 * silently deleting it turns "3 of 5 failed" into "of failed" and that is how a
 * localisation bug hides.
 */
export const fill = (text: string, params: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
