import {StyleSheet} from 'react-native';

import type {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingVertical: 32,
      gap: 24,
    },
    header: {
      gap: 8,
    },
    title: {
      color: theme.colors.onBackground,
      fontWeight: '600',
    },
    subtitle: {
      color: theme.colors.onSurfaceVariant,
    },
    statusBand: {
      minHeight: 96,
      justifyContent: 'center',
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: theme.colors.outlineVariant,
      paddingVertical: 18,
      gap: 12,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    statusDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    statusText: {
      color: theme.colors.onBackground,
      fontWeight: '600',
    },
    detailText: {
      color: theme.colors.onSurfaceVariant,
    },
    controls: {
      gap: 12,
    },
    button: {
      minHeight: 48,
      justifyContent: 'center',
    },
    error: {
      color: theme.colors.error,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
  });
