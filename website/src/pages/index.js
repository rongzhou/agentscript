import clsx from "clsx";
import Link from "@docusaurus/Link";
import Translate from "@docusaurus/Translate";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import styles from "./index.module.css";

const features = [
  {
    id: "context",
    title: (
      <Translate id="homepage.feature.context.title" description="Homepage explicit context feature title">
        Explicit context
      </Translate>
    ),
    description: (
      <Translate id="homepage.feature.context.description" description="Homepage explicit context feature description">
        Choose exactly what enters each model call with scoped use declarations.
      </Translate>
    ),
  },
  {
    id: "audit",
    title: (
      <Translate id="homepage.feature.audit.title" description="Homepage auditable runs feature title">
        Auditable runs
      </Translate>
    ),
    description: (
      <Translate id="homepage.feature.audit.description" description="Homepage auditable runs feature description">
        Trace model calls, tool outputs, memory access, and prompt context boundaries.
      </Translate>
    ),
  },
  {
    id: "agents",
    title: (
      <Translate id="homepage.feature.agents.title" description="Homepage structured agents feature title">
        Structured agents
      </Translate>
    ),
    description: (
      <Translate id="homepage.feature.agents.description" description="Homepage structured agents feature description">
        Build multi-step workflows with typed inputs, contracts, tools, memory, and agents.
      </Translate>
    ),
  },
];

export default function Home() {
  return (
    <Layout title="AgentScript" description="Explicit, scoped, auditable LLM context">
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div>
              <Heading as="h1" className={styles.title}>
                AgentScript
              </Heading>
              <p className={styles.subtitle}>
                <Translate id="homepage.subtitle" description="Homepage subtitle">
                  A small language for explicit, scoped, auditable LLM context.
                </Translate>
              </p>
              <div className={styles.actions}>
                <Link className="button button--primary button--lg" to="/docs/tutorials/">
                  <Translate id="homepage.startTutorials" description="Homepage tutorials button">
                    Start Tutorials
                  </Translate>
                </Link>
                <Link className="button button--secondary button--lg" to="/blog">
                  <Translate id="homepage.readBlog" description="Homepage blog button">
                    Read Blog
                  </Translate>
                </Link>
              </div>
            </div>
            <div className={styles.preview}>
              <img
                src="/img/context-boundaries.png"
                alt="Traditional append-only chat versus AgentScript scoped context boundaries"
              />
            </div>
          </div>
        </section>
        <section className={styles.features}>
          {features.map((feature) => (
            <article className={clsx("card", styles.feature)} key={feature.id}>
              <Heading as="h2">{feature.title}</Heading>
              <p>{feature.description}</p>
            </article>
          ))}
        </section>
      </main>
    </Layout>
  );
}
