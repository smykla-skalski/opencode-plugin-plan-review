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

/** Text-art rendering of a mermaid diagram, or null when the source cannot be drawn. */
export function renderDiagram(source: string): string | null {
  try {
    const art = renderMermaidAscii(normalizeMermaid(source), {
      paddingX: 3,
      paddingY: 1,
      boxBorderPadding: 0,
      colorMode: "none",
    })
    const trimmed = art
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim()
    return trimmed || null
  } catch {
    return null
  }
}
