import { Link } from "react-router-dom";
import "./HAHPage.scss";

const EXPERIMENTS = [
  {
    path: "/HAH/messages",
    title: "Messages",
    icon: "\u{1F4AC}",
    description: "Everyone wants to talk to you. Your phone won't stop buzzing.",
    detail: "An iMessage clone where the texts never stop coming in.",
  },
  {
    path: "/HAH/poster",
    title: "Poster",
    icon: "\u{1F4E3}",
    description: "Post anything. Watch the world react.",
    detail:
      "A Twitter-style client where every post goes instantly viral.",
  },
  {
    path: "/HAH/void",
    title: "The Void",
    icon: "\u{1F573}\u{FE0F}",
    description: "Speak into the darkness. It listens.",
    detail: "The raw validation loop, stripped of all social media chrome.",
  },
];

export function HAHPage() {
  return (
    <div className="hah-page">
      <div className="hah-content">
        <header className="hah-header">
          <h1>HAH</h1>
          <p className="hah-label">Social Validation Experiments</p>
          <p className="hah-subtext">
            Explorations in manufactured intimacy, synthetic engagement, and the
            dopamine loops of networked communication.
          </p>
        </header>

        <div className="hah-grid">
          {EXPERIMENTS.map((exp) => (
            <Link key={exp.path} to={exp.path} className="experiment-card">
              <div className="card-icon">{exp.icon}</div>
              <h2>{exp.title}</h2>
              <p className="card-description">{exp.description}</p>
              <p className="card-detail">{exp.detail}</p>
              <span className="card-enter">Enter &rarr;</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
