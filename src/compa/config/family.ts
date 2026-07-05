import {COMPA_FAMILY_PHONE} from '@env';

// Temporary setup source for the family emergency contact.
// Set COMPA_FAMILY_PHONE in .env; the PIN-protected setup flow should persist
// and read this value here when it exists.
export const FAMILY_PHONE = (COMPA_FAMILY_PHONE || '').trim();
