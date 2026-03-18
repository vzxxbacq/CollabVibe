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
  { text: "Architecture", link: "/01-architecture/data-paths" },
  { text: "Operations", link: "/02-operations/logging-system" },
  { text: "Development", link: "/03-development/local-development" }
];

const chineseNav = [
  { text: "项目", link: "/zh/00-overview/project-intro" },
  { text: "QUICKSTART", link: "/zh/00-overview/quickstart" },
  { text: "架构", link: "/zh/01-architecture/data-paths" },
  { text: "运维", link: "/zh/02-operations/logging-system" },
  { text: "开发", link: "/zh/03-development/local-development" }
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
      { text: "Execution Paths and Data Flow", link: "/01-architecture/data-paths" },
      { text: "Core Entities: Project / Thread / Turn", link: "/01-architecture/core-entities" },
      { text: "Layering and Module Contracts", link: "/01-architecture/invariants" },
      { text: "BackendIdentity", link: "/01-architecture/backend-identity" },
      { text: "Layers and Boundaries", link: "/01-architecture/layers-and-boundaries" },
      { text: "Project Aggregate Architecture", link: "/01-architecture/project-aggregate" },
      { text: "Threads and State", link: "/01-architecture/thread-and-state" }
    ]
  },
  {
    text: "02 OPERATIONS",
    items: [
      { text: "Deployment", link: "/02-operations/deployment" },
      { text: "Data and Storage", link: "/02-operations/data-and-storage" },
      { text: "Logging System", link: "/02-operations/logging-system" },
      { text: "Feishu Operations", link: "/02-operations/platform-feishu" },
      { text: "Slack Operations", link: "/02-operations/platform-slack" },
      { text: "Troubleshooting", link: "/02-operations/troubleshooting" }
    ]
  },
  {
    text: "03 DEVELOPMENT",
    items: [
      { text: "Local Development", link: "/03-development/local-development" },
      { text: "Test Matrix", link: "/03-development/testing" },
      { text: "Module Map", link: "/03-development/module-map" },
      { text: "Core Types", link: "/03-development/core-types" },
      { text: "Change Playbooks", link: "/03-development/change-playbooks" },
      { text: "Project Aggregate Migration", link: "/03-development/project-aggregate-migration" }
    ]
  }
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
      { text: "调用链与数据流", link: "/zh/01-architecture/data-paths" },
      { text: "核心类：Project / Thread / Turn", link: "/zh/01-architecture/core-entities" },
      { text: "分层隔离与模块契约", link: "/zh/01-architecture/invariants" },
      { text: "BackendIdentity", link: "/zh/01-architecture/backend-identity" },
      { text: "分层与边界", link: "/zh/01-architecture/layers-and-boundaries" },
      { text: "Project 聚合架构", link: "/zh/01-architecture/project-aggregate" },
      { text: "线程与状态", link: "/zh/01-architecture/thread-and-state" }
    ]
  },
  {
    text: "02 运维",
    items: [
      { text: "发布与部署策略", link: "/zh/02-operations/deployment" },
      { text: "数据与存储", link: "/zh/02-operations/data-and-storage" },
      { text: "日志系统", link: "/zh/02-operations/logging-system" },
      { text: "Feishu 平台接入", link: "/zh/02-operations/platform-feishu" },
      { text: "Slack 平台接入", link: "/zh/02-operations/platform-slack" },
      { text: "故障排查", link: "/zh/02-operations/troubleshooting" }
    ]
  },
  {
    text: "03 开发",
    items: [
      { text: "本地开发", link: "/zh/03-development/local-development" },
      { text: "测试矩阵", link: "/zh/03-development/testing" },
      { text: "模块与目录", link: "/zh/03-development/module-map" },
      { text: "核心类型", link: "/zh/03-development/core-types" },
      { text: "常见改动入口", link: "/zh/03-development/change-playbooks" },
      { text: "Project 聚合迁移说明", link: "/zh/03-development/project-aggregate-migration" }
    ]
  }
];

export default defineConfig({
  title: "CollabVibe",
  description: "CollabVibe IM Agent collaboration docs site",
  lastUpdated: true,
  markdown: createMermaidMarkdownConfig(),
  themeConfig: {
    siteTitle: "CollabVibe"
  },
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      themeConfig: {
        siteTitle: "CollabVibe",
        nav: englishNav,
        sidebar: englishSidebar
      }
    },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      link: "/zh/",
      themeConfig: {
        siteTitle: "CollabVibe",
        nav: chineseNav,
        sidebar: chineseSidebar
      }
    }
  }
});
