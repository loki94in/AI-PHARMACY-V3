/**
 * Centralized WhatsApp Multi-Language Message Localizer
 * Supports Marathi (mr - default), Hindi (hi), and English (en).
 */

export type SupportedLanguage = 'mr' | 'hi' | 'en';

export function normalizeLanguage(lang?: string | null): SupportedLanguage {
  if (!lang) return 'mr';
  const clean = String(lang).toLowerCase().trim();
  if (clean === 'hi' || clean.includes('hindi') || clean.includes('हिंदी')) return 'hi';
  if (clean === 'en' || clean.includes('english') || clean.includes('इंग्रजी') || clean.includes('अंग्रेजी')) return 'en';
  return 'mr'; // Marathi default
}

export interface BookingConfirmParams {
  storeName: string;
  patientName: string;
  medicineName: string;
  quantity: number | string;
  orderId?: string;
  lang?: string;
}

export function formatBookingConfirmationMessage(params: BookingConfirmParams): string {
  const lang = normalizeLanguage(params.lang);
  const name = params.patientName || 'Customer';
  const store = params.storeName || 'Pharmacy';
  const med = params.medicineName || 'Medicine';
  const qty = params.quantity || 1;
  const orderRef = params.orderId ? ` (#${params.orderId})` : '';

  if (lang === 'hi') {
    return `🔔 *ऑर्डर कन्फर्म — ${store}*\n\n` +
      `नमस्ते *${name}*,\n` +
      `आपकी दवा *${med}* (मात्रा: ${qty})${orderRef} की बुकिंग सफलतापूर्वक दर्ज कर ली गई है और मंगाने के लिए जोड़ दी गई है। 🚀\n\n` +
      `दवा दुकान पर पहुंचते ही हम आपको लेने के लिए मैसेज भेजेंगे।\n\n` +
      `धन्यवाद! 🙏`;
  }

  if (lang === 'en') {
    return `🔔 *Order Confirmed — ${store}*\n\n` +
      `Dear *${name}*,\n` +
      `Your order for *${med}* (Qty: ${qty})${orderRef} has been confirmed and booked for procurement. 🚀\n\n` +
      `We will send you a notification as soon as it arrives at our counter for pickup.\n\n` +
      `Thank you! 🙏`;
  }

  // Default: Marathi
  return `🔔 *ऑर्डर कन्फर्म — ${store}*\n\n` +
    `नमस्कार *${name}*,\n` +
    `आपली औषध *${med}* (प्रमाण: ${qty})${orderRef} ची नोंद यशस्वीरीत्या केली असून ती मागवण्यात आली आहे. 🚀\n\n` +
    `औषध दुकानात उपलब्ध होताच आम्ही आपल्याला घेऊन जाण्यासाठी कळवू.\n\n` +
    `धन्यवाद! 🙏`;
}

export interface CollectionReminderParams {
  storeName: string;
  patientName: string;
  items: Array<{ name: string; qty: number | string }>;
  storeAddress?: string;
  storeHours?: string;
  lang?: string;
}

