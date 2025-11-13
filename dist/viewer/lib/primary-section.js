const HERO_SECTION_REGEX = /<section[^>]*id=(["'])hero\1[\s\S]*?<\/section>/i;
const MAIN_SECTION_REGEX = /<main[\s\S]*?<\/main>/i;
function extractPrimarySection(responseText) {
  const heroMatch = HERO_SECTION_REGEX.exec(responseText);
  const rawSection = heroMatch?.[0] ?? extractFallbackSection(responseText) ?? responseText;
  const normalized = normalizeSection(rawSection);
  return { sanitizedHtml: normalized, rawSection };
}
function extractFallbackSection(source) {
  const mainMatch = MAIN_SECTION_REGEX.exec(source);
  if (mainMatch?.[0]) {
    return mainMatch[0];
  }
  return source.trim() || null;
}
function normalizeSection(section) {
  if (!section) return "";
  let output = section;
  output = stripJsxArtifacts(output);
  output = convertClassBindings(output);
  output = convertCustomComponents(output);
  output = sanitizeMarkup(output);
  return output;
}
function stripJsxArtifacts(source) {
  return source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/\{\s*["'`]\s*\}/g, " ").replace(/\{\s*`([^`]+)`\s*\}/g, (_, text) => text).replace(/\{\s*"([^"]+)"\s*\}/g, (_, text) => text).replace(/\{\s*'([^']+)'\s*\}/g, (_, text) => text).replace(/<>/g, '<div class="arena-fragment">').replace(/<\/>/g, "</div>");
}
function convertClassBindings(source) {
  return source.replace(/className=/g, "class=").replace(/class=\{\s*`([^`]+)`\s*\}/g, (_, classes) => `class="${classes}"`).replace(/class=\{\s*"([^"]+)"\s*\}/g, (_, classes) => `class="${classes}"`).replace(/class=\{\s*'([^']+)'\s*\}/g, (_, classes) => `class="${classes}"`).replace(/class=\{\s*([^}]+)\s*\}/g, (_, expr) => {
    return `class="${expr.split(/[\s+|]+/).map((token) => token.replace(/["'`]/g, "").trim()).filter(Boolean).join(" ")}"`;
  });
}
function convertCustomComponents(source) {
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
function replaceComponent(source, componentName, tagName, baseClass, stripAttrs = []) {
  const openingTagRegex = new RegExp(`<${componentName}([^>]*)>`, "g");
  const closingTagRegex = new RegExp(`</${componentName}>`, "g");
  const transformAttrs = (attrs) => buildTagAttributes(attrs, baseClass, stripAttrs);
  return source.replace(openingTagRegex, (_, attrs) => `<${tagName}${transformAttrs(attrs)}>`).replace(closingTagRegex, `</${tagName}>`);
}
function replaceSelfClosing(source, componentName, tagName, baseClass, keepAttrs = []) {
  const regex = new RegExp(`<${componentName}([^>]*)/>`, "g");
  return source.replace(regex, (_, attrs) => {
    const mapped = buildTagAttributes(attrs, baseClass, [], keepAttrs);
    return `<${tagName}${mapped}></${tagName}>`;
  });
}
function buildTagAttributes(attrs, baseClass, stripAttrs = [], keepOnly) {
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
  const classes = [baseClass];
  if (parsed.className) {
    classes.push(...splitClasses(parsed.className));
    delete parsed.className;
  }
  if (parsed.class) {
    classes.push(...splitClasses(parsed.class));
    delete parsed.class;
  }
  const attrPairs = Object.entries(parsed).map(([key, value]) => `${key}="${escapeAttribute(value)}"`).join(" ");
  return ` class="${classes.filter(Boolean).join(" ")}"${attrPairs ? ` ${attrPairs}` : ""}`;
}
function parseAttributes(source) {
  const attrs = {};
  const regex = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*({[^}]*}|"[^"]*"|'[^']*')/g;
  let match;
  while (match = regex.exec(source)) {
    const [, key, rawValue] = match;
    attrs[key] = unwrapAttributeValue(rawValue);
  }
  return attrs;
}
function unwrapAttributeValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") && trimmed.endsWith("}") || trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
function splitClasses(value) {
  if (!value) return [];
  return value.replace(/[`"'{}]/g, " ").split(/\s+/).filter(Boolean);
}
function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function sanitizeMarkup(source) {
  return source.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "").replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "").replace(/\son[a-z]+\s*=\s*\{[^}]*\}/gi, "").replace(/style=\{[^}]*\}/gi, "").replace(/style="[^"]*"/gi, "").replace(/style='[^']*'/gi, "");
}
export {
  extractPrimarySection
};
//# sourceMappingURL=primary-section.js.map
