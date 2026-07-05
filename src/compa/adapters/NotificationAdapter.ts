export interface NotificationAdapter {
  notifyFamily(message: string): Promise<{delivered: boolean; channel: string}>;
  selfTest(): Promise<boolean>;  // usado por el gate de safety
}
