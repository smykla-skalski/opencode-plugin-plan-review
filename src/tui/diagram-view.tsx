/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { SyntaxStyle } from "@opentui/core"
import { createMemo, Show } from "solid-js"
import { renderDiagram } from "../diagram.ts"

const syntax = SyntaxStyle.create()

/** Mermaid drawn as text art; the fenced source is the fallback when it cannot be drawn. */
export function DiagramView(props: { theme: Plugin.Context["theme"]; source: string }) {
  const art = createMemo(() => renderDiagram(props.source))
  return (
    <Show
      when={art()}
      fallback={
        <markdown
          content={["```mermaid", props.source.trim(), "```"].join("\n")}
          syntaxStyle={syntax}
          fg={props.theme.markdown.text}
        />
      }
    >
      {(drawn) => (
        <text fg={props.theme.text.base} wrapMode="none" flexShrink={0}>
          {drawn()}
        </text>
      )}
    </Show>
  )
}
