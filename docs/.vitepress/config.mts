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

const englishNav = [
  { text: "Project", link: "/00-overview/project-intro" },
  { text: "Quickstart", link: "/00-overview/quickstart" },
  { text: "Architecture", link: "/01-architecture/architecture" },
];

const chineseNav = [
  { text: "项目", link: "/zh/00-overview/project-intro" },
  { text: "QUICKSTART", link: "/zh/00-overview/quickstart" },
  { text: "架构", link: "/zh/01-architecture/architecture" },
];

const socialLinks = [
  { icon: "github", link: "https://github.com/vzxxbacq/CollabVibeBeta" }
];

const englishSidebar = [
  {
    text: "00 OVERVIEW",
    items: [
      { text: "Project Introduction", link: "/00-overview/project-intro" },
      { text: "Quickstart", link: "/00-overview/quickstart" },
      { text: "System Overview", link: "/00-overview/system-overview" },
      { text: "Feishu Integration", link: "/00-overview/platform-feishu" },
      { text: "Slack Integration", link: "/00-overview/platform-slack" },
      { text: "Glossary", link: "/00-overview/glossary" }
    ]
  },
  {
    text: "01 ARCHITECTURE",
    items: [
      { text: "System Architecture", link: "/01-architecture/architecture" },
      { text: "Orchestrator Internals", link: "/01-architecture/orchestrator-internals" },
      { text: "Core APIs", link: "/01-architecture/core-api" },
      { text: "L3 Internals", link: "/01-architecture/l3-internals" }
    ]
  },
];

const chineseSidebar = [
  {
    text: "00 QUICKSTART",
    items: [
      { text: "项目简介", link: "/zh/00-overview/project-intro" },
      { text: "QUICKSTART", link: "/zh/00-overview/quickstart" },
      { text: "系统总览", link: "/zh/00-overview/system-overview" },
      { text: "Feishu 平台接入", link: "/zh/00-overview/platform-feishu" },
      { text: "Slack 平台接入", link: "/zh/00-overview/platform-slack" },
      { text: "术语表", link: "/zh/00-overview/glossary" }
    ]
  },
  {
    text: "01 架构",
    items: [
      { text: "调用链与数据流", link: "/zh/01-architecture/architecture" },
      { text: "核心类：Project / Thread / Turn", link: "/zh/01-architecture/core-entities" },
      { text: "分层隔离与模块契约", link: "/zh/01-architecture/layers-and-boundaries" },
      { text: "BackendIdentity", link: "/zh/01-architecture/backend-identity" },
      { text: "分层与边界", link: "/zh/01-architecture/layers-and-boundaries" },
      { text: "Project 聚合架构", link: "/zh/01-architecture/project-aggregate" },
      { text: "线程与状态", link: "/zh/01-architecture/thread-and-state" }
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
      label: "English",
      lang: "en-US",
      themeConfig: {
        siteTitle: "CollabVibe",
        nav: englishNav,
        sidebar: englishSidebar,
        socialLinks
      }
    },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      link: "/zh/",
      themeConfig: {
        siteTitle: "CollabVibe",
        nav: chineseNav,
        sidebar: chineseSidebar,
        socialLinks
      }
    }
  }
});