export function formatCollectionReminderMessage(params: CollectionReminderParams): string {
  const lang = normalizeLanguage(params.lang);
  const name = params.patientName || 'Customer';
  const store = params.storeName || 'Pharmacy';
  const address = params.storeAddress ? `📍 *पत्ता:* ${params.storeAddress}\n` : '';
  const addressHi = params.storeAddress ? `📍 *दुकान का पता:* ${params.storeAddress}\n` : '';
  const addressEn = params.storeAddress ? `📍 *Location:* ${params.storeAddress}\n` : '';
  const hours = params.storeHours ? `🕒 *वेळ:* ${params.storeHours}\n` : '';
  const hoursHi = params.storeHours ? `🕒 *समय:* ${params.storeHours}\n` : '';
  const hoursEn = params.storeHours ? `🕒 *Hours:* ${params.storeHours}\n` : '';

  if (lang === 'hi') {
    const medList = params.items.map(it => `• *${it.name}* (मात्रा: ${it.qty})`).join('\n');
    return `🔔 *तैयार दवाई संग्रह रिमाइंडर — ${store}*\n\n` +
      `नमस्ते *${name}*,\n` +
      `खुशखबरी! 🎉 आपकी मंगाई गई दवाई फार्मेसी पर तैयार है और उपलब्ध है:\n\n` +
      `${medList}\n\n` +
      `${addressHi}${hoursHi}\n` +
      `👉 *कृपया अपनी सुविधानुसार दुकान से दवाई प्राप्त कर लें।*\n\n` +
      `धन्यवाद! 🙏`;
  }

  if (lang === 'en') {
    const medList = params.items.map(it => `• *${it.name}* (Qty: ${it.qty})`).join('\n');
    return `🔔 *READY MEDICINE COLLECTION REMINDER — ${store}*\n\n` +
      `Dear *${name}*,\n` +
      `Great news! 🎉 Your medication is packed and ready for collection at our counter:\n\n` +
      `${medList}\n\n` +
      `${addressEn}${hoursEn}\n` +
      `👉 *Please collect your medicine at your earliest convenience.*\n\n` +
      `Thank you! 🙏`;
  }

  // Default: Marathi
  const medList = params.items.map(it => `• *${it.name}* (प्रमाण: ${it.qty})`).join('\n');
  return `🔔 *तयार औषध संकलन स्मरणपत्र — ${store}*\n\n` +
    `नमस्कार *${name}*,\n` +
    `आनंदाची बातमी! 🎉 आपली मागवलेली औषधे फार्मसीमध्ये उपलब्ध झाली आहेत:\n\n` +
    `${medList}\n\n` +
    `${address}${hours}\n` +
    `👉 *कृपया आपल्या सोयीनुसार औषध दुकानातून घेऊन जावे.*\n\n` +
    `धन्यवाद! 🙏`;
}

export interface PortalPinParams {
  storeName: string;
  patientName?: string;
  pin: string;
  portalUrl?: string;
  lang?: string;
}

export function formatPortalPinMessage(params: PortalPinParams): string {
  const lang = normalizeLanguage(params.lang);
  const name = params.patientName ? ` *${params.patientName}*` : '';
  const store = params.storeName || 'AI Pharmacy';
  const portalUrl = params.portalUrl || 'https://ai-pharmacy-os.vercel.app/shop';

  if (lang === 'hi') {
    return `🔐 *${store} पेशेंट पोर्टल लॉगिन*\n\n` +
      `नमस्ते${name},\n` +
      `आपकी स्वास्थ्य प्रोफ़ाइल और रिफिल के लिए आपका पोर्टल पासवर्ड (PIN) है: *${params.pin}*\n\n` +
      `🌐 *लॉगिन पोर्टल:* ${portalUrl}\n\n` +
      `इस पासवर्ड से आप अपनी मासिक रिफिल, पुराने बिल और नई दवाइयां 24/7 कभी भी बुक कर सकते हैं।`;
  }

  if (lang === 'en') {
    return `🔐 *${store} Patient Portal Access*\n\n` +
      `Hello${name},\n` +
      `Your Health Portal Password / PIN is: *${params.pin}*\n\n` +
      `🌐 *Login Link:* ${portalUrl}\n\n` +
      `Use this PIN to manage your chronic refills, view bills, and place 24/7 special orders.`;
  }

  // Default: Marathi
  return `🔐 *${store} पेशंट पोर्टल लॉगिन*\n\n` +
    `नमस्कार${name},\n` +
    `आपल्या आरोग्य प्रोफाइल आणि रिफिल व्यवस्थापनासाठी आपला पोर्टल पासवर्ड (PIN): *${params.pin}*\n\n` +
    `🌐 *लॉगिन पोर्टल:* ${portalUrl}\n\n` +
    `या पासवर्डचा वापर करून आपण आपले नियमित रिफिल, जुनी बिले आणि नवीन औषधे २४/७ कधीही मागवू शकता.`;
}
