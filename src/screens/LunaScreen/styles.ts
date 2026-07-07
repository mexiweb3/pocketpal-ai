import {StyleSheet} from 'react-native';

import type {Theme} from '../../utils/types';

// Paleta FIJA oscura y de alto contraste (independiente del tema claro/oscuro
// del sistema): garantiza que un señor de ~80 años lea todo — sobre todo lo
// que ESCRIBE en el input. No depender del theme evita el bug de letra
// invisible cuando el telefono esta en modo claro.
const BG = '#0d0f17'; // fondo casi negro azulado
const SURFACE = '#20232e'; // input / superficies
const TEXT = '#ffffff';
const TEXT_DIM = '#9aa0ad';
const BORDER = '#2a2e3b';
const USER_BUBBLE = '#1d5fd6'; // azul: Don Jesus
const LUNA_BUBBLE = '#3b2d6b'; // morado luna
const USER_NAME = '#bcd4ff';
const LUNA_NAME = '#c9b8ff';

// La firma recibe theme por compatibilidad, pero los colores son fijos.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createStyles = (_theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: BG,
    },
    statusStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderColor: BORDER,
    },
    statusStripText: {
      flex: 1,
      color: TEXT_DIM,
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
    // Burbujas grandes y de alto contraste. Don Jesus a la derecha (azul),
    // Luna a la izquierda (morado nocturno), texto blanco.
    bubble: {
      maxWidth: '85%',
      borderRadius: 18,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    bubbleUser: {
      alignSelf: 'flex-end',
      backgroundColor: USER_BUBBLE,
      borderBottomRightRadius: 4,
    },
    bubbleLuna: {
      alignSelf: 'flex-start',
      backgroundColor: LUNA_BUBBLE,
      borderBottomLeftRadius: 4,
    },
    bubbleName: {
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 2,
      color: LUNA_NAME,
    },
    bubbleNameUser: {
      color: USER_NAME,
      textAlign: 'right',
    },
    bubbleText: {
      fontSize: 18,
      lineHeight: 26,
      color: TEXT,
    },
    bubbleTextUser: {
      color: TEXT,
    },
    emptyHint: {
      textAlign: 'center',
      color: TEXT_DIM,
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
      borderColor: BORDER,
      backgroundColor: BG,
    },
    textInput: {
      flex: 1,
      minHeight: 48,
      maxHeight: 120,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: BORDER,
      backgroundColor: SURFACE,
      color: TEXT, // <- lo que escribe el señor, blanco y visible
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 18,
    },
    error: {
      color: '#ff6b6b',
      paddingHorizontal: 16,
      paddingVertical: 6,
      fontSize: 16,
    },
    retryButton: {
      marginHorizontal: 16,
      marginVertical: 8,
      minHeight: 48,
      justifyContent: 'center',
    },
  });

// Colores expuestos para que la pantalla fije placeholder/indicadores sin
// depender del theme del sistema.
export const LUNA_COLORS = {
  bg: BG,
  surface: SURFACE,
  text: TEXT,
  textDim: TEXT_DIM,
  accent: '#8b7bd8',
};
