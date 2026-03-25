import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { h } from "vue";
import MermaidBlock from "./MermaidBlock.vue";
import CopyMarkdownButton from "./components/CopyMarkdownButton.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "doc-before": () => h(CopyMarkdownButton)
    });
  },
  enhanceApp({ app }) {
    app.component("MermaidBlock", MermaidBlock);
  }
} satisfies Theme;
