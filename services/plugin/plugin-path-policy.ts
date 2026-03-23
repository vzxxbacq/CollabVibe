export function normalizeSubpath(raw: string): string {
  const subpath = raw.trim().replace(/^\.?\//, "").replace(/\\/g, "/");
  if (!subpath || subpath.includes("..") || subpath.startsWith("/")) {
    throw new Error("Skill 子路径非法，请提供仓库内相对路径");
  }
  return subpath;
}

export function isArchivePath(path: string): boolean {
  return /\.(zip|tgz|tar\.gz)$/i.test(path);
}
