import { renderMermaidAscii } from "beautiful-mermaid"

const OPEN = new Set(["[", "(", "{"])
const CLOSE = new Set(["]", ")", "}"])

/** Joins lines that end inside an open node label; models often wrap long labels, which breaks the parser. */
export function normalizeMermaid(source: string) {
  const lines: string[] = []
  let depth = 0
  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    if (depth > 0) lines[lines.length - 1] += ` ${line.trim()}`
    else lines.push(line)
    for (const char of line) {
      if (OPEN.has(char)) depth += 1
      else if (CLOSE.has(char)) depth = Math.max(0, depth - 1)
    }
  }
  return lines.join("\n").trim()
}

export interface Window {
  readonly lines: string[]
  readonly offset: number
  readonly left: boolean
  readonly right: boolean
}

/** The slice of a wide diagram that fits `width` columns, starting at a clamped horizontal `offset`. */
export function pan(art: string, offset: number, width: number): Window {
  const rows = art.split("\n").map((line) => Array.from(line))
  const widest = Math.max(0, ...rows.map((row) => row.length))
  const span = Math.max(1, width)
  const start = Math.max(0, Math.min(offset, widest - span))
  return {
    lines: rows.map((row) => row.slice(start, start + span).join("")),
    offset: start,
    left: start > 0,
    right: start + span < widest,
  }
}

/** Drops blank edge lines and the indent all lines share, keeping columns aligned across lines. */
export function dedent(art: string) {
  const lines = art.split("\n").map((line) => line.trimEnd())
  while (lines.length && !lines[0]) lines.shift()
  while (lines.length && !lines.at(-1)) lines.pop()
  const indent = Math.min(...lines.filter(Boolean).map((line) => line.length - line.trimStart().length))
  return lines.map((line) => line.slice(Number.isFinite(indent) ? indent : 0)).join("\n")
}

/** Text-art rendering of a mermaid diagram, or null when the source cannot be drawn. */
export function renderDiagram(source: string): string | null {
  try {
    const art = renderMermaidAscii(normalizeMermaid(source), {
      paddingX: 3,
      paddingY: 1,
      boxBorderPadding: 0,
      colorMode: "none",
    })
    return dedent(art) || null
  } catch {
    return null
  }
}
