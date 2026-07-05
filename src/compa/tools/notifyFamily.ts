/**
 * Canal de emergencia. Android usa SmsManager nativo para funcionar sin datos.
 */
import {Linking, NativeModules, Platform} from 'react-native';

import {FAMILY_PHONE} from '../config/family';

type CompaSmsModule = {
  sendSms(phoneNumber: string, message: string): Promise<boolean>;
};

const smsModule = NativeModules.CompaSms as CompaSmsModule | undefined;

export async function notifyFamily(message: string): Promise<void> {
  if (!FAMILY_PHONE) {
    return;
  }
  if (Platform.OS === 'android' && smsModule) {
    await smsModule.sendSms(FAMILY_PHONE, message);
    return;
  }
  const sep = Platform.OS === 'ios' ? '&' : '?';
  await Linking.openURL(
    `sms:${FAMILY_PHONE}${sep}body=${encodeURIComponent(message)}`,
  );
}
