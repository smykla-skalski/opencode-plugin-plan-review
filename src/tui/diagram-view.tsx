/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { SyntaxStyle } from "@opentui/core"
import { createMemo, onCleanup, Show } from "solid-js"
import { pan, renderDiagram } from "../diagram.ts"

/**
 * Mermaid drawn as text art, clipped to the panel and panned sideways with ←/→ via `offset`;
 * the fenced source is the fallback when the diagram cannot be drawn.
 */
export function DiagramView(props: {
  theme: Plugin.Context["theme"]
  syntax?: SyntaxStyle
  owner?: unknown
  source: string
  width: number
  offset: number
}) {
  const localSyntax = props.syntax ? undefined : (SyntaxStyle.create as (owner?: unknown) => SyntaxStyle)(props.owner)
  if (localSyntax) onCleanup(() => localSyntax.destroy())
  const syntax = props.syntax ?? localSyntax!
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
