#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const blockedPaths = [
  /(^|\/)\.browser-profile(\/|$)/,
  /(^|\/)\.seleniumbase-profile(\/|$)/,
  /(^|\/)\.venv(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)output(\/|$)/,
  /(^|\/)config\.json$/,
  /(^|\/)credentials\.json$/i,
  /(^|\/)secrets\.json$/i,
  /(^|\/)\.env(?!\.example$)(?:\.|$)/
];

const credentialPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["Google API key", /\bAIza[A-Za-z0-9_-]{35}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["credential in URL", /\bhttps?:\/\/[^\s/:]+:[^\s/@]+@/],
  [
    "assigned credential",
    /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\b\s*[:=]\s*["'][^"'\s]{8,}["']/i
  ]
];

function trackedFiles() {
  try {
    const output = execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return output.split("\0").filter(Boolean);
  } catch {
    throw new Error("Run this check from an initialized Git repository.");
  }
}

const findings = [];
for (const file of trackedFiles()) {
  if (blockedPaths.some((pattern) => pattern.test(file))) {
    findings.push(`${file}: local-only path is tracked`);
    continue;
  }

  let content;
  try {
    const bytes = readFileSync(file);
    if (bytes.includes(0)) continue;
    content = bytes.toString("utf8");
  } catch (error) {
    findings.push(`${file}: could not inspect (${error.message})`);
    continue;
  }

  for (const [description, pattern] of credentialPatterns) {
    if (pattern.test(content)) findings.push(`${file}: possible ${description}`);
  }
}

if (findings.length > 0) {
  console.error("Sensitive-file check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Sensitive-file check passed for ${trackedFiles().length} tracked files.`);
}
