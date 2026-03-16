import { defineConfig } from "vitepress";

export default defineConfig({
  title: "CollabVibe",
  description: "CollabVibe IM Agent 协作系统文档站点",
  lang: "zh-CN",
  lastUpdated: true,
  markdown: {
    config(md) {
      const fence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.info.trim() === "mermaid") {
          const encoded = encodeURIComponent(token.content);
          return `<MermaidBlock code="${md.utils.escapeHtml(encoded)}" />`;
        }
        return fence ? fence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
      };
    }
  },
  themeConfig: {
    siteTitle: "CollabVibe",
    nav: [
      { text: "项目", link: "/00-overview/project-intro" },
      { text: "QUICKSTART", link: "/00-overview/quickstart" },
      { text: "架构", link: "/01-architecture/data-paths" },
      { text: "运维", link: "/02-operations/logging-system" },
      { text: "开发", link: "/03-development/local-development" }
    ],
    sidebar: [
      {
        text: "00 QUICKSTART",
        items: [
          { text: "项目简介", link: "/00-overview/project-intro" },
          { text: "QUICKSTART", link: "/00-overview/quickstart" },
          { text: "系统总览", link: "/00-overview/system-overview" },
          { text: "Feishu 平台接入", link: "/00-overview/platform-feishu" },
          { text: "Slack 平台接入", link: "/00-overview/platform-slack" }
        ]
      },
      {
        text: "01 架构",
        items: [
          { text: "调用链与数据流", link: "/01-architecture/data-paths" },
          { text: "核心类：Project / Thread / Turn", link: "/01-architecture/core-entities" },
          { text: "分层隔离与模块契约", link: "/01-architecture/invariants" }
        ]
      },
      {
        text: "02 运维",
        items: [
          { text: "数据与存储", link: "/02-operations/data-and-storage" },
          { text: "日志系统", link: "/02-operations/logging-system" },
          { text: "故障排查", link: "/02-operations/troubleshooting" },
          { text: "GitHub Pages", link: "/02-operations/github-pages" }
        ]
      },
      {
        text: "03 开发",
        items: [
          { text: "本地开发", link: "/03-development/local-development" },
          { text: "测试矩阵", link: "/03-development/testing" },
          { text: "模块与目录", link: "/03-development/module-map" },
          { text: "核心类型", link: "/03-development/core-types" },
          { text: "常见改动入口", link: "/03-development/change-playbooks" }
        ]
      }
    ]
  }
});
