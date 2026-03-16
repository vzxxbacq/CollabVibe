import { describe, expect, it } from "vitest";

import { parseDiffFiles, cleanDiff } from "../../src/diff-utils";

// ── parseDiffFiles ──────────────────────────────────────────────────────────

describe("parseDiffFiles", () => {
    const sampleDiff = `diff --git a/test/hello_world_cli/README.md b/test/hello_world_cli/README.md
new file mode 100755
index 0000000..29d3e17
--- /dev/null
+++ b/test/hello_world_cli/README.md
@@ -0,0 +1,9 @@
+# Python Hello World (Pretty CLI Art)
+
+## 运行
+
+\`\`\`bash
+python3 main.py
+\`\`\`
+
+你会在命令行看到带颜色的 \`Hello World\` ASCII 艺术字。
diff --git a/test/hello_world_cli/main.py b/test/hello_world_cli/main.py
new file mode 100755
index 0000000..abc1234
--- /dev/null
+++ b/test/hello_world_cli/main.py
@@ -0,0 +1,5 @@
+import sys
+print("Hello World")
+print("Line 2")
+print("Line 3")
+print("Line 4")`;

    it("extracts per-file summaries from multi-file diff", () => {
        const files = parseDiffFiles(sampleDiff);
        expect(files).toHaveLength(2);

        expect(files[0].file).toBe("test/hello_world_cli/README.md");
        expect(files[0].status).toBe("new");
        expect(files[0].additions).toBe(9);
        expect(files[0].deletions).toBe(0);

        expect(files[1].file).toBe("test/hello_world_cli/main.py");
        expect(files[1].status).toBe("new");
        expect(files[1].additions).toBe(5);
        expect(files[1].deletions).toBe(0);
    });

    it("detects modified files", () => {
        const modDiff = `diff --git a/src/index.ts b/src/index.ts
index abc123..def456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from "../foo";
-const x = 1;
+const x = 2;
+const y = 3;`;

        const files = parseDiffFiles(modDiff);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe("modified");
        expect(files[0].additions).toBe(2);
        expect(files[0].deletions).toBe(1);
    });

    it("detects deleted files", () => {
        const delDiff = `diff --git a/old.ts b/old.ts
deleted file mode 100644
index abc123..0000000
--- a/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-line1
-line2
-line3`;

        const files = parseDiffFiles(delDiff);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe("deleted");
        expect(files[0].deletions).toBe(3);
    });

    it("returns empty for empty input", () => {
        expect(parseDiffFiles("")).toEqual([]);
    });
});

// ── cleanDiff ───────────────────────────────────────────────────────────────

describe("cleanDiff", () => {
    it("removes index, mode, and similarity lines", () => {
        const raw = `diff --git a/foo.ts b/foo.ts
index abc123..def456 100644
new file mode 100755
old mode 100644
new mode 100755
similarity index 95%
--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,3 @@
 line1
+line2
-line3`;

        const cleaned = cleanDiff(raw);
        expect(cleaned).not.toContain("index abc123");
        expect(cleaned).not.toContain("new file mode");
        expect(cleaned).not.toContain("old mode");
        expect(cleaned).not.toContain("new mode");
        expect(cleaned).not.toContain("similarity index");
        expect(cleaned).not.toContain("diff --git");
        expect(cleaned).not.toContain("--- a/foo.ts");
        expect(cleaned).not.toContain("+++ b/foo.ts");
        expect(cleaned).not.toContain("@@ -1,2");
        expect(cleaned).toContain("+line2");
        expect(cleaned).toContain("-line3");
        expect(cleaned).toContain(" line1");
    });
});
