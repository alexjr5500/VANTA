/**
 * Display-layer translations for shared VANTA navigation/settings chrome.
 * Locale JSON bundles remain the primary source; this small supplement fills
 * known English placeholders until full page-by-page localization is complete.
 * User-generated posts/messages must NEVER be auto-translated by this helper.
 */
import { useCallback } from 'react';
import { useI18n } from './context';
import type { Locale } from './config';

const KEYS: Record<string, string> = {
  Home: 'nav.home', Discover: 'nav.discover', Live: 'nav.live',
  Chat: 'nav.messages', Messages: 'nav.messages', Profile: 'nav.profile',
  Settings: 'settings.title', Account: 'settings.account', Security: 'settings.security',
  Notifications: 'settings.notifications', Appearance: 'settings.appearance',
  Language: 'settings.language', About: 'settings.about',
  'Terms of Service': 'auth.termsOfService', 'Privacy Policy': 'auth.privacyPolicy',
  'Community Guidelines': 'moderation.communityGuidelines',
  'Help Center': 'nav.helpCenter', Logout: 'nav.logout',
  'Go Live': 'nav.goLive', 'Privacy': 'settings.privacy',
  'App version': 'settings.appVersion', 'Edit profile': 'profile.editProfile',
};

const FALLBACK: Partial<Record<Locale, Record<string, string>>> = {
  fr: {
    Home: 'Accueil', Discover: 'Découvrir', Reels: 'Reels', Chat: 'Discussions',
    Messages: 'Messages', Profile: 'Profil', Settings: 'Paramètres', Account: 'Compte',
    Security: 'Sécurité', Notifications: 'Notifications', Appearance: 'Apparence',
    Language: 'Langue', About: 'À propos', Privacy: 'Confidentialité',
    'Terms of Service': "Conditions d'utilisation", 'Privacy Policy': 'Politique de confidentialité',
    'Community Guidelines': 'Règles de la communauté', 'Help Center': "Centre d'aide",
    Logout: 'Déconnexion', Live: 'En direct', 'Go Live': 'Diffuser en direct',
    'Language & Region': 'Langue et région', 'Display Language': "Langue d'affichage",
    'Used across the app': "Utilisée dans l'application",
    'Choose your display language. Supported translations are loaded from the VANTA translation set.':
      "Choisissez votre langue d'affichage. Les traductions disponibles sont chargées depuis VANTA.",
    'Changes apply immediately and are saved to your account.':
      'Les modifications prennent effet immédiatement et sont enregistrées dans votre compte.',
    'Your account': 'Votre compte', 'View profile': 'Voir le profil',
    'Privacy & Safety': 'Confidentialité et sécurité', 'Content & Media': 'Contenu et médias',
    'Content & media': 'Contenu et médias', 'Device & storage': 'Appareil et stockage',
    'Chat preferences': 'Préférences de discussion', 'Password & security': 'Mot de passe et sécurité',
    'Account privacy': 'Confidentialité du compte', 'Blocked accounts': 'Comptes bloqués',
    'About VANTA': 'À propos de VANTA', 'Display language': "Langue d'affichage",
    'Log out': 'Se déconnecter', 'Edit profile': 'Modifier le profil',
    'Language and translations': 'Langue et traductions',
    'Your language selection updates supported screens immediately. Some screens remain in English until translations are completed.':
      "Votre langue s'applique immédiatement aux écrans traduits. Certains écrans restent en anglais en attendant leur traduction.",
  },
  ar: { Home: 'الرئيسية', Discover: 'اكتشف', Reels: 'ريلز', Chat: 'الدردشة', Profile: 'الملف الشخصي', Settings: 'الإعدادات', Language: 'اللغة', Account: 'الحساب', About: 'حول', Notifications: 'الإشعارات', Appearance: 'المظهر', 'Terms of Service': 'شروط الخدمة', 'Privacy Policy': 'سياسة الخصوصية', 'Community Guidelines': 'إرشادات المجتمع', 'Language & Region': 'اللغة والمنطقة', 'Display Language': 'لغة العرض' },
  it: { Home: 'Home', Discover: 'Scopri', Reels: 'Reels', Chat: 'Chat', Profile: 'Profilo', Settings: 'Impostazioni', Language: 'Lingua', Account: 'Account', About: 'Informazioni', Notifications: 'Notifiche', Appearance: 'Aspetto', 'Terms of Service': 'Termini di servizio', 'Privacy Policy': 'Informativa sulla privacy', 'Community Guidelines': 'Linee guida della community', 'Language & Region': 'Lingua e regione', 'Display Language': 'Lingua di visualizzazione' },
  tr: { Home: 'Ana sayfa', Discover: 'Keşfet', Reels: 'Reels', Chat: 'Sohbet', Profile: 'Profil', Settings: 'Ayarlar', Language: 'Dil', Account: 'Hesap', About: 'Hakkında', Notifications: 'Bildirimler', Appearance: 'Görünüm', 'Terms of Service': 'Hizmet Koşulları', 'Privacy Policy': 'Gizlilik Politikası', 'Community Guidelines': 'Topluluk Kuralları', 'Language & Region': 'Dil ve Bölge', 'Display Language': 'Görüntüleme dili' },
  ru: { Home: 'Главная', Discover: 'Обзор', Reels: 'Рилсы', Chat: 'Чат', Profile: 'Профиль', Settings: 'Настройки', Language: 'Язык', Account: 'Аккаунт', About: 'О приложении', Notifications: 'Уведомления', Appearance: 'Оформление', 'Terms of Service': 'Условия использования', 'Privacy Policy': 'Политика конфиденциальности', 'Community Guidelines': 'Правила сообщества', 'Language & Region': 'Язык и регион', 'Display Language': 'Язык интерфейса' },
  hi: { Home: 'होम', Discover: 'खोजें', Reels: 'रील्स', Chat: 'चैट', Profile: 'प्रोफ़ाइल', Settings: 'सेटिंग्स', Language: 'भाषा', Account: 'खाता', About: 'परिचय', Notifications: 'सूचनाएँ', Appearance: 'दिखावट', 'Terms of Service': 'सेवा की शर्तें', 'Privacy Policy': 'गोपनीयता नीति', 'Community Guidelines': 'समुदाय दिशानिर्देश', 'Language & Region': 'भाषा और क्षेत्र', 'Display Language': 'प्रदर्शन भाषा' },
  ur: { Home: 'ہوم', Discover: 'دریافت کریں', Reels: 'ریلز', Chat: 'چیٹ', Profile: 'پروفائل', Settings: 'ترتیبات', Language: 'زبان', Account: 'اکاؤنٹ', About: 'تعارف', Notifications: 'اطلاعات', Appearance: 'ظاہری شکل', 'Terms of Service': 'سروس کی شرائط', 'Privacy Policy': 'رازداری کی پالیسی', 'Community Guidelines': 'کمیونٹی رہنما اصول', 'Language & Region': 'زبان اور علاقہ', 'Display Language': 'ڈسپلے کی زبان' },
  bn: { Home: 'হোম', Discover: 'আবিষ্কার', Reels: 'রিলস', Chat: 'চ্যাট', Profile: 'প্রোফাইল', Settings: 'সেটিংস', Language: 'ভাষা', Account: 'অ্যাকাউন্ট', About: 'সম্পর্কে', Notifications: 'বিজ্ঞপ্তি', Appearance: 'চেহারা', 'Terms of Service': 'পরিষেবার শর্তাবলি', 'Privacy Policy': 'গোপনীয়তা নীতি', 'Community Guidelines': 'কমিউনিটি নির্দেশিকা', 'Language & Region': 'ভাষা ও অঞ্চল', 'Display Language': 'প্রদর্শনের ভাষা' },
  id: { Home: 'Beranda', Discover: 'Jelajahi', Reels: 'Reels', Chat: 'Obrolan', Profile: 'Profil', Settings: 'Pengaturan', Language: 'Bahasa', Account: 'Akun', About: 'Tentang', Notifications: 'Notifikasi', Appearance: 'Tampilan', 'Terms of Service': 'Ketentuan Layanan', 'Privacy Policy': 'Kebijakan Privasi', 'Community Guidelines': 'Pedoman Komunitas', 'Language & Region': 'Bahasa dan Wilayah', 'Display Language': 'Bahasa tampilan' },
  vi: { Home: 'Trang chủ', Discover: 'Khám phá', Reels: 'Reels', Chat: 'Trò chuyện', Profile: 'Hồ sơ', Settings: 'Cài đặt', Language: 'Ngôn ngữ', Account: 'Tài khoản', About: 'Giới thiệu', Notifications: 'Thông báo', Appearance: 'Giao diện', 'Terms of Service': 'Điều khoản dịch vụ', 'Privacy Policy': 'Chính sách quyền riêng tư', 'Community Guidelines': 'Nguyên tắc cộng đồng', 'Language & Region': 'Ngôn ngữ và khu vực', 'Display Language': 'Ngôn ngữ hiển thị' },
  th: { Home: 'หน้าแรก', Discover: 'สำรวจ', Reels: 'รีลส์', Chat: 'แชต', Profile: 'โปรไฟล์', Settings: 'การตั้งค่า', Language: 'ภาษา', Account: 'บัญชี', About: 'เกี่ยวกับ', Notifications: 'การแจ้งเตือน', Appearance: 'รูปลักษณ์', 'Terms of Service': 'ข้อกำหนดการให้บริการ', 'Privacy Policy': 'นโยบายความเป็นส่วนตัว', 'Community Guidelines': 'หลักเกณฑ์ชุมชน', 'Language & Region': 'ภาษาและภูมิภาค', 'Display Language': 'ภาษาที่แสดง' },
  zh: { Home: '首页', Discover: '发现', Reels: '短视频', Chat: '聊天', Profile: '个人资料', Settings: '设置', Language: '语言', Account: '账户', About: '关于', Notifications: '通知', Appearance: '外观', 'Terms of Service': '服务条款', 'Privacy Policy': '隐私政策', 'Community Guidelines': '社区准则', 'Language & Region': '语言和地区', 'Display Language': '显示语言' },
  'zh-TW': { Home: '首頁', Discover: '探索', Reels: '短影音', Chat: '聊天', Profile: '個人檔案', Settings: '設定', Language: '語言', Account: '帳戶', About: '關於', Notifications: '通知', Appearance: '外觀', 'Terms of Service': '服務條款', 'Privacy Policy': '隱私權政策', 'Community Guidelines': '社群守則', 'Language & Region': '語言與地區', 'Display Language': '顯示語言' },
  ja: { Home: 'ホーム', Discover: '見つける', Reels: 'リール', Chat: 'チャット', Profile: 'プロフィール', Settings: '設定', Language: '言語', Account: 'アカウント', About: '概要', Notifications: '通知', Appearance: '外観', 'Terms of Service': '利用規約', 'Privacy Policy': 'プライバシーポリシー', 'Community Guidelines': 'コミュニティガイドライン', 'Language & Region': '言語と地域', 'Display Language': '表示言語' },
  ko: { Home: '홈', Discover: '탐색', Reels: '릴스', Chat: '채팅', Profile: '프로필', Settings: '설정', Language: '언어', Account: '계정', About: '정보', Notifications: '알림', Appearance: '화면 설정', 'Terms of Service': '서비스 약관', 'Privacy Policy': '개인정보 처리방침', 'Community Guidelines': '커뮤니티 가이드라인', 'Language & Region': '언어 및 지역', 'Display Language': '표시 언어' },
  de: { Chat: 'Chat', Reels: 'Reels', 'Terms of Service': 'Nutzungsbedingungen', 'Privacy Policy': 'Datenschutzerklärung', 'Community Guidelines': 'Community-Richtlinien', 'Language & Region': 'Sprache und Region', 'Display Language': 'Anzeigesprache' },
  es: { Chat: 'Chat', Reels: 'Reels', 'Community Guidelines': 'Normas de la comunidad', 'Language & Region': 'Idioma y región', 'Display Language': 'Idioma de visualización' },
  pt: { Chat: 'Conversas', Reels: 'Reels', 'Community Guidelines': 'Diretrizes da comunidade', 'Language & Region': 'Idioma e região', 'Display Language': 'Idioma de exibição' },
};

export function translateUiLabel(label: string, locale: Locale, translateKey: (key: string) => string): string {
  if (locale === 'en') return label;
  const key = KEYS[label];
  if (key) {
    const result = translateKey(key);
    if (result && result !== key && result !== label) return result;
  }
  return FALLBACK[locale]?.[label] ?? label;
}

export function useLocalizedUiText(): (label: string) => string {
  const { locale, t } = useI18n();
  return useCallback((label: string) => translateUiLabel(label, locale, t), [locale, t]);
}
