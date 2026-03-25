<script setup lang="ts">
import { computed, ref } from "vue";
import { useData, useRoute } from "vitepress";
import { markdownSourceByRoute } from "../../generated/markdown-sources";

const route = useRoute();
const { frontmatter } = useData();
const feedback = ref<"idle" | "copied" | "failed">("idle");
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

const normalizedPath = computed(() => {
  const [pathname] = route.path.split(/[?#]/, 1);
  if (pathname === "/") {
    return "/";
  }
  if (pathname === "/zh/" || pathname === "/zh") {
    return "/zh/";
  }
  const withoutTrailingSlash = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return withoutTrailingSlash.endsWith(".html") ? withoutTrailingSlash.slice(0, -5) : withoutTrailingSlash;
});

const markdown = computed(() => markdownSourceByRoute[normalizedPath.value as keyof typeof markdownSourceByRoute]);
const isVisible = computed(() => frontmatter.value.layout !== "home" && typeof markdown.value === "string");
const label = computed(() => {
  if (feedback.value === "copied") {
    return "Copied";
  }
  if (feedback.value === "failed") {
    return "Copy failed";
  }
  return "Copy as Markdown";
});

function setFeedback(next: "idle" | "copied" | "failed") {
  feedback.value = next;
  if (feedbackTimer) {
    clearTimeout(feedbackTimer);
  }
  if (next !== "idle") {
    feedbackTimer = setTimeout(() => {
      feedback.value = "idle";
      feedbackTimer = undefined;
    }, 1600);
  }
}

async function copyMarkdown() {
  if (!markdown.value) {
    setFeedback("failed");
    return;
  }

  try {
    await navigator.clipboard.writeText(markdown.value);
    setFeedback("copied");
  } catch {
    setFeedback("failed");
  }
}
</script>

<template>
  <div v-if="isVisible" class="copy-markdown-banner">
    <button class="copy-markdown-button" type="button" @click="copyMarkdown">
      {{ label }}
    </button>
  </div>
</template>
