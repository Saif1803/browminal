/** Height of the tab strip, the UI's top row. The native window controls are drawn this tall. */
export const TAB_STRIP_HEIGHT = 40

/** Where tabs are placed until the UI reports its real height with setChromeHeight. */
export const INITIAL_CHROME_HEIGHT = TAB_STRIP_HEIGHT + 44

/** setChromeHeight rejects anything taller. */
export const MAX_CHROME_HEIGHT = 400
