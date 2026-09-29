import path from "node:path"

const escape = (value: string) => value.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")

function pattern(glob: string) {
  const source = glob
    .split("**")
    .map((part) => part.split("*").map((piece) => escape(piece)).join("[^/]*").replaceAll("?", "[^/]"))
    .join(".*")
  return new RegExp(`^${source}$`)
}

const relative = (resource: string, directory: string) => {
  const target = path.isAbsolute(resource) ? path.relative(directory, resource) : path.normalize(resource)
  return target.split(path.sep).join("/")
}

/** True when an approved step lists the resource, a parent directory of it, or a glob matching it. */
export function covered(resource: string, files: readonly string[], directory: string) {
  const target = relative(resource, directory)
  if (target.startsWith("../")) return false
  return files.some((entry) => {
    const file = relative(entry, directory).replace(/\/$/, "")
    if (file.includes("*") || file.includes("?")) return pattern(file).test(target)
    return target === file || target.startsWith(`${file}/`)
  })
}
