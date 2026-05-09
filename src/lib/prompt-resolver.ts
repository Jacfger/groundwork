import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Resolves a prompt string that may be a file:// URI.
 * If the string starts with "file://", decodes the URI, resolves the file path
 * (expanding ~ and resolving relative paths against configDir), and reads the file content.
 * Otherwise returns the string as-is.
 *
 * Returns warning strings for malformed URIs, missing files, or read errors.
 */
export function resolvePromptAppend(promptAppend: string, configDir?: string): string {
  if (!promptAppend.startsWith("file://")) return promptAppend;

  const encoded = promptAppend.slice(7);

  let filePath: string;
  try {
    const decoded = decodeURIComponent(encoded);
    const expanded = decoded.startsWith("~/")
      ? decoded.replace(/^~\//, `${homedir()}/`)
      : decoded;
    filePath = isAbsolute(expanded)
      ? expanded
      : resolve(configDir ?? process.cwd(), expanded);
  } catch {
    return `[WARNING: Malformed file URI: ${promptAppend}]`;
  }

  if (!existsSync(filePath)) {
    return `[WARNING: Could not resolve file URI: ${filePath}]`;
  }

  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return `[WARNING: Could not read file: ${filePath}]`;
  }
}
