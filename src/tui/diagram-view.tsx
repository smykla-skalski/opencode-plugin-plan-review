/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { SyntaxStyle } from "@opentui/core"
import { createMemo, Show } from "solid-js"
import { pan, renderDiagram } from "../diagram.ts"

const syntax = SyntaxStyle.create()

/**
 * Mermaid drawn as text art, clipped to the panel and panned sideways with ←/→ via `offset`;
 * the fenced source is the fallback when the diagram cannot be drawn.
 */
export function DiagramView(props: {
  theme: Plugin.Context["theme"]
  source: string
  width: number
  offset: number
}) {
  const art = createMemo(() => renderDiagram(props.source))
  const view = createMemo(() => {
    const drawn = art()
    return drawn ? pan(drawn, props.offset, props.width) : null
  })
  return (
    <Show
      when={view()}
      fallback={
        <markdown
          content={["```mermaid", props.source.trim(), "```"].join("\n")}
          syntaxStyle={syntax}
          fg={props.theme.markdown.text}
        />
      }
    >
      {(window) => (
        <box flexDirection="column" flexShrink={0}>
          <text fg={props.theme.text.base} wrapMode="none">
            {window().lines.join("\n")}
          </text>
          <Show when={window().left || window().right}>
            <text fg={props.theme.text.feedback.info.base}>
              {window().left ? "◀ " : "  "}wider than the panel · ←/→ to pan · f fullscreen{window().right ? " ▶" : ""}
            </text>
          </Show>
        </box>
      )}
    </Show>
  )
}
