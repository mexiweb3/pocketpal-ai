import {NativeModules, Platform} from 'react-native';

import type {NotificationAdapter} from './NotificationAdapter';

type CompaSmsModule = {
  sendSms(phoneNumber: string, message: string): Promise<boolean>;
};

export class SmsManagerAdapter implements NotificationAdapter {
  constructor(private phoneNumber: string = '') {}

  async notifyFamily(
    message: string,
  ): Promise<{delivered: boolean; channel: string}> {
    const module = NativeModules.CompaSms as CompaSmsModule | undefined;
    if (!this.phoneNumber || Platform.OS !== 'android' || !module) {
      return {delivered: false, channel: 'sms'};
    }
    const delivered = await module.sendSms(this.phoneNumber, message);
    return {delivered, channel: 'sms'};
  }

  async selfTest(): Promise<boolean> {
    return (
      Platform.OS === 'android' &&
      !!this.phoneNumber &&
      typeof (NativeModules.CompaSms as CompaSmsModule | undefined)?.sendSms ===
        'function'
    );
  }
}
