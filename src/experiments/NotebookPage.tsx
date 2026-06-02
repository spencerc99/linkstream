import { useRef } from "react";
import { Link } from "react-router-dom";
import { HahTitle } from "./HahTitle";
import { useDocumentTitle } from "./useDocumentTitle";
import "./NotebookPage.scss";

interface Entry {
  path: string;
  title: string;
  description: string;
  note?: string;
  comingSoon?: boolean;
}

const ENTRIES: Entry[] = [
  {
    path: "/linkstream",
    title: "linkstream",
    description: "a firehose of links, surfacing from Bluesky in real time.",
  },
  {
    path: "/messages",
    title: "messages",
    description: "if all social media was just dming you",
    note: "sign in with Bluesky to make real replies!",
  },
  {
    path: "/poster",
    title: "poster",
    description: "an exercise in the emotions of virality",
    comingSoon: true,
  },
];

export function NotebookPage() {
  useDocumentTitle();
  const rootRef = useRef<HTMLDivElement>(null);

  // Each call is one "ha" syllable: restart the brief glyph-shudder animation
  // so the background shakes in time with each beat of the laugh. Toggling the
  // class with a forced reflow in between guarantees the animation re-fires
  // even when beats arrive faster than it finishes. Fresh random offsets per
  // beat give each shake its own direction/magnitude so it never looks canned.
  const handleLaugh = () => {
    const el = rootRef.current;
    if (!el) return;
    const rand = (min: number, max: number) =>
      (min + Math.random() * (max - min)).toFixed(1);
    el.style.setProperty("--sx1", `${rand(-8, 8)}px`);
    el.style.setProperty("--sy1", `${rand(-8, 8)}px`);
    el.style.setProperty("--sx2", `${rand(-7, 7)}px`);
    el.style.setProperty("--sy2", `${rand(-7, 7)}px`);
    // Vary the shake duration a touch too, so the rhythm feels organic.
    el.style.setProperty("--sdur", `${rand(120, 200)}ms`);
    el.classList.remove("notebook--shudder");
    void el.offsetWidth; // force reflow to restart the animation
    el.classList.add("notebook--shudder");
  };

  return (
    <div ref={rootRef} className="notebook">
      <div className="notebook__page">
        <header className="notebook__head">
          <h1 className="notebook__title">
            <HahTitle onLaugh={handleLaugh} /> (Hijacking Algorithm Hacking)
          </h1>
          <p className="notebook__byline">
            <i>
              <a href="https://www.are.na/spencer-chang/hijacking-algorithm-hacking-hah">
                social media art experiments
              </a>{" "}
              (mostly built on <a href="https://atproto.com/">atproto</a>)
            </i>
          </p>

          <div className="notebook__intro">
            <p>
              Hijacking Algorithm Hacking (HAH) takes after Search Engine
              Optimization (SEO), a phenomenon which has led the web to be
              flooded with AI slop designed to capture keywords, and co-opts its
              hacky mechanisms to trick the algorithm into centering people. We
              start with a series of interactive studies that expose the
              interpersonal mechanics of the algorithm. Based on these studies,
              we will create scores / instructions that can be carried out by
              anyone with a social media account to make anti-viral viral
              content (human-centered, raw, and slow content but designed to
              trick the algorithm).
            </p>
            <p>
              Subverting the escalating arms race in social media content
              creation to create slicker edits, promote products, and create the
              artificial scarcity, HAH turns the algorithm against itself
              through mass individual action to demonstrate the power we have in
              shaping our technology and flipping the power dynamics even when
              it is designed to control us.
            </p>
          </div>
        </header>

        <section className="notebook__section">
          <h2 className="notebook__section-title">studies</h2>
          <ol className="notebook__entries">
            {ENTRIES.map((entry) => (
              <li
                key={entry.path}
                className={`entry ${entry.comingSoon ? "entry--soon" : ""}`}
              >
                {entry.comingSoon ? (
                  <span className="entry__title entry__title--soon">
                    {entry.title}
                  </span>
                ) : (
                  <Link to={entry.path} className="entry__title">
                    {entry.title}
                  </Link>
                )}{" "}
                <span className="entry__desc">
                  — {entry.description}
                  {entry.comingSoon ? (
                    <span className="entry__soon-tag"> (coming soon)</span>
                  ) : (
                    entry.note && (
                      <span className="entry__note"> ({entry.note})</span>
                    )
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <footer className="notebook__foot">
          <span className="notebook__sig">
            a project by <a href="https://spencer.place">spencer chang</a>
          </span>
          <span className="notebook__rule" aria-hidden="true" />
          <span className="notebook__meta">2025–2026</span>
        </footer>
      </div>
    </div>
  );
}
