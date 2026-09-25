/** Windows and Linux menus read "&" as a keyboard-shortcut marker; "&&" shows one "&". */
export const menuText = (text: string): string =>
  process.platform === 'darwin' ? text : text.replace(/&/g, '&&')
