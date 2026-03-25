import { defineConfig } from "vitepress";

function createMermaidMarkdownConfig() {
  return {
    config(md: any) {
      const fence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens: any, idx: number, options: any, env: any, self: any) => {
        const token = tokens[idx];
        if (token.info.trim() === "mermaid") {
          const encoded = encodeURIComponent(token.content);
          return `<MermaidBlock code="${md.utils.escapeHtml(encoded)}" />`;
        }
        return fence ? fence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
      };
    }
  };
}

const chineseNav = [
  { text: "项目", link: "/00-overview/project-intro" },
  { text: "快速开始", link: "/00-overview/quickstart" },
  { text: "架构", link: "/01-architecture/architecture" },
];

const englishNav = [
  { text: "Project", link: "/en/00-overview/project-intro" },
  { text: "Quickstart", link: "/en/00-overview/quickstart" },
  { text: "Architecture", link: "/en/01-architecture/architecture" },
];

const socialLinks = [
  { icon: "github", link: "https://github.com/vzxxbacq/CollabVibeBeta" }
];

const chineseSidebar = [
  {
    text: "00 快速开始",
    items: [
      { text: "项目简介", link: "/00-overview/project-intro" },
      { text: "快速开始", link: "/00-overview/quickstart" },
      { text: "系统总览", link: "/00-overview/system-overview" },
      { text: "Feishu 平台接入", link: "/00-overview/platform-feishu" },
      { text: "Slack 平台接入", link: "/00-overview/platform-slack" },
      { text: "术语表", link: "/00-overview/glossary" }
    ]
  },
  {
    text: "01 架构",
    items: [
      { text: "调用链与数据流", link: "/01-architecture/architecture" },
      { text: "核心类：Project / Thread / Turn", link: "/01-architecture/core-entities" },
      { text: "分层隔离与模块契约", link: "/01-architecture/layers-and-boundaries" },
      { text: "BackendIdentity", link: "/01-architecture/backend-identity" },
      { text: "Project 聚合架构", link: "/01-architecture/project-aggregate" },
      { text: "线程与状态", link: "/01-architecture/thread-and-state" }
    ]
  },
];

const englishSidebar = [
  {
    text: "00 OVERVIEW",
    items: [
      { text: "Project Introduction", link: "/en/00-overview/project-intro" },
      { text: "Quickstart", link: "/en/00-overview/quickstart" },
      { text: "System Overview", link: "/en/00-overview/system-overview" },
      { text: "Feishu Integration", link: "/en/00-overview/platform-feishu" },
      { text: "Slack Integration", link: "/en/00-overview/platform-slack" },
      { text: "Glossary", link: "/en/00-overview/glossary" }
    ]
  },
  {
    text: "01 ARCHITECTURE",
    items: [
      { text: "System Architecture", link: "/en/01-architecture/architecture" },
      { text: "Orchestrator Internals", link: "/en/01-architecture/orchestrator-internals" },
      { text: "Core APIs", link: "/en/01-architecture/core-api" },
      { text: "L3 Internals", link: "/en/01-architecture/l3-internals" }
    ]
  },
];

export default defineConfig({
  title: "CollabVibe",
  description: "CollabVibe IM Agent collaboration docs site",
  lastUpdated: true,
  markdown: createMermaidMarkdownConfig(),
  themeConfig: {
    siteTitle: "CollabVibe",
    socialLinks
  },
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      themeConfig: {
        siteTitle: "CollabVibe",
        nav: chineseNav,
        sidebar: chineseSidebar,
        socialLinks
      }
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      themeConfig: {
        siteTitle: "CollabVibe",
        nav: englishNav,
        sidebar: englishSidebar,
        socialLinks
      }
    }
  }
});
