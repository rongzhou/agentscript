// @ts-check

const config = {
  title: "AgentScript",
  tagline: "Explicit, scoped, auditable LLM context",
  url: "https://rongzhou.github.io",
  baseUrl: "/agentscript/",
  organizationName: "rongzhou",
  projectName: "agentscript",
  trailingSlash: false,

  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh-Hans"],
    localeConfigs: {
      en: {
        label: "English",
      },
      "zh-Hans": {
        label: "简体中文",
      },
    },
  },

  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.js",
          routeBasePath: "docs",
          editUrl: "https://github.com/rongzhou/agentscript/tree/main/website/",
        },
        blog: {
          showReadingTime: true,
          onUntruncatedBlogPosts: "ignore",
          editUrl: "https://github.com/rongzhou/agentscript/tree/main/website/blog/",
          blogSidebarTitle: "All posts",
          blogSidebarCount: "ALL",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      },
    ],
  ],

  themeConfig: {
    image: "img/context-boundaries.png",
    navbar: {
      title: "AgentScript",
      items: [
        {
          type: "docSidebar",
          sidebarId: "tutorialSidebar",
          position: "left",
          label: "Tutorials",
        },
        { to: "/blog", label: "Blog", position: "left" },
        {
          type: "localeDropdown",
          position: "right",
        },
        {
          href: "https://github.com/rongzhou/agentscript",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Learn",
          items: [
            { label: "Tutorials", to: "/docs/tutorials/" },
            { label: "Blog", to: "/blog" },
          ],
        },
        {
          title: "Project",
          items: [
            { label: "GitHub", href: "https://github.com/rongzhou/agentscript" },
            { label: "npm", href: "https://www.npmjs.com/package/@rong/agentscript" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} AgentScript.`,
    },
    prism: {
      additionalLanguages: ["bash", "json", "typescript"],
    },
  },
};

module.exports = config;
