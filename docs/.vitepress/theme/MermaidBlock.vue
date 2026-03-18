<template>
  <div class="mermaid-block">
    <div ref="container" class="mermaid-block__inner" />
  </div>
</template>

<script setup lang="ts">
import mermaid from "mermaid";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{ code: string }>();

const container = ref<HTMLElement | null>(null);
let observer: MutationObserver | null = null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function source(): string {
  return decodeURIComponent(props.code);
}

function currentTheme(): "default" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "default";
}

async function renderDiagram(): Promise<void> {
  if (!container.value) return;
  const graph = source();
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: currentTheme()
    });
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
    const { svg } = await mermaid.render(id, graph);
    if (container.value) container.value.innerHTML = svg;
  } catch (error) {
    if (container.value) {
      container.value.innerHTML = `<pre class="mermaid-error">${escapeHtml(graph)}</pre>`;
    }
    console.error("[docs] mermaid render failed", error);
  }
}

onMounted(async () => {
  await nextTick();
  await renderDiagram();
  observer = new MutationObserver(() => {
    void renderDiagram();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

watch(() => props.code, async () => {
  await nextTick();
  await renderDiagram();
});
</script>
