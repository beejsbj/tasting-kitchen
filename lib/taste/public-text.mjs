/**
 * The public-text scan, free of Node imports so the gallery can check text
 * (a verdict note) before it is committed, with the same rules the registry
 * build enforces.
 */
const FORBIDDEN_PUBLIC_PATTERNS = [
  // A user directory with or without a trailing segment, root's home, and this
  // host's workspace mount. root/mnt only at a path start: "camera/root/drawing" is prose.
  [/\/(?:home|Users)\/[A-Za-z0-9._-]+|(?<![A-Za-z0-9._-])\/root\/|(?<![A-Za-z0-9._-])\/mnt\/server-ssd(?![A-Za-z0-9._-])/g, "absolute home path"],
  [/(?<![A-Za-z0-9])[A-Za-z]:[\\/](?:[^\s"'<>]+[\\/])+[^\s"'<>]*/g, "absolute Windows path"],
  [/(?<![:/@A-Za-z0-9._-])\/(?!\/)(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g, "absolute path"],
  [/file:\/\//gi, "file URL"],
  [/(?:^|[\s("'`])(?:~\/|\$HOME(?:\/|\b)|\$\{HOME\}(?:\/|\b)|%USERPROFILE%(?:[\\/]|\b))/gim, "home path form"],
  [/(?:^|[\s("'`=])\.\.(?:[\\/]|%2f|%5c)/gim, "path traversal"],
  [/(?:%2e){2}(?:%2f|%5c)/gim, "encoded path traversal"],
  [/(?:^|[\\/])private[\\/]/gim, "private directory reference"],
  [/\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g, "credential-like token"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "JWT-like credential"],
  [/\b(?:access|refresh|id)_token\b\s*[:=]/gi, "authentication-token field"],
  [/\b(?:evidence|session|conversation)[-_ ](?:id|key)\s*[:=]\s*[A-Za-z0-9_-]{6,}/gim, "private evidence identifier"],
  [/\b(?:CJ|MC|MCL|AO|DA|E)\d{3}\b/g, "private evidence identifier"],
  [/\b(?:leaderboards?|ratings?|rankings?|scoring|scores?)\b/gi, "numerical ranking language"],
];

export function publicTextFindings(text) {
  // A first-line `#!/usr/bin/env` (or `env -S`) names no machine, so only that
  // prefix is skipped. The interpreter, its flags and anything else on the line
  // are scanned like any other text; any other shebang is scanned whole.
  text = text.replace(/^#!\/usr\/bin\/env(?: -S)?(?=[ \t])/u, "");
  const findings = [];
  for (const [pattern, reason] of FORBIDDEN_PUBLIC_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      // A regex argument such as replace(/-/g, " ") has the same token shape
      // as a two-segment Unix path. Exempt it only in a narrow JavaScript call
      // position; the same bytes in prose (including /etc/g) remain blocked.
      if (reason === "absolute path" && /^\/[^/\r\n]+\/[dgimsuvy]+$/u.test(match[0])) {
        const before = text.slice(Math.max(0, match.index - 80), match.index);
        const after = text.slice(match.index + match[0].length);
        const regexArgument = /\.(?:match|matchAll|replace|replaceAll|search|split)\(\s*$/u.test(before)
          && /^\s*[,)]/u.test(after);
        if (regexArgument) continue;
      }
      findings.push(reason);
      break;
    }
  }
  return findings;
}
