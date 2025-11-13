const HERO_SECTION_REGEX = /<section[^>]*id=(["'])hero\1[\s\S]*?<\/section>/i;
const MAIN_SECTION_REGEX = /<main[\s\S]*?<\/main>/i;

export interface ExtractionResult {
  sanitizedHtml: string;
  rawSection: string;
}

export function extractPrimarySection(responseText: string): ExtractionResult {
  const heroMatch = HERO_SECTION_REGEX.exec(responseText);
  const rawSection = heroMatch?.[0] ?? extractFallbackSection(responseText) ?? responseText;
  const normalized = normalizeSection(rawSection);
  return { sanitizedHtml: normalized, rawSection };
}

function extractFallbackSection(source: string): string | null {
  const mainMatch = MAIN_SECTION_REGEX.exec(source);
  if (mainMatch?.[0]) {
    return mainMatch[0];
  }
  return source.trim() || null;
}

function normalizeSection(section: string): string {
  if (!section) return "";
  let output = section;
  output = stripJsxArtifacts(output);
  output = convertClassBindings(output);
  output = convertCustomComponents(output);
  output = sanitizeMarkup(output);
  return output;
}

function stripJsxArtifacts(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "") // strip comments
    .replace(/\{\s*["'`]\s*\}/g, " ") // strip empty spaces
    .replace(/\{\s*`([^`]+)`\s*\}/g, (_, text) => text) // inline template strings
    .replace(/\{\s*"([^"]+)"\s*\}/g, (_, text) => text)
    .replace(/\{\s*'([^']+)'\s*\}/g, (_, text) => text)
    .replace(/<>/g, '<div class="arena-fragment">')
    .replace(/<\/>/g, "</div>");
}

function convertClassBindings(source: string): string {
  return source
    .replace(/className=/g, "class=")
    .replace(/class=\{\s*`([^`]+)`\s*\}/g, (_, classes) => `class="${classes}"`)
    .replace(/class=\{\s*"([^"]+)"\s*\}/g, (_, classes) => `class="${classes}"`)
    .replace(/class=\{\s*'([^']+)'\s*\}/g, (_, classes) => `class="${classes}"`)
    .replace(/class=\{\s*([^}]+)\s*\}/g, (_, expr) => {
      return `class="${expr
        .split(/[\s+|]+/)
        .map((token: string) => token.replace(/["'`]/g, "").trim())
        .filter(Boolean)
        .join(" ")}"`;
    });
}

function convertCustomComponents(source: string): string {
  let output = source;

  output = replaceComponent(output, "Button", "button", "arena-btn", ["variant", "size", "asChild"]);
  output = replaceComponent(output, "Badge", "span", "arena-badge");
  output = replaceComponent(output, "Card", "div", "arena-card");
  output = replaceComponent(output, "CardHeader", "div", "arena-card__header");
  output = replaceComponent(output, "CardContent", "div", "arena-card__content");
  output = replaceComponent(output, "CardTitle", "h3", "arena-card__title");
  output = replaceComponent(output, "CardDescription", "p", "arena-card__description");
  output = replaceComponent(output, "CardFooter", "div", "arena-card__footer");
  output = replaceComponent(output, "Tabs", "div", "arena-tabs");
  output = replaceComponent(output, "TabsList", "div", "arena-tabs__list");
  output = replaceComponent(output, "TabsTrigger", "button", "arena-tabs__trigger", ["value"]);
  output = replaceComponent(output, "TabsContent", "div", "arena-tabs__content", ["value"]);
  output = replaceComponent(output, "Link", "a", "arena-link", ["prefetch", "legacyBehavior"]);
  output = replaceComponent(output, "Input", "input", "arena-input", ["type"]);
  output = replaceComponent(output, "Label", "label", "arena-label");
  output = replaceComponent(output, "Textarea", "textarea", "arena-textarea");
  output = replaceComponent(output, "Avatar", "div", "arena-avatar");
  output = replaceComponent(output, "AvatarImage", "div", "arena-avatar__image", ["src", "alt"]);
  output = replaceComponent(output, "AvatarFallback", "span", "arena-avatar__fallback");
  output = replaceSelfClosing(output, "Image", "div", "arena-image", ["src", "alt", "width", "height"]);

  return output;
}

function replaceComponent(
  source: string,
  componentName: string,
  tagName: string,
  baseClass: string,
  stripAttrs: string[] = [],
): string {
  const openingTagRegex = new RegExp(`<${componentName}([^>]*)>`, "g");
  const closingTagRegex = new RegExp(`</${componentName}>`, "g");

  const transformAttrs = (attrs: string) => buildTagAttributes(attrs, baseClass, stripAttrs);

  return source
    .replace(openingTagRegex, (_, attrs) => `<${tagName}${transformAttrs(attrs)}>`)
    .replace(closingTagRegex, `</${tagName}>`);
}

function replaceSelfClosing(source: string, componentName: string, tagName: string, baseClass: string, keepAttrs: string[] = []): string {
  const regex = new RegExp(`<${componentName}([^>]*)/>`, "g");
  return source.replace(regex, (_, attrs) => {
    const mapped = buildTagAttributes(attrs, baseClass, [], keepAttrs);
    return `<${tagName}${mapped}></${tagName}>`;
  });
}

function buildTagAttributes(attrs: string, baseClass: string, stripAttrs: string[] = [], keepOnly?: string[]): string {
  const parsed = parseAttributes(attrs ?? "");

  for (const key of stripAttrs) {
    delete parsed[key];
  }

  if (keepOnly && keepOnly.length > 0) {
    for (const key of Object.keys(parsed)) {
      if (!keepOnly.includes(key)) {
        delete parsed[key];
      }
    }
  }

  const classes: string[] = [baseClass];
  if (parsed.className) {
    classes.push(...splitClasses(parsed.className));
    delete parsed.className;
  }
  if (parsed.class) {
    classes.push(...splitClasses(parsed.class));
    delete parsed.class;
  }

  const attrPairs = Object.entries(parsed)
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(" ");

  return ` class="${classes.filter(Boolean).join(" ")}"${attrPairs ? ` ${attrPairs}` : ""}`;
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*({[^}]*}|"[^"]*"|'[^']*')/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source))) {
    const [, key, rawValue] = match;
    attrs[key] = unwrapAttributeValue(rawValue);
  }
  return attrs;
}

function unwrapAttributeValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("(") && trimmed.endsWith(")"))) {
    return trimmed.slice(1, -1).trim();
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitClasses(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/[`"'{}]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeMarkup(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*\{[^}]*\}/gi, "")
    .replace(/style=\{[^}]*\}/gi, "")
    .replace(/style="[^"]*"/gi, "")
    .replace(/style='[^']*'/gi, "");
}

