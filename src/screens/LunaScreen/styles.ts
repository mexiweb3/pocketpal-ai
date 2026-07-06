import {StyleSheet} from 'react-native';

import type {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    statusStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderColor: theme.colors.outlineVariant,
    },
    statusStripText: {
      flex: 1,
      color: theme.colors.onSurfaceVariant,
    },
    statusDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    chatList: {
      flex: 1,
    },
    chatContent: {
      padding: 16,
      gap: 10,
      flexGrow: 1,
    },
    // Burbujas grandes y de alto contraste: la lee un señor de ~80 años.
    // Colores CLARAMENTE distintos: el papá a la derecha en azul; Luna a la
    // izquierda en morado (su color, como la luna nocturna).
    bubble: {
      maxWidth: '85%',
      borderRadius: 18,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    bubbleUser: {
      alignSelf: 'flex-end',
      backgroundColor: '#1d5fd6', // azul: mensajes de Don Jesús
      borderBottomRightRadius: 4,
    },
    bubbleLuna: {
      alignSelf: 'flex-start',
      backgroundColor: '#3b2d6b', // morado luna: respuestas de Luna
      borderBottomLeftRadius: 4,
    },
    bubbleName: {
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 2,
      color: '#c9b8ff',
    },
    bubbleNameUser: {
      color: '#bcd4ff',
      textAlign: 'right',
    },
    bubbleText: {
      fontSize: 18,
      lineHeight: 26,
      color: '#ffffff',
    },
    bubbleTextUser: {
      color: '#ffffff',
    },
    emptyHint: {
      textAlign: 'center',
      color: theme.colors.onSurfaceVariant,
      marginTop: 40,
      paddingHorizontal: 24,
      fontSize: 16,
      lineHeight: 24,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderColor: theme.colors.outlineVariant,
    },
    textInput: {
      flex: 1,
      minHeight: 48,
      maxHeight: 120,
      borderRadius: 24,
      backgroundColor: theme.colors.surfaceVariant,
      color: theme.colors.onSurface,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 18,
    },
    error: {
      color: theme.colors.error,
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    retryButton: {
      marginHorizontal: 16,
      marginVertical: 8,
      minHeight: 48,
      justifyContent: 'center',
    },
  });
