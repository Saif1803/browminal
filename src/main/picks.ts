/**
 * Picks: what the user sends an agent from a page, like selecting code in an IDE and asking
 * about it. An element pick has the element (its ref, a selector, HTML, box, styles, where it's
 * written, a cropped screenshot); an errors pick the page's new errors. Kept in memory, the
 * newest MAX_PICKS. Pure.
 */

export const MAX_PICKS = 20

interface PickBase {
  /** Grows by one per pick; the agent asks for one with get_picks(id). */
  id: number
  tabId: number
  /** The page it was picked on. */
  url: string
  title: string
  /** ms since the epoch. */
  time: number
}

export interface ElementPick extends PickBase {
  kind: 'element'
  /** The element's ref (backend DOM node id): read_page, click and inspect take it. */
  ref: number
  /** Tag and visible text: 'button "Add to cart"'. */
  description: string
  selector: string
  html: string
  /** formatBoxModel's line, or null when it isn't rendered. */
  box: string | null
  /** A few computed styles, one "name: value" per line. */
  styles: string
  /** Where it's written (formatComponentSource's line), or null when no framework said. */
  source: string | null
  /** A JPEG of the element and a little around it, base64; null when it couldn't be taken. */
  image: string | null
}

export interface ErrorsPick extends PickBase {
  kind: 'errors'
  /** How many errors. */
  count: number
  /** The errors as console_messages shows them. */
  errors: string
}

export type Pick = ElementPick | ErrorsPick
export type NewPick = Omit<ElementPick, 'id'> | Omit<ErrorsPick, 'id'>

/** The newest picks. */
export class PickList {
  private picks: Pick[] = []
  private nextId = 1

  constructor(private readonly max = MAX_PICKS) {}

  add(pick: NewPick): Pick {
    const added = { ...pick, id: this.nextId++ } as Pick
    this.picks.push(added)
    if (this.picks.length > this.max) this.picks.splice(0, this.picks.length - this.max)
    return added
  }

  get(id: number): Pick | undefined {
    return this.picks.find((pick) => pick.id === id)
  }

  /** Oldest first. */
  get all(): readonly Pick[] {
    return this.picks
  }

  get latest(): Pick | undefined {
    return this.picks.at(-1)
  }

  /** The id the next pick gets, so callers can say "no pick after #n". */
  get lastId(): number {
    return this.nextId - 1
  }
}

/** What's typed into the agent's prompt in the Nebula terminal (not sent: the user finishes it). */
export function pickPrompt(pick: Pick): string {
  return pick.kind === 'element'
    ? `Look at the element I picked in Nebula (pick ${pick.id}): `
    : `Look at the errors I sent from Nebula (pick ${pick.id}): `
}

const page = (pick: Pick): string =>
  `[tab ${pick.tabId}] ${pick.title && pick.title !== pick.url ? `${pick.title} — ` : ''}${pick.url}`

/** One line per pick for the list. */
export function formatPickLine(pick: Pick): string {
  const what =
    pick.kind === 'element'
      ? `element ${pick.description} [ref=${pick.ref}]`
      : `${pick.count} error${pick.count === 1 ? '' : 's'}`
  return `pick ${pick.id}: ${what} on ${page(pick)}`
}

/** A pick in full (its image goes alongside, as an image). */
export function formatPick(pick: Pick): string {
  const head = `# Pick ${pick.id}, ${new Date(pick.time).toISOString()}\n${page(pick)}`
  if (pick.kind === 'errors') {
    return `${head}\nThe user sent the page's ${pick.count} newest error${pick.count === 1 ? '' : 's'}:\n${pick.errors}`
  }
  const lines = [
    head,
    `The user picked ${pick.description} [ref=${pick.ref}]`,
    `selector: ${pick.selector}`,
    `source: ${pick.source ?? 'unknown (no framework dev info on this element)'}`,
    pick.box ?? 'box: not rendered',
    `styles:\n${pick.styles}`,
    `html:\n${pick.html}`,
    'The ref works with inspect, click and the other tools while the element is on the page.'
  ]
  return lines.join('\n')
}
